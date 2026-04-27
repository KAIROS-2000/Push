from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Index, UniqueConstraint

from ..core.db import db


class StaffDirectThread(db.Model):
    """1:1 thread between two users; user_low_id < user_high_id."""

    __tablename__ = "staff_direct_threads"
    __table_args__ = (
        UniqueConstraint(
            "user_low_id",
            "user_high_id",
            name="uq_staff_direct_user_pair",
        ),
        Index("ix_staff_direct_thread_low", "user_low_id"),
        Index("ix_staff_direct_thread_high", "user_high_id"),
        Index("ix_staff_direct_thread_updated_at", "updated_at"),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_low_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    user_high_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(
        db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    user_low = db.relationship("User", foreign_keys=[user_low_id])
    user_high = db.relationship("User", foreign_keys=[user_high_id])
    messages = db.relationship(
        "StaffDirectMessage",
        back_populates="thread",
        cascade="all, delete-orphan",
        order_by="StaffDirectMessage.id",
    )
    read_states = db.relationship(
        "StaffDirectReadState",
        back_populates="thread",
        cascade="all, delete-orphan",
    )


class StaffDirectMessage(db.Model):
    __tablename__ = "staff_direct_messages"
    __table_args__ = (
        Index("ix_staff_direct_message_thread", "thread_id"),
        Index("ix_staff_direct_message_sender", "sender_id"),
        Index("ix_staff_direct_message_thread_created", "thread_id", "created_at"),
        Index("ix_staff_direct_message_thread_id", "thread_id", "id"),
    )

    id = db.Column(db.Integer, primary_key=True)
    thread_id = db.Column(db.Integer, db.ForeignKey("staff_direct_threads.id"), nullable=False)
    sender_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    body = db.Column(db.Text, nullable=False)
    created_at = db.Column(
        db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )

    thread = db.relationship("StaffDirectThread", back_populates="messages")
    sender = db.relationship("User", foreign_keys=[sender_id])


class StaffDirectReadState(db.Model):
    __tablename__ = "staff_direct_read_states"
    __table_args__ = (
        UniqueConstraint(
            "thread_id",
            "user_id",
            name="uq_staff_direct_read_thread_user",
        ),
        Index("ix_staff_direct_read_thread", "thread_id"),
        Index("ix_staff_direct_read_user", "user_id"),
        Index("ix_staff_direct_read_user_thread", "user_id", "thread_id"),
    )

    id = db.Column(db.Integer, primary_key=True)
    thread_id = db.Column(db.Integer, db.ForeignKey("staff_direct_threads.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    last_read_message_id = db.Column(db.Integer, db.ForeignKey("staff_direct_messages.id"), nullable=True)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    thread = db.relationship("StaffDirectThread", back_populates="read_states")
    user = db.relationship("User", foreign_keys=[user_id])
    last_read_message = db.relationship("StaffDirectMessage", foreign_keys=[last_read_message_id])
