from __future__ import annotations

import enum
from datetime import UTC, datetime

from sqlalchemy import UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB

from ..core.db import db
from ..core.gamification import level_from_xp, rank_title, xp_to_next_level


class UserRole(enum.Enum):
    STUDENT = 'student'
    TEACHER = 'teacher'
    PARENT = 'parent'
    ADMIN = 'admin'
    SUPERADMIN = 'superadmin'


USERNAME_MIN_LENGTH = 5
USERNAME_MAX_LENGTH = 10
JSONType = JSONB().with_variant(db.JSON(), 'sqlite')
TEACHER_APPROVAL_PENDING = 'pending'
TEACHER_APPROVAL_APPROVED = 'approved'
TEACHER_APPROVAL_REJECTED = 'rejected'
TEACHER_APPROVAL_STATUSES = {
    TEACHER_APPROVAL_PENDING,
    TEACHER_APPROVAL_APPROVED,
    TEACHER_APPROVAL_REJECTED,
}


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(120), nullable=False)
    username = db.Column(db.String(60), unique=True, nullable=False, index=True)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    phone = db.Column(db.String(20), unique=True, nullable=True, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.Enum(UserRole), nullable=False, default=UserRole.STUDENT)
    age_group = db.Column(db.String(20), nullable=True)
    xp = db.Column(db.Integer, nullable=False, default=0)
    xp_progress = db.Column(db.Integer, nullable=False, default=0)
    avatar_id = db.Column(db.String(80), nullable=True)
    frame_id = db.Column(db.String(80), nullable=True)
    streak = db.Column(db.Integer, nullable=False, default=1)
    theme = db.Column(db.String(20), nullable=False, default='light')
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    teacher_approval_status = db.Column(
        db.String(20),
        nullable=False,
        default=TEACHER_APPROVAL_APPROVED,
        index=True,
    )
    teacher_rejection_expires_at = db.Column(db.DateTime(timezone=True), nullable=True, index=True)
    session_version = db.Column(db.Integer, nullable=False, default=0)
    last_login_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)

    classes_created = db.relationship('Classroom', back_populates='teacher', foreign_keys='Classroom.teacher_id')
    progress = db.relationship('UserProgress', back_populates='user', cascade='all, delete-orphan')
    achievements = db.relationship('UserAchievement', back_populates='user', cascade='all, delete-orphan')
    memberships = db.relationship('ClassMembership', back_populates='student', cascade='all, delete-orphan')
    refresh_tokens = db.relationship('RefreshToken', back_populates='user', cascade='all, delete-orphan')

    def touch_login(self) -> None:
        self.last_login_at = datetime.now(UTC)

    def bump_session_version(self) -> int:
        self.session_version = int(self.session_version or 0) + 1
        return self.session_version

    def add_xp(self, value: int) -> None:
        gained = max(value, 0)
        self.xp = int(self.xp or 0) + gained
        self.xp_progress = int(self.xp_progress or 0) + gained

    def spend_xp(self, amount: int) -> bool:
        cost = max(int(amount), 0)
        if int(self.xp or 0) < cost:
            return False
        self.xp = int(self.xp or 0) - cost
        return True

    @property
    def lifetime_xp(self) -> int:
        return max(int(self.xp or 0), int(self.xp_progress or 0))

    @property
    def level(self) -> int:
        return level_from_xp(self.lifetime_xp)

    @property
    def rank_title(self) -> str:
        return rank_title(self.level)

    @property
    def xp_to_next(self) -> int:
        return xp_to_next_level(self.lifetime_xp)

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'full_name': self.full_name,
            'username': self.username,
            'email': self.email,
            'phone': self.phone,
            'role': self.role.value,
            'age_group': self.age_group,
            'xp': self.xp,
            'level': self.level,
            'rank_title': self.rank_title,
            'xp_to_next': self.xp_to_next,
            'streak': self.streak,
            'theme': self.theme,
            'avatar_id': self.avatar_id,
            'frame_id': self.frame_id,
            'is_active': self.is_active,
            'teacher_approval_status': self.teacher_approval_status or TEACHER_APPROVAL_APPROVED,
            'teacher_rejection_expires_at': self.teacher_rejection_expires_at.isoformat()
            if self.teacher_rejection_expires_at
            else None,
        }

    def to_parent_dict(self) -> dict:
        return {
            'full_name': self.full_name,
            'age_group': self.age_group,
            'level': self.level,
            'rank_title': self.rank_title,
        }


class AdminAuditLog(db.Model):
    __tablename__ = 'admin_audit_logs'

    id = db.Column(db.Integer, primary_key=True)
    actor_user_id = db.Column(db.Integer, nullable=True, index=True)
    actor_role = db.Column(db.String(32), nullable=False, index=True)
    action = db.Column(db.String(64), nullable=False, index=True)
    entity_type = db.Column(db.String(32), nullable=False, index=True)
    entity_id = db.Column(db.Integer, nullable=True, index=True)
    entity_label = db.Column(db.String(255), nullable=False, default='', index=True)
    details_json = db.Column(JSONType, nullable=False, default=dict)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False, index=True)

    def to_dict(self) -> dict:
        details = self.details_json if isinstance(self.details_json, dict) else {}
        return {
            'id': self.id,
            'actor_user_id': self.actor_user_id,
            'actor_role': self.actor_role,
            'action': self.action,
            'entity_type': self.entity_type,
            'entity_id': self.entity_id,
            'entity_label': self.entity_label,
            'details': details,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'actor': {
                'id': self.actor_user_id,
                'role': self.actor_role,
                'username': details.get('actor_username'),
                'full_name': details.get('actor_name'),
            },
            'target': {
                'label': self.entity_label,
                'username': details.get('target_username'),
                'full_name': details.get('target_name'),
                'role': details.get('target_role'),
            },
        }


class SiteActivityLog(db.Model):
    """Per-request API activity (authenticated and anonymous) for the site-wide access trail."""

    __tablename__ = 'site_activity_logs'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True)
    user_role = db.Column(db.String(32), nullable=False, default='anonymous', index=True)
    method = db.Column(db.String(8), nullable=False, index=True)
    path = db.Column(db.String(1024), nullable=False, index=True)
    status_code = db.Column(db.Integer, nullable=False, index=True)
    client_ip = db.Column(db.String(64), nullable=False, default='', index=True)
    created_at = db.Column(
        db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False, index=True
    )

    user = db.relationship('User', backref=db.backref('site_activity_logs', lazy='dynamic'))

    def to_dict(self, *, username: str | None = None) -> dict:
        return {
            'id': self.id,
            'user_id': self.user_id,
            'user_role': self.user_role,
            'method': self.method,
            'path': self.path,
            'status_code': self.status_code,
            'client_ip': self.client_ip,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'user': {
                'id': self.user_id,
                'username': username,
                'role': self.user_role,
            },
        }


class RefreshToken(db.Model):
    __tablename__ = 'refresh_tokens'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    token_id = db.Column(db.String(64), unique=True, nullable=False, index=True)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)

    user = db.relationship('User', back_populates='refresh_tokens')


class SecurityThrottle(db.Model):
    __tablename__ = 'security_throttles'
    __table_args__ = (
        UniqueConstraint('scope', 'subject', 'ip_address', name='uq_security_throttle_scope_subject_ip'),
    )

    id = db.Column(db.Integer, primary_key=True)
    scope = db.Column(db.String(64), nullable=False, index=True)
    subject = db.Column(db.String(255), nullable=False, default='')
    ip_address = db.Column(db.String(64), nullable=False, default='')
    failed_count = db.Column(db.Integer, nullable=False, default=0)
    window_started_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
    blocked_until = db.Column(db.DateTime(timezone=True), nullable=True)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )
