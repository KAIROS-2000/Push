from __future__ import annotations

from flask import Blueprint, request

from ..core.db import db
from ..core.security import auth_required
from ..models.staff_messaging import StaffDirectMessage
from ..models.user import User, UserRole
from ..services import staff_messaging as sm

staff_messaging_bp = Blueprint("staff_messaging", __name__)


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


def _message_dict(message: StaffDirectMessage, current: User) -> dict:
    sender = message.sender
    return {
        "id": message.id,
        "thread_id": message.thread_id,
        "sender_id": message.sender_id,
        "sender": sm._user_payload(sender) if sender else None,
        "sender_name": sender.full_name if sender else None,
        "sender_role": sender.role.value if sender else None,
        "body": message.body,
        "created_at": sm._iso(message.created_at),
        "is_own": bool(message.sender_id == current.id),
    }


@staff_messaging_bp.get("/summary")
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def staff_summary(user: User):
    return sm.staff_inbox_summary(user)


@staff_messaging_bp.get("/search-users")
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def search_users(user: User):
    q = str(request.args.get("q") or "")
    found = sm.search_users_by_login(user, q)
    return {"users": [sm._user_payload(u) for u in found]}


@staff_messaging_bp.post("/threads")
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def start_thread(user: User):
    data = request.get_json(silent=True) or {}
    peer_id = _parse_positive_int(data.get("peer_id"))
    body = str(data.get("body") or "")
    if peer_id is None:
        return {"message": "peer_id is required."}, 400
    try:
        message, thread = sm.start_thread_with_message_from_staff(
            user, peer_id=peer_id, body=body
        )
    except PermissionError as exc:
        return {"message": str(exc)}, 403
    except ValueError as exc:
        msg = str(exc)
        if "not found" in msg.lower():
            return {"message": msg}, 404
        return {"message": msg}, 400
    db.session.commit()
    other = db.session.get(User, sm._other_user_id(thread, user.id))
    return {
        "thread": sm._thread_row_for(
            thread,
            user,
            other=other,
        ),
        "message": _message_dict(message, user),
    }, 201


@staff_messaging_bp.get("/threads/<int:thread_id>/messages")
@auth_required()
def list_thread_messages(user: User, thread_id: int):
    thread = sm.get_thread_by_id(thread_id)
    if thread is None:
        return {"message": "Thread not found."}, 404
    if not sm.user_can_access_thread(user, thread):
        return {"message": "Forbidden"}, 403
    limit = _safe_limit(request.args.get("limit"), default=50, maximum=100)
    before_id = _parse_positive_int(request.args.get("before_id"))
    try:
        messages = sm.list_messages(user, thread, limit=limit, before_id=before_id)
    except PermissionError:
        return {"message": "Forbidden"}, 403
    other_id = sm._other_user_id(thread, user.id)
    other = db.session.get(User, other_id)
    return {
        "thread": sm._thread_row_for(thread, user, other=other) if other else None,
        "messages": [_message_dict(m, user) for m in messages],
        "limit": limit,
        "before_id": before_id,
    }


@staff_messaging_bp.post("/threads/<int:thread_id>/messages")
@auth_required()
def post_thread_message(user: User, thread_id: int):
    thread = sm.get_thread_by_id(thread_id)
    if thread is None:
        return {"message": "Thread not found."}, 404
    if not sm.user_can_access_thread(user, thread):
        return {"message": "Forbidden"}, 403
    data = request.get_json(silent=True) or {}
    body = str(data.get("body") or "")
    try:
        message, _updated = sm.add_message(user, thread, body)
    except PermissionError:
        return {"message": "Forbidden"}, 403
    except ValueError as exc:
        return {"message": str(exc)}, 400
    db.session.commit()
    other_id = sm._other_user_id(thread, user.id)
    other = db.session.get(User, other_id)
    return {
        "message": _message_dict(message, user),
        "thread": sm._thread_row_for(thread, user, other=other) if other else None,
    }, 201


@staff_messaging_bp.post("/threads/<int:thread_id>/read")
@auth_required()
def mark_thread_read(user: User, thread_id: int):
    thread = sm.get_thread_by_id(thread_id)
    if thread is None:
        return {"message": "Thread not found."}, 404
    if not sm.user_can_access_thread(user, thread):
        return {"message": "Forbidden"}, 403
    data = request.get_json(silent=True) or {}
    raw = data.get("last_message_id")
    last_id = _parse_positive_int(raw) if raw is not None else None
    try:
        state = sm.mark_read(user, thread, last_id)
    except PermissionError:
        return {"message": "Forbidden"}, 403
    except ValueError as exc:
        return {"message": str(exc)}, 400
    db.session.commit()
    return {
        "thread_id": thread.id,
        "last_read_message_id": state.last_read_message_id,
        "unread_count": sm._unread_count(thread, user.id),
        "updated_at": sm._iso(state.updated_at),
    }
