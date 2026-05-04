"""Assignment cover image service: SVG placeholder generation + filesystem I/O.

P1 plan: every existing Assignment gets an auto-generated SVG cover so the parent/student UI
never falls back to "no image". New Assignments uploaded via admin will use real raster images
(WebP via Pillow re-encode). Both code paths converge on the same MediaAsset row schema.
"""
from __future__ import annotations

import hashlib
import os
import unicodedata
from html import escape
from pathlib import Path
from typing import Iterable

from flask import current_app

from ..core.db import db
from ..models.learning import Assignment
from ..models.media import MEDIA_KIND_ASSIGNMENT_COVER, MediaAsset


ASSIGNMENT_IMAGES_SUBDIR = 'assignment-images'


def _media_root() -> Path:
    raw = current_app.config.get('MEDIA_DIR') if current_app else None
    if raw:
        candidate = Path(str(raw))
        if candidate.is_dir():
            return candidate
    env = os.environ.get('MEDIA_DIR')
    if env and Path(env).is_dir():
        return Path(env)
    # Fallback to repo media/. backend/app/services/.. = backend/app, parents[2] = repo root.
    return Path(__file__).resolve().parents[3] / 'media'


def _assignment_images_dir() -> Path:
    target = _media_root() / ASSIGNMENT_IMAGES_SUBDIR
    target.mkdir(parents=True, exist_ok=True)
    return target


# Pre-curated palette: deterministic per assignment, stable across reseeds.
_PALETTE = (
    ('#0EA5E9', '#0369A1'),
    ('#22C55E', '#15803D'),
    ('#EAB308', '#A16207'),
    ('#EC4899', '#9D174D'),
    ('#8B5CF6', '#5B21B6'),
    ('#F97316', '#9A3412'),
    ('#14B8A6', '#0F766E'),
    ('#F43F5E', '#9F1239'),
)


def _palette_for_seed(seed: str) -> tuple[str, str]:
    digest = hashlib.sha256(seed.encode('utf-8')).hexdigest()
    return _PALETTE[int(digest[:2], 16) % len(_PALETTE)]


def _initials(title: str) -> str:
    """Two-char initials from the first up-to-two whitespace-separated words."""
    cleaned = unicodedata.normalize('NFKC', (title or '').strip())
    if not cleaned:
        return '?'
    parts = [p for p in cleaned.split() if p]
    if not parts:
        return '?'
    if len(parts) == 1:
        chars = parts[0][:2]
    else:
        chars = parts[0][:1] + parts[1][:1]
    return chars.upper()


def render_assignment_placeholder_svg(title: str, *, seed: str | None = None) -> bytes:
    """Render a single, deterministic SVG placeholder for an Assignment.

    The SVG is intentionally script-free (no `<script>`, no foreignObject) so it stays safe to
    serve directly via send_from_directory even if the content-type sniffer prefers SVG.
    """
    primary, secondary = _palette_for_seed(seed or title or 'assignment')
    initials = _initials(title)
    safe_title = escape(title.strip()[:80] if title else 'Задание', quote=True)
    gradient_id = f'g{hashlib.sha1((seed or title or "x").encode("utf-8")).hexdigest()[:8]}'
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 480" role="img" '
        f'aria-label="{safe_title}">'
        '<defs>'
        f'<linearGradient id="{gradient_id}" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{primary}"/>'
        f'<stop offset="1" stop-color="{secondary}"/>'
        '</linearGradient>'
        '</defs>'
        f'<rect width="800" height="480" fill="url(#{gradient_id})"/>'
        '<g fill="white" fill-opacity="0.18">'
        '<circle cx="120" cy="120" r="80"/>'
        '<circle cx="700" cy="380" r="120"/>'
        '<circle cx="640" cy="100" r="40"/>'
        '</g>'
        '<g font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif" fill="white">'
        f'<text x="60" y="200" font-size="120" font-weight="900">{escape(initials)}</text>'
        f'<text x="60" y="280" font-size="28" font-weight="700" opacity="0.95">{safe_title}</text>'
        '<text x="60" y="320" font-size="20" font-weight="500" opacity="0.85">'
        'Прогресс по уроку'
        '</text>'
        '</g>'
        '</svg>'
    )
    return svg.encode('utf-8')


def _store_bytes(payload: bytes, *, suffix: str) -> tuple[str, str, int]:
    """Write payload to assignment-images dir under sha256.<suffix>; idempotent."""
    digest = hashlib.sha256(payload).hexdigest()
    dest_dir = _assignment_images_dir()
    dest = dest_dir / f'{digest}.{suffix}'
    if not dest.exists():
        dest.write_bytes(payload)
    relative = f'{ASSIGNMENT_IMAGES_SUBDIR}/{digest}.{suffix}'
    return digest, relative, len(payload)


def _existing_asset_by_sha(digest: str) -> MediaAsset | None:
    return MediaAsset.query.filter_by(sha256=digest).first()


def create_or_reuse_svg_placeholder(*, title: str, seed: str | None = None) -> MediaAsset:
    """Return an existing MediaAsset row for the same content, otherwise persist a new one."""
    payload = render_assignment_placeholder_svg(title, seed=seed)
    digest = hashlib.sha256(payload).hexdigest()
    existing = _existing_asset_by_sha(digest)
    if existing is not None:
        return existing
    digest_dup, relative, byte_size = _store_bytes(payload, suffix='svg')
    assert digest == digest_dup
    asset = MediaAsset(
        kind=MEDIA_KIND_ASSIGNMENT_COVER,
        format='svg',
        width=800,
        height=480,
        byte_size=byte_size,
        sha256=digest,
        relative_path=relative,
        is_generated=True,
    )
    db.session.add(asset)
    db.session.flush()
    return asset


def store_uploaded_image(
    *, payload: bytes, fmt: str, width: int | None, height: int | None, uploaded_by_id: int | None
) -> MediaAsset:
    """Persist a pre-validated raster image (caller must have already re-encoded it)."""
    digest, relative, byte_size = _store_bytes(payload, suffix=fmt)
    existing = _existing_asset_by_sha(digest)
    if existing is not None:
        return existing
    asset = MediaAsset(
        kind=MEDIA_KIND_ASSIGNMENT_COVER,
        format=fmt,
        width=width,
        height=height,
        byte_size=byte_size,
        sha256=digest,
        relative_path=relative,
        uploaded_by_id=uploaded_by_id,
        is_generated=False,
    )
    db.session.add(asset)
    db.session.flush()
    return asset


# Upload limits — security-critical, kept centralized.
MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_UPLOAD_PIXELS = 24_000_000  # 24 megapixels — well below Pillow default but caps zip-bombs
MAX_OUTPUT_SIDE_PX = 1200
ALLOWED_RASTER_INPUT_FORMATS = frozenset({'PNG', 'JPEG', 'WEBP'})


class ImageValidationError(ValueError):
    """Raised when an uploaded image fails any defense-in-depth check."""


def reencode_uploaded_image(
    raw_bytes: bytes, *, uploaded_by_id: int | None
) -> MediaAsset:
    """Validate + re-encode an uploaded raster image and persist it as a MediaAsset.

    Validation order matters:
      1. Byte budget (cheap, blocks decompression bombs at the entry).
      2. Pillow open + verify (rejects malformed / non-image content).
      3. Format whitelist (blocks SVG-as-XML, BMP-with-payload, etc).
      4. Pixel budget (Pillow exposes (w, h) only after open).
      5. Re-encode in a fresh decoder pass (drops EXIF + any embedded scripts).
    """
    if not raw_bytes:
        raise ImageValidationError('Файл пустой.')
    if len(raw_bytes) > MAX_UPLOAD_BYTES:
        raise ImageValidationError(
            f'Файл больше {MAX_UPLOAD_BYTES // (1024 * 1024)} МБ.'
        )

    # Local import — Pillow is a heavy module, defer until first upload happens.
    from io import BytesIO

    try:
        from PIL import Image, UnidentifiedImageError
    except ImportError as exc:
        raise ImageValidationError(
            'Сервер не настроен на загрузку изображений: отсутствует библиотека Pillow.'
        ) from exc

    Image.MAX_IMAGE_PIXELS = MAX_UPLOAD_PIXELS

    buffer = BytesIO(raw_bytes)
    try:
        with Image.open(buffer) as probe:
            probe.verify()  # Pillow .verify() consumes the file pointer; reopen below.
    except (UnidentifiedImageError, OSError) as exc:
        raise ImageValidationError('Не удалось распознать изображение.') from exc
    except Image.DecompressionBombError as exc:
        raise ImageValidationError('Изображение слишком большое.') from exc

    buffer.seek(0)
    try:
        with Image.open(buffer) as img:
            source_format = (img.format or '').upper()
            if source_format not in ALLOWED_RASTER_INPUT_FORMATS:
                raise ImageValidationError(
                    f'Поддерживаются только PNG, JPEG, WEBP. Получено: {source_format or "?"}.'
                )
            width, height = img.size
            if width <= 0 or height <= 0:
                raise ImageValidationError('Некорректные размеры изображения.')
            if width * height > MAX_UPLOAD_PIXELS:
                raise ImageValidationError('Слишком много пикселей в изображении.')
            # Drop EXIF / metadata via the conversion + a clean save below.
            converted = img.convert('RGB')
            scale = min(1.0, MAX_OUTPUT_SIDE_PX / max(width, height))
            if scale < 1.0:
                new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
                # Pillow >=10 moved LANCZOS to Image.Resampling; keep a graceful fallback
                # for older installs in case requirements drift.
                resample = getattr(Image, 'Resampling', Image).LANCZOS
                converted = converted.resize(new_size, resample)
            out_buffer = BytesIO()
            converted.save(out_buffer, format='WEBP', quality=86, method=6)
            payload = out_buffer.getvalue()
            final_width, final_height = converted.size
    except Image.DecompressionBombError as exc:
        raise ImageValidationError('Изображение слишком большое.') from exc
    except (OSError, ValueError) as exc:
        raise ImageValidationError('Не удалось обработать изображение.') from exc

    return store_uploaded_image(
        payload=payload,
        fmt='webp',
        width=final_width,
        height=final_height,
        uploaded_by_id=uploaded_by_id,
    )


def backfill_assignment_placeholders(assignments: Iterable[Assignment] | None = None) -> int:
    """Attach an SVG placeholder to every Assignment that has none. Returns count attached."""
    iterator = assignments if assignments is not None else Assignment.query.filter_by(image_id=None).all()
    attached = 0
    for assignment in iterator:
        if assignment.image_id:
            continue
        seed = f'assignment:{assignment.id}:{assignment.title or ""}'
        asset = create_or_reuse_svg_placeholder(title=assignment.title or 'Задание', seed=seed)
        assignment.image_id = asset.id
        attached += 1
    if attached:
        db.session.flush()
    return attached
