"""Helpers for issuing, hashing, and validating one-shot email tokens.

The raw token value is created with `secrets.token_urlsafe(32)` and is shown
to the caller exactly once (so it can be embedded into the outgoing email
link). Only `sha256(raw_token)` is persisted; we lookup tokens by hashing
the supplied value. This way a leaked database snapshot does not let an
attacker complete the verification or password-reset flow.

Tokens are single-use (`used_at`), expire after a configurable TTL, and any
new password-reset token issued for a user automatically marks all earlier
unused reset tokens as used (consumed) — the email link from a prior
request stops working immediately.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from flask import current_app, request
from sqlalchemy import func

from ..core.db import db
from ..models.user import (
    EMAIL_TOKEN_PURPOSE_PASSWORD_RESET,
    EMAIL_TOKEN_PURPOSE_VERIFICATION,
    EmailToken,
    User,
    UserRole,
)

USER_AGENT_MAX_LENGTH = 255
RAW_TOKEN_BYTES = 32
SELF_REGISTRATION_ROLES = (UserRole.STUDENT, UserRole.TEACHER, UserRole.PARENT)


@dataclass(frozen=True)
class IssuedToken:
    raw_token: str
    record: EmailToken


def hash_token(raw_token: str) -> str:
    if not isinstance(raw_token, str) or not raw_token:
        return ''
    return hashlib.sha256(raw_token.encode('utf-8')).hexdigest()


def _verification_ttl() -> timedelta:
    minutes = max(int(current_app.config.get('EMAIL_VERIFICATION_TOKEN_TTL_MINUTES') or 1440), 1)
    return timedelta(minutes=minutes)


def _password_reset_ttl() -> timedelta:
    minutes = max(int(current_app.config.get('PASSWORD_RESET_TOKEN_TTL_MINUTES') or 30), 1)
    return timedelta(minutes=minutes)


def _ensure_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _request_metadata() -> tuple[str | None, str | None]:
    try:
        ip = (request.remote_addr or '').strip() or None
    except RuntimeError:  # outside request context
        ip = None
    try:
        user_agent = (request.headers.get('User-Agent') or '').strip()
        user_agent = user_agent[:USER_AGENT_MAX_LENGTH] if user_agent else None
    except RuntimeError:
        user_agent = None
    return ip, user_agent


def _generate_raw_token() -> str:
    # Re-roll on the (astronomical) chance the hash already exists.
    for _ in range(5):
        raw = secrets.token_urlsafe(RAW_TOKEN_BYTES)
        if not EmailToken.query.filter_by(token_hash=hash_token(raw)).first():
            return raw
    return secrets.token_urlsafe(RAW_TOKEN_BYTES)


def issue_token(user: User, purpose: str, *, ttl: timedelta) -> IssuedToken:
    raw = _generate_raw_token()
    ip, user_agent = _request_metadata()
    record = EmailToken(
        user_id=user.id,
        purpose=purpose,
        token_hash=hash_token(raw),
        expires_at=datetime.now(UTC) + ttl,
        request_ip=ip,
        user_agent=user_agent,
    )
    db.session.add(record)
    db.session.flush()
    return IssuedToken(raw_token=raw, record=record)


def issue_verification_token(user: User) -> IssuedToken:
    return issue_token(user, EMAIL_TOKEN_PURPOSE_VERIFICATION, ttl=_verification_ttl())


def _latest_verification_expiry(user_id: int) -> datetime | None:
    return db.session.query(func.max(EmailToken.expires_at)).filter(
        EmailToken.user_id == user_id,
        EmailToken.purpose == EMAIL_TOKEN_PURPOSE_VERIFICATION,
    ).scalar()


def delete_unverified_user_if_verification_expired(
    user: User | None,
    now: datetime | None = None,
) -> bool:
    """Delete a self-registered account whose newest verification link expired."""

    if user is None or user.email_verified or user.role not in SELF_REGISTRATION_ROLES:
        return False

    cutoff = now or datetime.now(UTC)
    latest_expiry = _ensure_utc(_latest_verification_expiry(user.id))
    if latest_expiry is None or latest_expiry > cutoff:
        return False

    db.session.delete(user)
    db.session.flush()
    return True


def cleanup_expired_unverified_users(now: datetime | None = None) -> int:
    """Delete unverified self-signups whose newest verification token expired."""

    cutoff = now or datetime.now(UTC)
    latest_tokens = (
        db.session.query(
            EmailToken.user_id.label('user_id'),
            func.max(EmailToken.expires_at).label('latest_expires_at'),
        )
        .filter(EmailToken.purpose == EMAIL_TOKEN_PURPOSE_VERIFICATION)
        .group_by(EmailToken.user_id)
        .subquery()
    )
    expired_users = (
        User.query
        .join(latest_tokens, latest_tokens.c.user_id == User.id)
        .filter(
            User.email_verified.is_(False),
            User.role.in_(SELF_REGISTRATION_ROLES),
            latest_tokens.c.latest_expires_at <= cutoff,
        )
        .all()
    )
    for user in expired_users:
        db.session.delete(user)
    if expired_users:
        db.session.flush()
    return len(expired_users)


def invalidate_active_tokens(user: User, purpose: str) -> int:
    now = datetime.now(UTC)
    rows = (
        EmailToken.query
        .filter_by(user_id=user.id, purpose=purpose, used_at=None)
        .all()
    )
    for row in rows:
        row.used_at = now
    if rows:
        db.session.flush()
    return len(rows)


def issue_password_reset_token(user: User) -> IssuedToken:
    """Issue a fresh reset token, invalidating any earlier active reset tokens.

    The previous (unused) reset link stops working as soon as a new one is
    issued — we mark the older rows as used. This caps the blast radius of
    a leaked link and prevents attackers from racing two parallel resets.
    """
    invalidate_active_tokens(user, EMAIL_TOKEN_PURPOSE_PASSWORD_RESET)
    return issue_token(user, EMAIL_TOKEN_PURPOSE_PASSWORD_RESET, ttl=_password_reset_ttl())


@dataclass
class ConsumeResult:
    token: EmailToken | None
    user: User | None
    error: str | None = None


def consume_token(raw_token: str, purpose: str) -> ConsumeResult:
    """Lookup a token by hash, validate TTL/used_at, and mark it used atomically.

    On success the caller still owns the transaction commit (we only flush) so
    additional state changes (verifying email, rotating password, bumping
    session_version) stay in the same DB transaction as marking the token used.
    """

    if not isinstance(raw_token, str) or not raw_token.strip():
        return ConsumeResult(token=None, user=None, error='invalid_token')
    digest = hash_token(raw_token.strip())
    record = EmailToken.query.filter_by(token_hash=digest, purpose=purpose).first()
    if record is None:
        return ConsumeResult(token=None, user=None, error='invalid_token')

    now = datetime.now(UTC)
    if record.used_at is not None:
        return ConsumeResult(token=record, user=record.user, error='used_token')
    expires_at = record.expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if not expires_at or expires_at <= now:
        return ConsumeResult(token=record, user=record.user, error='expired_token')

    user = record.user or db.session.get(User, record.user_id)
    if user is None or not user.is_active:
        return ConsumeResult(token=record, user=user, error='user_unavailable')

    record.used_at = now
    db.session.flush()
    return ConsumeResult(token=record, user=user)
