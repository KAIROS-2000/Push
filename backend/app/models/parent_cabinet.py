from __future__ import annotations

from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

from sqlalchemy import Index, UniqueConstraint

from ..core.db import db


class ParentNotificationType(StrEnum):
    ACHIEVEMENT = "achievement"
    LESSON = "lesson"
    ASSIGNMENT = "assignment"
    FEEDBACK = "feedback"
    DIGEST = "digest"
    INFO = "info"


class ParentChildLink(db.Model):
    __tablename__ = "parent_child_links"
    __table_args__ = (
        UniqueConstraint("parent_user_id", "child_user_id", name="uq_parent_child_link"),
        Index("ix_parent_child_parent", "parent_user_id", "active"),
        Index("ix_parent_child_child", "child_user_id", "active"),
    )

    id = db.Column(db.Integer, primary_key=True)
    parent_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    child_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    relationship_label = db.Column(db.String(64), nullable=True)
    active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )
    revoked_at = db.Column(db.DateTime(timezone=True), nullable=True)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "parent_user_id": self.parent_user_id,
            "child_user_id": self.child_user_id,
            "relationship_label": self.relationship_label,
            "active": self.active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "revoked_at": self.revoked_at.isoformat() if self.revoked_at else None,
        }


class ParentLinkCode(db.Model):
    """One-time child-generated codes; only code_hash is stored at rest."""

    __tablename__ = "parent_link_codes"
    __table_args__ = (Index("ix_parent_link_code_child", "child_user_id", "used_at"),)

    id = db.Column(db.Integer, primary_key=True)
    child_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    code_hash = db.Column(db.String(64), nullable=False, index=True)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False, index=True)
    used_at = db.Column(db.DateTime(timezone=True), nullable=True)
    revoked_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    @staticmethod
    def default_expiry() -> datetime:
        return datetime.now(UTC) + timedelta(days=7)


class ParentSafetySettings(db.Model):
    __tablename__ = "parent_safety_settings"
    __table_args__ = (
        UniqueConstraint("parent_user_id", "child_user_id", name="uq_parent_safety_parent_child"),
    )

    id = db.Column(db.Integer, primary_key=True)
    parent_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    child_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    weekly_screen_time_limit_minutes = db.Column(db.Integer, nullable=True)
    daily_screen_time_limit_minutes = db.Column(db.Integer, nullable=True)
    hide_child_public_profile = db.Column(db.Boolean, nullable=False, default=False)
    allow_achievement_sharing = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )


class ParentConsentSettings(db.Model):
    __tablename__ = "parent_consent_settings"
    __table_args__ = (UniqueConstraint("parent_user_id", "child_user_id", name="uq_parent_consent_parent_child"),)

    id = db.Column(db.Integer, primary_key=True)
    parent_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    child_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    allow_notifications = db.Column(db.Boolean, nullable=False, default=True)
    allow_browser_notifications = db.Column(db.Boolean, nullable=False, default=False)
    allow_achievement_sharing = db.Column(db.Boolean, nullable=False, default=True)
    allow_learning_analytics_display = db.Column(db.Boolean, nullable=False, default=True)
    allow_parent_teacher_communication = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )


class ParentNotification(db.Model):
    __tablename__ = "parent_notifications"
    __table_args__ = (Index("ix_parent_notifications_parent_created", "parent_user_id", "created_at"),)

    id = db.Column(db.Integer, primary_key=True)
    parent_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    child_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True, index=True)
    title = db.Column(db.String(200), nullable=False)
    body = db.Column(db.Text, nullable=False)
    type = db.Column(db.String(32), nullable=False, default=ParentNotificationType.INFO.value, index=True)
    href = db.Column(db.String(500), nullable=True)
    read_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False, index=True)


class ParentTeacherThread(db.Model):
    __tablename__ = "parent_teacher_threads"
    __table_args__ = (
        UniqueConstraint(
            "parent_user_id",
            "teacher_id",
            "child_user_id",
            "classroom_id",
            name="uq_parent_teacher_thread_scope",
        ),
        Index("ix_parent_teacher_thread_parent", "parent_user_id", "updated_at"),
        Index("ix_parent_teacher_thread_teacher", "teacher_id", "updated_at"),
    )

    id = db.Column(db.Integer, primary_key=True)
    parent_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    teacher_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    child_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    classroom_id = db.Column(db.Integer, db.ForeignKey("classrooms.id"), nullable=False, index=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    messages = db.relationship(
        "ParentTeacherMessage",
        back_populates="thread",
        cascade="all, delete-orphan",
        order_by="ParentTeacherMessage.id",
    )


class ParentTeacherMessage(db.Model):
    __tablename__ = "parent_teacher_messages"
    __table_args__ = (Index("ix_parent_teacher_msg_thread", "thread_id", "created_at"),)

    id = db.Column(db.Integer, primary_key=True)
    thread_id = db.Column(db.Integer, db.ForeignKey("parent_teacher_threads.id"), nullable=False, index=True)
    sender_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    body = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)

    thread = db.relationship("ParentTeacherThread", back_populates="messages")


class ParentTeacherReadState(db.Model):
    __tablename__ = "parent_teacher_read_states"
    __table_args__ = (
        UniqueConstraint("thread_id", "user_id", name="uq_parent_teacher_read_thread_user"),
    )

    id = db.Column(db.Integer, primary_key=True)
    thread_id = db.Column(db.Integer, db.ForeignKey("parent_teacher_threads.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    last_read_message_id = db.Column(db.Integer, db.ForeignKey("parent_teacher_messages.id"), nullable=True)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )
