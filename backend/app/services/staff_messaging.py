from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError

from ..core.db import db
from ..models.staff_messaging import StaffDirectMessage, StaffDirectReadState, StaffDirectThread
from ..models.user import TEACHER_APPROVAL_APPROVED, User, UserRole

MESSAGE_BODY_MAX_LENGTH = 400
MESSAGE_PREVIEW_MAX_LENGTH = 120
SUMMARY_THREAD_LIMIT = 300
SEARCH_RESULTS_LIMIT = 20
DIRECTORY_USER_LIMIT = 2000

_STAFF_ROLES = frozenset({UserRole.ADMIN, UserRole.SUPERADMIN})


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()


def ordered_user_pair(a: int, b: int) -> tuple[int, int]:
    return (a, b) if a < b else (b, a)


def is_privileged_messaging_user(user: User) -> bool:
    return user.role in _STAFF_ROLES


def _user_payload(u: User | None) -> dict | None:
    if u is None:
        return None
    return {
        "id": u.id,
        "username": u.username,
        "full_name": u.full_name,
        "role": u.role.value,
    }


def _other_user_id(thread: StaffDirectThread, current_id: int) -> int:
    if thread.user_low_id == current_id:
        return thread.user_high_id
    if thread.user_high_id == current_id:
        return thread.user_low_id
    raise ValueError("User is not a participant in this thread")


def _read_state(thread_id: int, user_id: int) -> StaffDirectReadState | None:
    return StaffDirectReadState.query.filter_by(
        thread_id=thread_id,
        user_id=user_id,
    ).first()


def _ensure_read_state(thread_id: int, user_id: int) -> StaffDirectReadState:
    state = _read_state(thread_id, user_id)
    if state is not None:
        return state
    state = StaffDirectReadState(thread_id=thread_id, user_id=user_id)
    db.session.add(state)
    db.session.flush()
    return state


def _unread_count(thread: StaffDirectThread, user_id: int) -> int:
    state = _read_state(thread.id, user_id)
    query = StaffDirectMessage.query.filter(
        StaffDirectMessage.thread_id == thread.id,
        StaffDirectMessage.sender_id != user_id,
    )
    if state and state.last_read_message_id:
        query = query.filter(StaffDirectMessage.id > state.last_read_message_id)
    return query.count()


def _latest_message(thread: StaffDirectThread) -> StaffDirectMessage | None:
    return (
        StaffDirectMessage.query.filter_by(thread_id=thread.id)
        .order_by(StaffDirectMessage.id.desc())
        .first()
    )


def _preview(message: StaffDirectMessage | None) -> str | None:
    if message is None:
        return None
    body = " ".join((message.body or "").split())
    if len(body) <= MESSAGE_PREVIEW_MAX_LENGTH:
        return body
    return f"{body[: MESSAGE_PREVIEW_MAX_LENGTH - 1].rstrip()}…"


def get_thread_by_id(thread_id: int) -> StaffDirectThread | None:
    return db.session.get(StaffDirectThread, thread_id)


def user_can_access_thread(user: User, thread: StaffDirectThread) -> bool:
    return user.id in (thread.user_low_id, thread.user_high_id)


def _get_or_create_thread(user_low: int, user_high: int) -> tuple[StaffDirectThread, bool]:
    if user_low >= user_high:
        raise ValueError("user_low_id must be less than user_high_id")
    existing = StaffDirectThread.query.filter_by(
        user_low_id=user_low,
        user_high_id=user_high,
    ).first()
    if existing is not None:
        return existing, False
    thread = StaffDirectThread(user_low_id=user_low, user_high_id=user_high)
    db.session.add(thread)
    try:
        db.session.flush()
    except IntegrityError:
        db.session.rollback()
        existing = StaffDirectThread.query.filter_by(
            user_low_id=user_low,
            user_high_id=user_high,
        ).first()
        if existing is None:
            raise
        return existing, False
    return thread, True


def _thread_row_for(
    thread: StaffDirectThread,
    current: User,
    *,
    other: User,
) -> dict:
    latest = _latest_message(thread)
    return {
        "thread_id": thread.id,
        "other": _user_payload(other),
        "unread_count": _unread_count(thread, current.id),
        "latest_message_at": _iso(latest.created_at) if latest else None,
        "latest_message_preview": _preview(latest),
    }


def _threads_for_user(current: User) -> list[StaffDirectThread]:
    return (
        StaffDirectThread.query.filter(
            or_(
                StaffDirectThread.user_low_id == current.id,
                StaffDirectThread.user_high_id == current.id,
            )
        )
        .order_by(StaffDirectThread.updated_at.desc(), StaffDirectThread.id.desc())
        .limit(SUMMARY_THREAD_LIMIT)
        .all()
    )


def peer_threads_summary_block(current: User) -> dict:
    if current.role not in {UserRole.STUDENT, UserRole.TEACHER, UserRole.PARENT}:
        return {"total_unread": 0, "threads": []}
    rows: list[dict] = []
    total = 0
    for thread in _threads_for_user(current):
        other_id = _other_user_id(thread, current.id)
        other = db.session.get(User, other_id)
        if other is None:
            continue
        u = _unread_count(thread, current.id)
        total += u
        rows.append(_thread_row_for(thread, current, other=other))
    return {"total_unread": total, "threads": rows}


def staff_inbox_summary(current: User) -> dict:
    if not is_privileged_messaging_user(current):
        return {"total_unread": 0, "threads": [], "directory": {"teachers": [], "staff": []}}
    rows: list[dict] = []
    total = 0
    for thread in _threads_for_user(current):
        other_id = _other_user_id(thread, current.id)
        other = db.session.get(User, other_id)
        if other is None:
            continue
        u = _unread_count(thread, current.id)
        total += u
        rows.append(_thread_row_for(thread, current, other=other))
    directory = _directory_listings(current)
    return {"total_unread": total, "threads": rows, "directory": directory}


def _directory_listings(current: User) -> dict:
    teachers = (
        User.query.filter(
            User.role == UserRole.TEACHER,
            User.is_active.is_(True),
            User.teacher_approval_status == TEACHER_APPROVAL_APPROVED,
            User.id != current.id,
        )
        .order_by(User.full_name.asc(), User.username.asc(), User.id.asc())
        .limit(DIRECTORY_USER_LIMIT)
        .all()
    )
    staff = (
        User.query.filter(
            User.role.in_((UserRole.ADMIN, UserRole.SUPERADMIN)),
            User.is_active.is_(True),
            User.id != current.id,
        )
        .order_by(User.full_name.asc(), User.username.asc(), User.id.asc())
        .limit(DIRECTORY_USER_LIMIT)
        .all()
    )
    return {
        "teachers": [_user_payload(u) for u in teachers],
        "staff": [_user_payload(u) for u in staff],
    }


def search_users_by_login(current: User, q: str) -> list[User]:
    if not is_privileged_messaging_user(current):
        return []
    q = (q or "").strip()
    if len(q) < 2:
        return []
    like = f"%{q}%"
    return (
        User.query.filter(
            User.is_active.is_(True),
            User.id != current.id,
            User.username.ilike(like),
        )
        .order_by(User.username.asc(), User.id.asc())
        .limit(SEARCH_RESULTS_LIMIT)
        .all()
    )


def start_thread_with_message_from_staff(
    staff: User, *, peer_id: int, body: str
) -> tuple[StaffDirectMessage, StaffDirectThread]:
    if not is_privileged_messaging_user(staff):
        raise PermissionError("Only admin or superadmin can start a direct thread.")
    if peer_id == staff.id:
        raise ValueError("Cannot message yourself.")
    peer = db.session.get(User, peer_id)
    if peer is None or not peer.is_active:
        raise ValueError("User not found.")

    body = (body or "").strip()
    if not body:
        raise ValueError("Message body is required.")
    if len(body) > MESSAGE_BODY_MAX_LENGTH:
        raise ValueError("Message body is too long.")

    low, high = ordered_user_pair(staff.id, peer_id)
    thread, _created = _get_or_create_thread(low, high)
    message = StaffDirectMessage(thread_id=thread.id, sender_id=staff.id, body=body)
    thread.updated_at = _utcnow()
    db.session.add(message)
    db.session.flush()
    return message, thread


def add_message(
    current: User, thread: StaffDirectThread, body: str
) -> tuple[StaffDirectMessage, StaffDirectThread]:
    if not user_can_access_thread(current, thread):
        raise PermissionError("Forbidden")
    body = (body or "").strip()
    if not body:
        raise ValueError("Message body is required.")
    if len(body) > MESSAGE_BODY_MAX_LENGTH:
        raise ValueError("Message body is too long.")

    message = StaffDirectMessage(thread_id=thread.id, sender_id=current.id, body=body)
    thread.updated_at = _utcnow()
    db.session.add(message)
    db.session.flush()
    return message, thread


def list_messages(
    current: User, thread: StaffDirectThread, *, limit: int, before_id: int | None
) -> list[StaffDirectMessage]:
    if not user_can_access_thread(current, thread):
        raise PermissionError("Forbidden")
    q = StaffDirectMessage.query.filter_by(thread_id=thread.id)
    if before_id is not None:
        q = q.filter(StaffDirectMessage.id < before_id)
    messages = q.order_by(StaffDirectMessage.id.desc()).limit(limit).all()
    messages.reverse()
    return messages


def mark_read(
    current: User, thread: StaffDirectThread, last_message_id: int | None
) -> StaffDirectReadState:
    if not user_can_access_thread(current, thread):
        raise PermissionError("Forbidden")
    if last_message_id is None:
        target = _latest_message(thread)
    else:
        target = db.session.get(StaffDirectMessage, last_message_id)
        if target is None or target.thread_id != thread.id:
            raise ValueError("Message does not belong to this thread.")
    state = _ensure_read_state(thread.id, current.id)
    if target is not None and (state.last_read_message_id is None or target.id > state.last_read_message_id):
        state.last_read_message_id = target.id
        state.updated_at = _utcnow()
    return state
