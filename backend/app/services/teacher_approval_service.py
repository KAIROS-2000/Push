from __future__ import annotations

from datetime import UTC, datetime, timedelta

from ..core.db import db
from ..models.user import TEACHER_APPROVAL_REJECTED, User, UserRole

TEACHER_REJECTION_RETENTION = timedelta(minutes=15)


def teacher_rejection_expiration(now: datetime | None = None) -> datetime:
    return (now or datetime.now(UTC)) + TEACHER_REJECTION_RETENTION


def cleanup_expired_teacher_requests(now: datetime | None = None) -> int:
    cutoff = now or datetime.now(UTC)
    expired_requests = User.query.filter(
        User.role == UserRole.TEACHER,
        User.teacher_approval_status == TEACHER_APPROVAL_REJECTED,
        User.teacher_rejection_expires_at.isnot(None),
        User.teacher_rejection_expires_at <= cutoff,
    ).all()
    for user in expired_requests:
        db.session.delete(user)
    if expired_requests:
        db.session.flush()
    return len(expired_requests)
