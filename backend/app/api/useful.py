"""Useful tasks API.

Two-tier surface:
- public (any authenticated role): list + detail of `is_published=True` rows.
- admin/superadmin: full CRUD including drafts.

Notes on shape:
- `age_group` query filter accepts a single value; the underlying model holds an
  array, so we match using "any value in the array == requested".
- Search is a case-insensitive `ILIKE` on title (kept simple — useful_tasks are
  curated and bounded in number, full-text search is overkill).
"""
from __future__ import annotations

import re

from flask import Blueprint, request
from sqlalchemy import or_

from ..core.db import db
from ..core.security import auth_required
from ..models.media import MEDIA_KIND_ASSIGNMENT_COVER, MediaAsset
from ..models.useful import (
    UsefulTask,
    VALID_USEFUL_AGE_GROUPS,
    normalize_age_groups,
    normalize_useful_difficulty,
)
from ..models.user import AdminAuditLog, User, UserRole


useful_bp = Blueprint('useful', __name__)


SLUG_RE = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*')
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


def _safe_int(value, default: int, *, minimum: int | None = None, maximum: int | None = None) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    if minimum is not None:
        parsed = max(parsed, minimum)
    if maximum is not None:
        parsed = min(parsed, maximum)
    return parsed


def _slugify(value: str) -> str:
    """Generate a URL-safe slug. Falls back to a deterministic stub for non-ASCII titles."""
    base = re.sub(r'[^a-zA-Z0-9]+', '-', (value or '').lower()).strip('-')
    return base or 'useful-task'


def _ensure_unique_slug(seed: str, *, exclude_id: int | None = None) -> str:
    candidate = _slugify(seed)
    suffix = 0
    while True:
        target = candidate if suffix == 0 else f'{candidate}-{suffix}'
        query = UsefulTask.query.filter_by(slug=target)
        if exclude_id is not None:
            query = query.filter(UsefulTask.id != exclude_id)
        if query.first() is None:
            return target
        suffix += 1


def _validate_image(image_id) -> tuple[int | None, tuple[dict, int] | None]:
    if image_id in (None, '', 0):
        return None, None
    try:
        parsed = int(image_id)
    except (TypeError, ValueError):
        return None, ({'message': 'Некорректный image_id.'}, 400)
    media = MediaAsset.query.get(parsed)
    if media is None or media.kind != MEDIA_KIND_ASSIGNMENT_COVER:
        return None, ({'message': 'Изображение не найдено.'}, 404)
    return parsed, None


_EXTERNAL_URL_MAX_LENGTH = 500


def _validate_external_url(value) -> tuple[str | None, tuple[dict, int] | None]:
    """Reject everything except http:// and https:// to prevent javascript:,
    data: and file: schemes from being rendered as clickable links to learners.
    """
    raw = str(value or '').strip()
    if not raw:
        return None, None
    lowered = raw.lower()
    if not (lowered.startswith('http://') or lowered.startswith('https://')):
        return None, (
            {
                'message': 'external_url должен начинаться с http:// или https://.',
                'code': 'invalid_external_url_scheme',
            },
            400,
        )
    if len(raw) > _EXTERNAL_URL_MAX_LENGTH:
        return None, (
            {
                'message': f'external_url не длиннее {_EXTERNAL_URL_MAX_LENGTH} символов.',
            },
            400,
        )
    return raw, None


def _filter_age_group(query, raw_value: str | None):
    if not raw_value:
        return query
    normalized = raw_value.strip().lower()
    if normalized not in VALID_USEFUL_AGE_GROUPS:
        return query
    # The SQLite test backend uses JSON variant where containment is not portable;
    # do the filter in Python after fetching all rows for this single-value lookup.
    # For the current expected scale (curated dozens), this is fine.
    return query


def _python_filter_age_group(items: list[UsefulTask], raw_value: str | None) -> list[UsefulTask]:
    if not raw_value:
        return items
    normalized = raw_value.strip().lower()
    if normalized not in VALID_USEFUL_AGE_GROUPS:
        return items
    return [item for item in items if normalized in (item.age_groups or [])]


def _list_payload(items: list[UsefulTask]) -> list[dict]:
    return [item.to_dict() for item in items]


def _log_admin_useful_action(actor: User, *, action: str, task: UsefulTask, extra: dict | None = None) -> None:
    payload = dict(extra or {})
    payload.setdefault('slug', task.slug)
    payload.setdefault('title', task.title)
    payload.setdefault('is_published', bool(task.is_published))
    payload.setdefault('actor_email', actor.email)
    db.session.add(
        AdminAuditLog(
            actor_user_id=actor.id,
            actor_role=actor.role.value,
            action=action,
            entity_type='useful_task',
            entity_id=task.id,
            entity_label=task.slug,
            details_json=payload,
        )
    )


# ---------------------------------------------------------------------------
# Public (any authenticated role)
# ---------------------------------------------------------------------------


@useful_bp.get('')
@auth_required()
def list_useful(current_user: User):
    age_group = (request.args.get('age_group') or '').strip().lower() or None
    topic = (request.args.get('topic') or '').strip().lower() or None
    difficulty = (request.args.get('difficulty') or '').strip().lower() or None
    search = (request.args.get('q') or '').strip()
    limit = _safe_int(request.args.get('limit'), DEFAULT_PAGE_SIZE, minimum=1, maximum=MAX_PAGE_SIZE)

    query = UsefulTask.query.filter_by(is_published=True)
    if topic:
        query = query.filter(UsefulTask.topic == topic)
    if difficulty in {'easy', 'medium', 'hard'}:
        query = query.filter(UsefulTask.difficulty == difficulty)
    if search:
        like = f'%{search}%'
        query = query.filter(or_(UsefulTask.title.ilike(like), UsefulTask.summary.ilike(like)))
    query = query.order_by(UsefulTask.created_at.desc(), UsefulTask.id.desc())
    items = query.limit(MAX_PAGE_SIZE).all()
    items = _python_filter_age_group(items, age_group)
    items = items[:limit]
    return {
        'tasks': _list_payload(items),
        'total': len(items),
        'filters': {
            'age_group': age_group,
            'topic': topic,
            'difficulty': difficulty,
            'q': search,
        },
    }


@useful_bp.get('/<string:slug>')
@auth_required()
def detail_useful(current_user: User, slug: str):
    task = UsefulTask.query.filter_by(slug=slug).first()
    if task is None or not task.is_published:
        # Mask drafts to non-admins to avoid an information leak about future content.
        if not (task and current_user.role in (UserRole.ADMIN, UserRole.SUPERADMIN)):
            return {'message': 'Не найдено.'}, 404
    return {'task': task.to_dict(include_body=True)}


# ---------------------------------------------------------------------------
# Admin CRUD
# ---------------------------------------------------------------------------


@useful_bp.get('/admin')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def admin_list_useful(current_user: User):
    items = UsefulTask.query.order_by(UsefulTask.created_at.desc(), UsefulTask.id.desc()).limit(MAX_PAGE_SIZE).all()
    return {'tasks': [item.to_dict(include_body=True) for item in items]}


@useful_bp.post('/admin')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def admin_create_useful(current_user: User):
    data = request.get_json(silent=True) or {}
    title = str(data.get('title') or '').strip()
    if not title:
        return {'message': 'Укажите название.'}, 400

    image_id, image_error = _validate_image(data.get('image_id'))
    if image_error:
        return image_error
    external_url, url_error = _validate_external_url(data.get('external_url'))
    if url_error:
        return url_error

    slug = _ensure_unique_slug(str(data.get('slug') or title))
    task = UsefulTask(
        slug=slug,
        title=title[:160],
        summary=str(data.get('summary') or '')[:2000],
        body=str(data.get('body') or '')[:20000],
        external_url=external_url,
        age_groups=normalize_age_groups(data.get('age_groups')),
        topic=(str(data.get('topic') or '').strip().lower() or None),
        difficulty=normalize_useful_difficulty(data.get('difficulty')),
        image_id=image_id,
        is_published=bool(data.get('is_published', False)),
        created_by_id=current_user.id,
    )
    db.session.add(task)
    db.session.flush()
    _log_admin_useful_action(current_user, action='useful_task_created', task=task)
    db.session.commit()
    return {'task': task.to_dict(include_body=True)}, 201


@useful_bp.patch('/admin/<int:task_id>')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def admin_update_useful(current_user: User, task_id: int):
    task = UsefulTask.query.get_or_404(task_id)
    data = request.get_json(silent=True) or {}
    if 'title' in data:
        title = str(data.get('title') or '').strip()
        if not title:
            return {'message': 'Название не может быть пустым.'}, 400
        task.title = title[:160]
    if 'slug' in data and data['slug']:
        task.slug = _ensure_unique_slug(str(data['slug']), exclude_id=task.id)
    if 'summary' in data:
        task.summary = str(data.get('summary') or '')[:2000]
    if 'body' in data:
        task.body = str(data.get('body') or '')[:20000]
    if 'external_url' in data:
        external_url, url_error = _validate_external_url(data.get('external_url'))
        if url_error:
            return url_error
        task.external_url = external_url
    if 'age_groups' in data:
        task.age_groups = normalize_age_groups(data.get('age_groups'))
    if 'topic' in data:
        topic = str(data.get('topic') or '').strip().lower()
        task.topic = topic or None
    if 'difficulty' in data:
        task.difficulty = normalize_useful_difficulty(data.get('difficulty'))
    if 'image_id' in data:
        image_id, image_error = _validate_image(data.get('image_id'))
        if image_error:
            return image_error
        task.image_id = image_id
    if 'is_published' in data:
        task.is_published = bool(data.get('is_published'))

    _log_admin_useful_action(current_user, action='useful_task_updated', task=task)
    db.session.commit()
    return {'task': task.to_dict(include_body=True)}


@useful_bp.delete('/admin/<int:task_id>')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def admin_delete_useful(current_user: User, task_id: int):
    task = UsefulTask.query.get_or_404(task_id)
    _log_admin_useful_action(current_user, action='useful_task_deleted', task=task)
    db.session.delete(task)
    db.session.commit()
    return {'ok': True}
