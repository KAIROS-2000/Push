from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Index, UniqueConstraint

from ..core.db import db


class Conversation(db.Model):
    __tablename__ = "message_conversations"
    __table_args__ = (
        UniqueConstraint(
            "classroom_id",
            "teacher_id",
            "student_id",
            name="uq_message_conversation_class_teacher_student",
        ),
        Index("ix_message_conversation_classroom", "classroom_id"),
        Index("ix_message_conversation_teacher", "teacher_id"),
        Index("ix_message_conversation_student", "student_id"),
        Index("ix_message_conversation_updated_at", "updated_at"),
    )

    id = db.Column(db.Integer, primary_key=True)
    classroom_id = db.Column(db.Integer, db.ForeignKey("classrooms.id"), nullable=False)
    teacher_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    student_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(
        db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    classroom = db.relationship("Classroom")
    teacher = db.relationship("User", foreign_keys=[teacher_id])
    student = db.relationship("User", foreign_keys=[student_id])
    messages = db.relationship(
        "Message",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.id",
    )
    read_states = db.relationship(
        "ConversationReadState",
        back_populates="conversation",
        cascade="all, delete-orphan",
    )


class Message(db.Model):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_message_conversation_id", "conversation_id"),
        Index("ix_message_sender_id", "sender_id"),
        Index("ix_message_conversation_created_at", "conversation_id", "created_at"),
        Index("ix_message_conversation_id_id", "conversation_id", "id"),
    )

    id = db.Column(db.Integer, primary_key=True)
    conversation_id = db.Column(
        db.Integer, db.ForeignKey("message_conversations.id"), nullable=False
    )
    sender_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    body = db.Column(db.Text, nullable=False)
    created_at = db.Column(
        db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )

    conversation = db.relationship("Conversation", back_populates="messages")
    sender = db.relationship("User", foreign_keys=[sender_id])


class ConversationReadState(db.Model):
    __tablename__ = "conversation_read_states"
    __table_args__ = (
        UniqueConstraint(
            "conversation_id",
            "user_id",
            name="uq_conversation_read_state_conversation_user",
        ),
        Index("ix_conversation_read_state_conversation", "conversation_id"),
        Index("ix_conversation_read_state_user", "user_id"),
        Index("ix_conversation_read_state_user_conversation", "user_id", "conversation_id"),
    )

    id = db.Column(db.Integer, primary_key=True)
    conversation_id = db.Column(
        db.Integer, db.ForeignKey("message_conversations.id"), nullable=False
    )
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    last_read_message_id = db.Column(
        db.Integer, db.ForeignKey("messages.id"), nullable=True
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    conversation = db.relationship("Conversation", back_populates="read_states")
    user = db.relationship("User", foreign_keys=[user_id])
    last_read_message = db.relationship("Message", foreign_keys=[last_read_message_id])
