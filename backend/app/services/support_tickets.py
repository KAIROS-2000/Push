from __future__ import annotations

from datetime import UTC, datetime

from ..core.db import db
from ..models.support import SupportTicket, SupportTicketMessage, SupportTicketReadState
from ..models.user import User, UserRole

MESSAGE_BODY_MAX_LENGTH = 2000
MESSAGE_PREVIEW_MAX_LENGTH = 120
SUBJECT_MAX_LENGTH = 80
DESCRIPTION_MAX_LENGTH = 4000
LIST_TICKET_LIMIT = 120
LIST_MESSAGES_LIMIT = 100

_TICKET_CREATOR_ROLES = frozenset({UserRole.STUDENT, UserRole.TEACHER, UserRole.PARENT})
_STAFF_ROLES = frozenset({UserRole.ADMIN, UserRole.SUPERADMIN})

VALID_CATEGORIES = frozenset(
    {
        "technical",
        "account",
        "billing",
        "content",
        "other",
    }
)
VALID_STATUSES = frozenset({"open", "in_progress", "resolved", "closed"})


def _utcnow() -> datetime:
    return datetime.now(UTC)


def iso_timestamp(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()


def _user_payload(user: User | None) -> dict | None:
    if user is None:
        return None
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role.value,
    }


def _preview(message: SupportTicketMessage | None) -> str | None:
    if message is None:
        return None
    body = " ".join((message.body or "").split())
    if len(body) <= MESSAGE_PREVIEW_MAX_LENGTH:
        return body
    return f"{body[: MESSAGE_PREVIEW_MAX_LENGTH - 1].rstrip()}…"


def _read_state(ticket_id: int, user_id: int) -> SupportTicketReadState | None:
    return SupportTicketReadState.query.filter_by(
        ticket_id=ticket_id,
        user_id=user_id,
    ).first()


def _ensure_read_state(ticket_id: int, user_id: int) -> SupportTicketReadState:
    state = _read_state(ticket_id, user_id)
    if state is not None:
        return state
    state = SupportTicketReadState(ticket_id=ticket_id, user_id=user_id)
    db.session.add(state)
    db.session.flush()
    return state


def unread_for_ticket(ticket: SupportTicket, user_id: int) -> int:
    state = _read_state(ticket.id, user_id)
    query = SupportTicketMessage.query.filter(
        SupportTicketMessage.ticket_id == ticket.id,
        SupportTicketMessage.sender_id != user_id,
    )
    if state and state.last_read_message_id:
        query = query.filter(SupportTicketMessage.id > state.last_read_message_id)
    return query.count()


def _latest_message(ticket: SupportTicket) -> SupportTicketMessage | None:
    return (
        SupportTicketMessage.query.filter_by(ticket_id=ticket.id)
        .order_by(SupportTicketMessage.id.desc())
        .first()
    )


def ticket_peer_summary(ticket: SupportTicket, *, viewer_id: int) -> dict:
    latest = _latest_message(ticket)
    return {
        "ticket_id": ticket.id,
        "category": ticket.category,
        "subject": ticket.subject,
        "status": ticket.status,
        "created_at": iso_timestamp(ticket.created_at),
        "updated_at": iso_timestamp(ticket.updated_at),
        "unread_count": unread_for_ticket(ticket, viewer_id),
        "latest_message_at": iso_timestamp(latest.created_at) if latest else None,
        "latest_message_preview": _preview(latest),
    }


def user_inbox_summary(user: User) -> dict:
    if user.role not in _TICKET_CREATOR_ROLES:
        return {"total_unread": 0, "tickets": []}

    tickets = (
        SupportTicket.query.filter_by(user_id=user.id)
        .order_by(SupportTicket.updated_at.desc(), SupportTicket.id.desc())
        .limit(LIST_TICKET_LIMIT)
        .all()
    )
    rows = [ticket_peer_summary(t, viewer_id=user.id) for t in tickets]
    total_unread = sum(int(r["unread_count"] or 0) for r in rows)
    return {"total_unread": total_unread, "tickets": rows}


def _can_access_ticket(user: User, ticket: SupportTicket) -> bool:
    if user.role in _STAFF_ROLES:
        return True
    return user.role in _TICKET_CREATOR_ROLES and ticket.user_id == user.id


def get_ticket_for(user: User, ticket_id: int) -> tuple[SupportTicket | None, str | None]:
    ticket = db.session.get(SupportTicket, ticket_id)
    if ticket is None:
        return None, "not_found"
    if not _can_access_ticket(user, ticket):
        return None, "forbidden"
    return ticket, None


def ticket_detail_payload(user: User, ticket: SupportTicket) -> dict:
    owner = ticket.user
    base = {
        "id": ticket.id,
        "category": ticket.category,
        "subject": ticket.subject,
        "description": ticket.description,
        "status": ticket.status,
        "created_at": iso_timestamp(ticket.created_at),
        "updated_at": iso_timestamp(ticket.updated_at),
    }
    if user.role in _STAFF_ROLES:
        base["user"] = _user_payload(owner)
    return {"ticket": base}


def message_payload(message: SupportTicketMessage, viewer: User) -> dict:
    sender = message.sender
    return {
        "id": message.id,
        "ticket_id": message.ticket_id,
        "sender_id": message.sender_id,
        "sender": _user_payload(sender),
        "sender_name": sender.full_name if sender else None,
        "sender_role": sender.role.value if sender else None,
        "body": message.body,
        "created_at": iso_timestamp(message.created_at),
        "is_own": bool(message.sender_id == viewer.id),
    }


def create_ticket(
    user: User,
    *,
    category: str,
    subject: str,
    description: str,
) -> SupportTicket | tuple[dict, int]:
    if user.role not in _TICKET_CREATOR_ROLES:
        return {"message": "Обращения доступны ученикам, учителям и родителям."}, 403

    cat = str(category or "").strip().lower()
    if cat not in VALID_CATEGORIES:
        return {"message": "Укажите корректную категорию обращения.", "valid": sorted(VALID_CATEGORIES)}, 400

    sub = str(subject or "").strip()
    if not sub:
        return {"message": "Тема обязательна."}, 400
    if len(sub) > SUBJECT_MAX_LENGTH:
        return {"message": f"Тема не длиннее {SUBJECT_MAX_LENGTH} символов."}, 400

    desc = str(description or "").strip()
    if not desc:
        return {"message": "Опишите проблему подробнее."}, 400
    if len(desc) > DESCRIPTION_MAX_LENGTH:
        return {
            "message": f"Описание не длиннее {DESCRIPTION_MAX_LENGTH} символов.",
        }, 400

    ticket = SupportTicket(
        user_id=user.id,
        category=cat,
        subject=sub,
        description=desc,
        status="open",
    )
    db.session.add(ticket)
    db.session.flush()
    return ticket


def list_ticket_messages(
    user: User,
    ticket: SupportTicket,
    *,
    limit: int,
    before_id: int | None,
) -> list[SupportTicketMessage]:
    query = SupportTicketMessage.query.filter_by(ticket_id=ticket.id)
    if before_id is not None:
        query = query.filter(SupportTicketMessage.id < before_id)
    messages = query.order_by(SupportTicketMessage.id.desc()).limit(limit).all()
    messages.reverse()
    return messages


def append_message(
    user: User,
    ticket: SupportTicket,
    body: str,
) -> tuple[SupportTicketMessage | None, tuple[dict, int] | None]:
    text_body = str(body or "").strip()
    if not text_body:
        return None, ({"message": "Текст сообщения обязателен."}, 400)
    if len(text_body) > MESSAGE_BODY_MAX_LENGTH:
        return None, (
            {
                "message": f"Сообщение не длиннее {MESSAGE_BODY_MAX_LENGTH} символов.",
                "max_length": MESSAGE_BODY_MAX_LENGTH,
            },
            400,
        )

    if user.role in _STAFF_ROLES:
        if ticket.status == "open":
            ticket.status = "in_progress"
    else:
        if ticket.user_id != user.id:
            return None, ({"message": "Forbidden"}, 403)
        if ticket.status == "closed":
            return None, (
                {"message": "Обращение закрыто. Напишите в поддержку через форму, если нужна новая тема."},
                400,
            )

    message = SupportTicketMessage(
        ticket_id=ticket.id,
        sender_id=user.id,
        body=text_body,
    )
    ticket.updated_at = _utcnow()
    db.session.add(message)
    db.session.flush()
    return message, None


def mark_read(user: User, ticket: SupportTicket, last_message_id: int | None) -> dict:
    if last_message_id is None:
        target = _latest_message(ticket)
    else:
        target = db.session.get(SupportTicketMessage, last_message_id)
        if target is None or target.ticket_id != ticket.id:
            return {"error": ("last_message_id не относится к этому обращению.", 400)}

    state = _ensure_read_state(ticket.id, user.id)
    if target is not None and (
        state.last_read_message_id is None or target.id > state.last_read_message_id
    ):
        state.last_read_message_id = target.id
        state.updated_at = _utcnow()

    return {
        "ticket_id": ticket.id,
        "last_read_message_id": state.last_read_message_id,
        "unread_count": unread_for_ticket(ticket, user.id),
        "updated_at": iso_timestamp(state.updated_at),
    }


def staff_list_tickets(*, status_filter: str | None, limit: int) -> list[SupportTicket]:
    q = SupportTicket.query
    sf = (status_filter or "all").strip().lower()
    if sf != "all":
        if sf not in VALID_STATUSES:
            return []
        q = q.filter(SupportTicket.status == sf)
    return q.order_by(SupportTicket.updated_at.desc(), SupportTicket.id.desc()).limit(limit).all()


def staff_set_status(
    staff: User,
    ticket: SupportTicket,
    new_status: str,
) -> tuple[SupportTicket | None, tuple[dict, int] | None]:
    if staff.role not in _STAFF_ROLES:
        return None, ({"message": "Forbidden"}, 403)
    status = str(new_status or "").strip().lower()
    if status not in VALID_STATUSES:
        return None, (
            {"message": "Некорректный статус.", "valid": sorted(VALID_STATUSES)},
            400,
        )
    ticket.status = status
    ticket.updated_at = _utcnow()
    return ticket, None


def staff_inbox_summary(viewer: User) -> dict:
    """Unread counts for staff: messages in tickets from users (not own messages)."""

    if viewer.role not in _STAFF_ROLES:
        return {"total_unread": 0}

    tickets = (
        SupportTicket.query.order_by(SupportTicket.updated_at.desc(), SupportTicket.id.desc())
        .limit(LIST_TICKET_LIMIT)
        .all()
    )
    total = sum(unread_for_ticket(t, viewer.id) for t in tickets)
    return {"total_unread": total}


def staff_ticket_rows(viewer: User, *, status_filter: str | None = None) -> list[dict]:
    tickets = staff_list_tickets(status_filter=status_filter, limit=LIST_TICKET_LIMIT)
    rows = []
    for t in tickets:
        owner = t.user
        latest = _latest_message(t)
        rows.append(
            {
                "ticket_id": t.id,
                "category": t.category,
                "subject": t.subject,
                "status": t.status,
                "created_at": iso_timestamp(t.created_at),
                "updated_at": iso_timestamp(t.updated_at),
                "user": _user_payload(owner),
                "unread_count": unread_for_ticket(t, viewer.id),
                "latest_message_at": iso_timestamp(latest.created_at) if latest else None,
                "latest_message_preview": _preview(latest),
            }
        )
    return rows
