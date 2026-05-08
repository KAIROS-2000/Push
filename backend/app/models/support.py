from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Index, UniqueConstraint

from ..core.db import db


class SupportTicket(db.Model):
    __tablename__ = "support_tickets"
    __table_args__ = (
        Index("ix_support_ticket_user", "user_id"),
        Index("ix_support_ticket_status", "status"),
        Index("ix_support_ticket_updated_at", "updated_at"),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    category = db.Column(db.String(40), nullable=False)
    subject = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(24), nullable=False, default="open")
    created_at = db.Column(
        db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    user = db.relationship("User", foreign_keys=[user_id])
    messages = db.relationship(
        "SupportTicketMessage",
        back_populates="ticket",
        cascade="all, delete-orphan",
        order_by="SupportTicketMessage.id",
    )
    read_states = db.relationship(
        "SupportTicketReadState",
        back_populates="ticket",
        cascade="all, delete-orphan",
    )


class SupportTicketMessage(db.Model):
    __tablename__ = "support_ticket_messages"
    __table_args__ = (
        Index("ix_support_ticket_message_ticket", "ticket_id"),
        Index("ix_support_ticket_message_sender", "sender_id"),
        Index(
            "ix_support_ticket_message_ticket_created",
            "ticket_id",
            "created_at",
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    ticket_id = db.Column(db.Integer, db.ForeignKey("support_tickets.id"), nullable=False)
    sender_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    body = db.Column(db.Text, nullable=False)
    created_at = db.Column(
        db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )

    ticket = db.relationship("SupportTicket", back_populates="messages")
    sender = db.relationship("User", foreign_keys=[sender_id])


class SupportTicketReadState(db.Model):
    __tablename__ = "support_ticket_read_states"
    __table_args__ = (
        UniqueConstraint(
            "ticket_id",
            "user_id",
            name="uq_support_ticket_read_ticket_user",
        ),
        Index("ix_support_ticket_read_ticket", "ticket_id"),
        Index("ix_support_ticket_read_user", "user_id"),
    )

    id = db.Column(db.Integer, primary_key=True)
    ticket_id = db.Column(db.Integer, db.ForeignKey("support_tickets.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    last_read_message_id = db.Column(
        db.Integer, db.ForeignKey("support_ticket_messages.id"), nullable=True
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    ticket = db.relationship("SupportTicket", back_populates="read_states")
    user = db.relationship("User", foreign_keys=[user_id])
    last_read_message = db.relationship(
        "SupportTicketMessage",
        foreign_keys=[last_read_message_id],
    )
