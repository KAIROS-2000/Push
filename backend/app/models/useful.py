"""Useful tasks — admin-curated practice recommendations for the broad student
population (P2 from "Родительский_интерфейс_задачи.md").

Standalone from `Task`/`Assignment` on purpose:
- no submission flow, no XP awards, no judge integration;
- not bound to a single classroom or teacher;
- visible to every authenticated role (UI gates this list to logged-in users).
"""
from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Index
from sqlalchemy.dialects.postgresql import JSONB

from ..core.db import db


JSONType = JSONB().with_variant(db.JSON(), "sqlite")

VALID_USEFUL_AGE_GROUPS = frozenset({'junior', 'middle', 'senior'})
VALID_USEFUL_DIFFICULTIES = frozenset({'easy', 'medium', 'hard'})


class UsefulTask(db.Model):
    __tablename__ = 'useful_tasks'
    __table_args__ = (
        Index('ix_useful_tasks_published_created', 'is_published', 'created_at'),
    )

    id = db.Column(db.Integer, primary_key=True)
    slug = db.Column(db.String(120), nullable=False, unique=True, index=True)
    title = db.Column(db.String(160), nullable=False)
    summary = db.Column(db.Text, nullable=False, default='')
    body = db.Column(db.Text, nullable=False, default='')
    external_url = db.Column(db.String(500), nullable=True)
    # Multi-tag age groups: ['junior', 'middle'] etc. JSON keeps the model simple
    # at the cost of indexing — useful tasks are bounded in number (curated), so
    # full table scans are cheap; we filter in Python after fetch.
    age_groups = db.Column(JSONType, nullable=False, default=list)
    topic = db.Column(db.String(80), nullable=True, index=True)
    difficulty = db.Column(db.String(20), nullable=False, default='medium')
    image_id = db.Column(
        db.Integer, db.ForeignKey('media_assets.id', ondelete='SET NULL'), nullable=True, index=True
    )
    is_published = db.Column(db.Boolean, nullable=False, default=False, index=True)
    created_by_id = db.Column(
        db.Integer, db.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True
    )
    created_at = db.Column(
        db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    image = db.relationship('MediaAsset', foreign_keys=[image_id])

    def to_dict(self, *, include_body: bool = False) -> dict:
        normalized_age_groups = [
            value for value in (self.age_groups or [])
            if isinstance(value, str) and value in VALID_USEFUL_AGE_GROUPS
        ]
        payload = {
            'id': self.id,
            'slug': self.slug,
            'title': self.title,
            'summary': self.summary or '',
            'external_url': self.external_url,
            'age_groups': normalized_age_groups,
            'topic': self.topic,
            'difficulty': self.difficulty,
            'image_id': self.image_id,
            'image_url': self.image.public_url() if self.image else None,
            'is_published': bool(self.is_published),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_body:
            payload['body'] = self.body or ''
        return payload


def normalize_age_groups(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    seen: list[str] = []
    for item in value:
        text = str(item or '').strip().lower()
        if text in VALID_USEFUL_AGE_GROUPS and text not in seen:
            seen.append(text)
    return seen


def normalize_useful_difficulty(value: object) -> str:
    text = str(value or '').strip().lower()
    return text if text in VALID_USEFUL_DIFFICULTIES else 'medium'
