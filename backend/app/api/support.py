from __future__ import annotations

from flask import Blueprint, request

from ..core.db import db
from ..core.security import auth_required
from ..models.user import User, UserRole
from ..services import support_tickets as svc

support_bp = Blueprint("support", __name__)

_TICKET_CREATORS = [UserRole.STUDENT, UserRole.TEACHER, UserRole.PARENT]
_STAFF = [UserRole.ADMIN, UserRole.SUPERADMIN]


def _parse_positive_int(value) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _safe_limit(value, *, default: int = 50, maximum: int = 100) -> int:
    parsed = _parse_positive_int(value)
    if parsed is None:
        return default
    return min(parsed, maximum)


@support_bp.post("/tickets")
@auth_required(_TICKET_CREATORS)
def create_ticket(user: User):
    data = request.get_json(silent=True) or {}
    result = svc.create_ticket(
        user,
        category=str(data.get("category") or ""),
        subject=str(data.get("subject") or ""),
        description=str(data.get("description") or ""),
    )
    if isinstance(result, tuple):
        payload, status = result
        return payload, status
    ticket = result
    db.session.commit()
    return {
        "ticket": svc.ticket_peer_summary(ticket, viewer_id=user.id),
        "detail": svc.ticket_detail_payload(user, ticket),
    }, 201


@support_bp.get("/tickets")
@auth_required(_TICKET_CREATORS)
def list_my_tickets(user: User):
    return svc.user_inbox_summary(user)


@support_bp.get("/tickets/<int:ticket_id>")
@auth_required()
def get_ticket(user: User, ticket_id: int):
    ticket, err = svc.get_ticket_for(user, ticket_id)
    if err == "not_found":
        return {"message": "Обращение не найдено."}, 404
    if err == "forbidden":
        return {"message": "Forbidden"}, 403
    assert ticket is not None
    detail = svc.ticket_detail_payload(user, ticket)
    limit = _safe_limit(request.args.get("limit"), default=80, maximum=svc.LIST_MESSAGES_LIMIT)
    before_id = _parse_positive_int(request.args.get("before_id"))
    messages = svc.list_ticket_messages(user, ticket, limit=limit, before_id=before_id)
    return {
        **detail,
        "messages": [svc.message_payload(m, user) for m in messages],
        "limit": limit,
        "before_id": before_id,
    }


@support_bp.post("/tickets/<int:ticket_id>/messages")
@auth_required()
def post_ticket_message(user: User, ticket_id: int):
    ticket, err = svc.get_ticket_for(user, ticket_id)
    if err == "not_found":
        return {"message": "Обращение не найдено."}, 404
    if err == "forbidden":
        return {"message": "Forbidden"}, 403
    assert ticket is not None

    data = request.get_json(silent=True) or {}
    message, error = svc.append_message(user, ticket, str(data.get("body") or ""))
    if error:
        payload, status = error
        return payload, status
    assert message is not None
    db.session.commit()
    return {
        "message": svc.message_payload(message, user),
        "ticket": svc.ticket_peer_summary(ticket, viewer_id=user.id),
    }, 201


@support_bp.post("/tickets/<int:ticket_id>/read")
@auth_required()
def post_ticket_read(user: User, ticket_id: int):
    ticket, err = svc.get_ticket_for(user, ticket_id)
    if err == "not_found":
        return {"message": "Обращение не найдено."}, 404
    if err == "forbidden":
        return {"message": "Forbidden"}, 403
    assert ticket is not None

    data = request.get_json(silent=True) or {}
    raw = data.get("last_message_id")
    last_id = _parse_positive_int(raw) if raw is not None else None

    result = svc.mark_read(user, ticket, last_id)
    if "error" in result:
        payload, status = result["error"]
        return payload, status
    db.session.commit()
    out = {k: v for k, v in result.items() if k != "error"}
    return out


@support_bp.get("/staff/tickets")
@auth_required(_STAFF)
def staff_list(user: User):
    status_filter = str(request.args.get("status") or "all")
    rows = svc.staff_ticket_rows(user, status_filter=status_filter)
    total_unread = svc.staff_inbox_summary(user)["total_unread"]
    return {"total_unread": total_unread, "tickets": rows}


@support_bp.get("/staff/tickets/<int:ticket_id>")
@auth_required(_STAFF)
def staff_get_ticket(user: User, ticket_id: int):
    ticket, err = svc.get_ticket_for(user, ticket_id)
    if err == "not_found":
        return {"message": "Обращение не найдено."}, 404
    assert ticket is not None
    detail = svc.ticket_detail_payload(user, ticket)
    limit = _safe_limit(request.args.get("limit"), default=80, maximum=svc.LIST_MESSAGES_LIMIT)
    before_id = _parse_positive_int(request.args.get("before_id"))
    messages = svc.list_ticket_messages(user, ticket, limit=limit, before_id=before_id)
    return {
        **detail,
        "messages": [svc.message_payload(m, user) for m in messages],
        "limit": limit,
        "before_id": before_id,
    }


@support_bp.patch("/staff/tickets/<int:ticket_id>")
@auth_required(_STAFF)
def staff_patch_ticket(user: User, ticket_id: int):
    ticket, err = svc.get_ticket_for(user, ticket_id)
    if err == "not_found":
        return {"message": "Обращение не найдено."}, 404
    assert ticket is not None

    data = request.get_json(silent=True) or {}
    _, error = svc.staff_set_status(user, ticket, str(data.get("status") or ""))
    if error:
        payload, status = error
        return payload, status
    db.session.commit()
    return {
        "ticket": {
            "id": ticket.id,
            "status": ticket.status,
            "updated_at": svc.iso_timestamp(ticket.updated_at),
        }
    }


@support_bp.post("/staff/tickets/<int:ticket_id>/messages")
@auth_required(_STAFF)
def staff_post_message(user: User, ticket_id: int):
    ticket, err = svc.get_ticket_for(user, ticket_id)
    if err == "not_found":
        return {"message": "Обращение не найдено."}, 404
    assert ticket is not None

    data = request.get_json(silent=True) or {}
    message, error = svc.append_message(user, ticket, str(data.get("body") or ""))
    if error:
        payload, status = error
        return payload, status
    assert message is not None
    db.session.commit()
    return {
        "message": svc.message_payload(message, user),
        "ticket_summary": {
            "ticket_id": ticket.id,
            "status": ticket.status,
            "subject": ticket.subject,
            "updated_at": svc.iso_timestamp(ticket.updated_at),
        },
    }, 201
