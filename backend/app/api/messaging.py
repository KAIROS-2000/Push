from __future__ import annotations

from datetime import UTC, datetime

from flask import Blueprint, request
from sqlalchemy.exc import IntegrityError

from ..core.db import db
from ..core.security import auth_required
from ..models.learning import ClassMembership, Classroom
from ..models.messaging import Conversation, ConversationReadState, Message
from ..models.user import User, UserRole
from ..services import staff_messaging as staff_messaging_service
from ..services import support_tickets as support_tickets_service


messaging_bp = Blueprint("messaging", __name__)
MESSAGE_BODY_MAX_LENGTH = 400
MESSAGE_PREVIEW_MAX_LENGTH = 120
SUMMARY_CONVERSATION_LIMIT = 200


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()


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


def _ensure_messaging_role(current_user: User) -> tuple[dict, int] | None:
    if current_user.role not in {UserRole.STUDENT, UserRole.TEACHER}:
        return {"message": "Messaging is available only to teachers and students."}, 403
    return None


def _ensure_messaging_summary_role(current_user: User) -> tuple[dict, int] | None:
    if current_user.role not in {UserRole.STUDENT, UserRole.TEACHER, UserRole.PARENT}:
        return {
            "message": "Messaging summary is available only to teachers, students, and parents.",
        }, 403
    return None


def _membership_exists(classroom_id: int, student_id: int) -> bool:
    return (
        ClassMembership.query.filter_by(
            classroom_id=classroom_id,
            student_id=student_id,
        ).first()
        is not None
    )


def _conversation_is_currently_accessible(
    conversation: Conversation,
    current_user: User,
) -> bool:
    if current_user.role not in {UserRole.STUDENT, UserRole.TEACHER}:
        return False
    if current_user.id not in {conversation.teacher_id, conversation.student_id}:
        return False

    classroom = conversation.classroom
    if classroom is None or classroom.teacher_id != conversation.teacher_id:
        return False
    if not _membership_exists(conversation.classroom_id, conversation.student_id):
        return False

    if current_user.role == UserRole.TEACHER:
        return current_user.id == conversation.teacher_id == classroom.teacher_id
    return current_user.id == conversation.student_id


def _resolve_conversation(
    conversation_id: int,
    current_user: User,
) -> tuple[Conversation | None, tuple[dict, int] | None]:
    role_error = _ensure_messaging_role(current_user)
    if role_error:
        return None, role_error

    conversation = db.session.get(Conversation, conversation_id)
    if conversation is None:
        return None, ({"message": "Conversation not found."}, 404)
    if not _conversation_is_currently_accessible(conversation, current_user):
        return None, ({"message": "Forbidden"}, 403)
    return conversation, None


def _read_state(conversation_id: int, user_id: int) -> ConversationReadState | None:
    return ConversationReadState.query.filter_by(
        conversation_id=conversation_id,
        user_id=user_id,
    ).first()


def _ensure_read_state(conversation_id: int, user_id: int) -> ConversationReadState:
    state = _read_state(conversation_id, user_id)
    if state is not None:
        return state
    state = ConversationReadState(conversation_id=conversation_id, user_id=user_id)
    db.session.add(state)
    db.session.flush()
    return state


def _unread_count(conversation: Conversation, user_id: int) -> int:
    state = _read_state(conversation.id, user_id)
    query = Message.query.filter(
        Message.conversation_id == conversation.id,
        Message.sender_id != user_id,
    )
    if state and state.last_read_message_id:
        query = query.filter(Message.id > state.last_read_message_id)
    return query.count()


def _latest_message(conversation: Conversation) -> Message | None:
    return (
        Message.query.filter_by(conversation_id=conversation.id)
        .order_by(Message.id.desc())
        .first()
    )


def _preview(message: Message | None) -> str | None:
    if message is None:
        return None
    body = " ".join((message.body or "").split())
    if len(body) <= MESSAGE_PREVIEW_MAX_LENGTH:
        return body
    return f"{body[: MESSAGE_PREVIEW_MAX_LENGTH - 1].rstrip()}…"


def _user_payload(user: User | None) -> dict | None:
    """Public-safe identity payload for chat participants.

    SECURITY: ``email`` MUST NOT be included here. Conversations are visible to
    every member of the chat (e.g. a student receives the teacher's payload),
    so leaking the address would enable directory harvesting and account
    enumeration. The owner of an account reads their own email via /auth/me.
    """
    if user is None:
        return None
    return {
        "id": user.id,
        "full_name": user.full_name,
        "role": user.role.value,
    }


def _conversation_metadata(
    conversation: Conversation,
    *,
    current_user: User | None = None,
    include_latest: bool = True,
) -> dict:
    latest = _latest_message(conversation) if include_latest else None
    unread = _unread_count(conversation, current_user.id) if current_user else 0
    payload = {
        "id": conversation.id,
        "conversation_id": conversation.id,
        "classroom_id": conversation.classroom_id,
        "classroom_name": conversation.classroom.name if conversation.classroom else None,
        "teacher_id": conversation.teacher_id,
        "teacher_name": conversation.teacher.full_name if conversation.teacher else None,
        "student_id": conversation.student_id,
        "student_name": conversation.student.full_name if conversation.student else None,
        "created_at": _iso(conversation.created_at),
        "updated_at": _iso(conversation.updated_at),
        "unread_count": unread,
    }
    if include_latest:
        payload.update(
            {
                "latest_message_id": latest.id if latest else None,
                "latest_message_at": _iso(latest.created_at) if latest else None,
                "latest_message_preview": _preview(latest),
                "latest_message_sender_id": latest.sender_id if latest else None,
            }
        )
    return payload


def _message_payload(message: Message, current_user: User | None = None) -> dict:
    return {
        "id": message.id,
        "conversation_id": message.conversation_id,
        "sender_id": message.sender_id,
        "sender": _user_payload(message.sender),
        "sender_name": message.sender.full_name if message.sender else None,
        "sender_role": message.sender.role.value if message.sender else None,
        "body": message.body,
        "created_at": _iso(message.created_at),
        "is_own": bool(current_user and message.sender_id == current_user.id),
    }


def _valid_conversations_for_user(current_user: User) -> list[Conversation]:
    if current_user.role == UserRole.STUDENT:
        query = Conversation.query.filter_by(student_id=current_user.id)
    elif current_user.role == UserRole.TEACHER:
        query = Conversation.query.filter_by(teacher_id=current_user.id)
    else:
        return []

    conversations = query.order_by(Conversation.updated_at.desc(), Conversation.id.desc()).limit(
        SUMMARY_CONVERSATION_LIMIT
    ).all()
    return [
        conversation
        for conversation in conversations
        if _conversation_is_currently_accessible(conversation, current_user)
    ]


def _teacher_summary_classes(
    current_user: User,
    conversations: list[Conversation],
) -> list[dict]:
    conversation_by_pair = {
        (conversation.classroom_id, conversation.student_id): conversation
        for conversation in conversations
    }
    classrooms = (
        Classroom.query.filter_by(teacher_id=current_user.id)
        .order_by(Classroom.created_at.desc(), Classroom.id.desc())
        .all()
    )
    rows: list[dict] = []
    for classroom in classrooms:
        memberships = (
            ClassMembership.query.filter_by(classroom_id=classroom.id)
            .join(User, User.id == ClassMembership.student_id)
            .order_by(User.full_name.asc(), User.email.asc(), User.id.asc())
            .all()
        )
        students = []
        for membership in memberships:
            student = membership.student
            conversation = conversation_by_pair.get((classroom.id, membership.student_id))
            conversation_payload = (
                _conversation_metadata(conversation, current_user=current_user)
                if conversation
                else None
            )
            students.append(
                {
                    "id": membership.student_id,
                    "student_id": membership.student_id,
                    "email": student.email if student else None,
                    "full_name": student.full_name if student else None,
                    "student_name": student.full_name if student else None,
                    "conversation_id": conversation.id if conversation else None,
                    "conversation": conversation_payload,
                    "unread_count": conversation_payload["unread_count"] if conversation_payload else 0,
                    "latest_message_at": conversation_payload["latest_message_at"] if conversation_payload else None,
                    "latest_message_preview": conversation_payload["latest_message_preview"] if conversation_payload else None,
                }
            )
        rows.append(
            {
                "classroom": classroom.to_dict(),
                "students": students,
            }
        )
    return rows


def _student_summary_classes(
    current_user: User,
    conversations: list[Conversation],
) -> list[dict]:
    conversation_by_class = {
        conversation.classroom_id: conversation for conversation in conversations
    }
    memberships = (
        ClassMembership.query.filter_by(student_id=current_user.id)
        .join(Classroom, Classroom.id == ClassMembership.classroom_id)
        .order_by(Classroom.name.asc(), Classroom.id.asc())
        .all()
    )
    rows: list[dict] = []
    for membership in memberships:
        classroom = membership.classroom
        if classroom is None:
            continue
        conversation = conversation_by_class.get(classroom.id)
        conversation_payload = (
            _conversation_metadata(conversation, current_user=current_user)
            if conversation
            else None
        )
        rows.append(
            {
                "classroom": classroom.to_dict(),
                "teacher": _user_payload(classroom.teacher),
                "conversation_id": conversation.id if conversation else None,
                "conversation": conversation_payload,
                "unread_count": conversation_payload["unread_count"] if conversation_payload else 0,
                "latest_message_at": conversation_payload["latest_message_at"] if conversation_payload else None,
                "latest_message_preview": conversation_payload["latest_message_preview"] if conversation_payload else None,
            }
        )
    return rows


def _get_or_create_conversation(
    *,
    classroom_id: int,
    teacher_id: int,
    student_id: int,
) -> tuple[Conversation, bool]:
    conversation = Conversation.query.filter_by(
        classroom_id=classroom_id,
        teacher_id=teacher_id,
        student_id=student_id,
    ).first()
    if conversation is not None:
        return conversation, False

    conversation = Conversation(
        classroom_id=classroom_id,
        teacher_id=teacher_id,
        student_id=student_id,
    )
    db.session.add(conversation)
    try:
        db.session.flush()
    except IntegrityError:
        db.session.rollback()
        conversation = Conversation.query.filter_by(
            classroom_id=classroom_id,
            teacher_id=teacher_id,
            student_id=student_id,
        ).first()
        if conversation is None:
            raise
        return conversation, False
    return conversation, True


@messaging_bp.get("/summary")
@auth_required()
def summary(current_user: User):
    role_error = _ensure_messaging_summary_role(current_user)
    if role_error:
        return role_error

    conversations = _valid_conversations_for_user(current_user)
    conversation_rows = [
        _conversation_metadata(conversation, current_user=current_user)
        for conversation in conversations
    ]
    total_unread = sum(row["unread_count"] for row in conversation_rows)
    staff_direct = staff_messaging_service.peer_threads_summary_block(current_user)
    total_unread += int(staff_direct.get("total_unread") or 0)
    support_tickets = support_tickets_service.user_inbox_summary(current_user)
    total_unread += int(support_tickets.get("total_unread") or 0)
    payload = {
        "role": current_user.role.value,
        "total_unread": total_unread,
        "conversations": conversation_rows,
        "staff_direct": staff_direct,
        "support_tickets": support_tickets,
    }
    if current_user.role == UserRole.TEACHER:
        payload["classes"] = _teacher_summary_classes(current_user, conversations)
    elif current_user.role == UserRole.PARENT:
        payload["classes"] = []
    else:
        payload["classes"] = _student_summary_classes(current_user, conversations)
    return payload


@messaging_bp.post("/conversations")
@auth_required()
def create_conversation(current_user: User):
    role_error = _ensure_messaging_role(current_user)
    if role_error:
        return role_error

    data = request.get_json(silent=True) or {}
    classroom_id = _parse_positive_int(data.get("classroom_id"))
    if classroom_id is None:
        return {"message": "classroom_id is required."}, 400

    classroom = db.session.get(Classroom, classroom_id)
    if classroom is None:
        return {"message": "Classroom not found."}, 404

    if current_user.role == UserRole.TEACHER:
        student_id = _parse_positive_int(data.get("student_id"))
        if student_id is None:
            return {"message": "student_id is required for teacher-created conversations."}, 400
        student = db.session.get(User, student_id)
        if student is None or student.role != UserRole.STUDENT:
            return {"message": "Student not found."}, 404
        if classroom.teacher_id != current_user.id:
            return {"message": "Forbidden"}, 403
        if not _membership_exists(classroom.id, student.id):
            return {"message": "Student is not a member of this class."}, 403
        teacher_id = current_user.id
    else:
        student_id = current_user.id
        teacher_id = classroom.teacher_id
        if not _membership_exists(classroom.id, current_user.id):
            return {"message": "You are not a member of this class."}, 403

    conversation, created = _get_or_create_conversation(
        classroom_id=classroom.id,
        teacher_id=teacher_id,
        student_id=student_id,
    )
    if not _conversation_is_currently_accessible(conversation, current_user):
        return {"message": "Forbidden"}, 403
    db.session.commit()
    return {
        "conversation": _conversation_metadata(conversation, current_user=current_user),
    }, (201 if created else 200)


@messaging_bp.get("/conversations/<int:conversation_id>/messages")
@auth_required()
def list_messages(current_user: User, conversation_id: int):
    conversation, error = _resolve_conversation(conversation_id, current_user)
    if error:
        return error
    assert conversation is not None

    limit = _safe_limit(request.args.get("limit"), default=50, maximum=100)
    before_id = _parse_positive_int(request.args.get("before_id"))
    query = Message.query.filter_by(conversation_id=conversation.id)
    if before_id is not None:
        query = query.filter(Message.id < before_id)
    messages = query.order_by(Message.id.desc()).limit(limit).all()
    messages.reverse()
    return {
        "conversation": _conversation_metadata(conversation, current_user=current_user),
        "messages": [_message_payload(message, current_user) for message in messages],
        "limit": limit,
        "before_id": before_id,
    }


@messaging_bp.post("/conversations/<int:conversation_id>/messages")
@auth_required()
def send_message(current_user: User, conversation_id: int):
    conversation, error = _resolve_conversation(conversation_id, current_user)
    if error:
        return error
    assert conversation is not None

    data = request.get_json(silent=True) or {}
    body = str(data.get("body") or "").strip()
    if not body:
        return {"message": "Message body is required."}, 400
    if len(body) > MESSAGE_BODY_MAX_LENGTH:
        return {
            "message": f"Message body must be at most {MESSAGE_BODY_MAX_LENGTH} characters.",
            "max_length": MESSAGE_BODY_MAX_LENGTH,
        }, 400

    message = Message(
        conversation_id=conversation.id,
        sender_id=current_user.id,
        body=body,
    )
    conversation.updated_at = _utcnow()
    db.session.add(message)
    db.session.commit()
    return {
        "message": _message_payload(message, current_user),
        "conversation": _conversation_metadata(conversation, current_user=current_user),
    }, 201


@messaging_bp.post("/conversations/<int:conversation_id>/read")
@auth_required()
def mark_read(current_user: User, conversation_id: int):
    conversation, error = _resolve_conversation(conversation_id, current_user)
    if error:
        return error
    assert conversation is not None

    data = request.get_json(silent=True) or {}
    raw_last_message_id = data.get("last_message_id")
    if raw_last_message_id is None:
        target_message = _latest_message(conversation)
    else:
        last_message_id = _parse_positive_int(raw_last_message_id)
        if last_message_id is None:
            return {"message": "last_message_id must be a positive integer."}, 400
        target_message = db.session.get(Message, last_message_id)
        if target_message is None or target_message.conversation_id != conversation.id:
            return {"message": "last_message_id does not belong to this conversation."}, 400

    state = _ensure_read_state(conversation.id, current_user.id)
    if target_message is not None and (
        state.last_read_message_id is None
        or target_message.id > state.last_read_message_id
    ):
        state.last_read_message_id = target_message.id
        state.updated_at = _utcnow()
    db.session.commit()

    return {
        "conversation_id": conversation.id,
        "last_read_message_id": state.last_read_message_id,
        "unread_count": _unread_count(conversation, current_user.id),
        "updated_at": _iso(state.updated_at),
    }
