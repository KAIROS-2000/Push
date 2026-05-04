"""Media assets (P1 — assignment cover images and similar curated visuals).

Storage layout: physical file at `<MEDIA_DIR>/<kind_dir>/<sha256>.<format>`.
The `relative_path` column stores `<kind_dir>/<sha256>.<format>` so we can
serve via `send_from_directory(MEDIA_DIR, ...)` without exposing absolute paths.

`is_generated=True` marks SVG placeholders auto-created by the backfill
command — they are owned by the platform, no `uploaded_by_id` needed.
"""
from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Index

from ..core.db import db


MEDIA_KIND_ASSIGNMENT_COVER = 'assignment_cover'

ALLOWED_MEDIA_KINDS = frozenset({MEDIA_KIND_ASSIGNMENT_COVER})
ALLOWED_MEDIA_FORMATS = frozenset({'webp', 'png', 'jpg', 'jpeg', 'svg'})


class MediaAsset(db.Model):
    __tablename__ = 'media_assets'
    __table_args__ = (
        Index('ix_media_assets_kind_created', 'kind', 'created_at'),
    )

    id = db.Column(db.Integer, primary_key=True)
    kind = db.Column(db.String(32), nullable=False, index=True)
    format = db.Column(db.String(8), nullable=False)
    width = db.Column(db.Integer, nullable=True)
    height = db.Column(db.Integer, nullable=True)
    byte_size = db.Column(db.Integer, nullable=False, default=0)
    sha256 = db.Column(db.String(64), nullable=False, unique=True, index=True)
    relative_path = db.Column(db.String(255), nullable=False)
    uploaded_by_id = db.Column(
        db.Integer, db.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True
    )
    is_generated = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(
        db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'kind': self.kind,
            'format': self.format,
            'width': self.width,
            'height': self.height,
            'byte_size': self.byte_size,
            'sha256': self.sha256,
            'is_generated': self.is_generated,
            'url': self.public_url(),
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def public_url(self) -> str:
        # Routed via /api/media/assignment-images/<filename> in __init__.py
        # (kind-prefixed sub-route picked from `kind`).
        if self.kind == MEDIA_KIND_ASSIGNMENT_COVER:
            return f'/api/media/assignment-images/{self.sha256}.{self.format}'
        return f'/api/media/{self.kind}/{self.sha256}.{self.format}'
