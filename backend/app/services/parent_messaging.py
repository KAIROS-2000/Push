from __future__ import annotations

from datetime import UTC, datetime

from flask import request

from ..core.db import db
from ..models.learning import ClassMembership, Classroom
from ..models.parent_cabinet import (
    ParentChildLink,
    ParentConsentSettings,
    ParentTeacherMessage,
    ParentTeacherReadState,
    ParentTeacherThread,
)
from ..models.user import User, UserRole

MESSAGE_BODY_MAX_LENGTH = 400


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()


def _parent_can_message(parent_id: int, child_id: int) -> bool:
    c = ParentConsentSettings.query.filter_by(
        parent_user_id=parent_id, child_user_id=child_id
    ).first()
    if c and not c.allow_parent_teacher_communication:
        return False
    return True


def _ensure_thread_access_parent(user: User, thread: ParentTeacherThread) -> bool:
    if user.role != UserRole.PARENT:
        return False
    return thread.parent_user_id == user.id


def _ensure_thread_access_teacher(user: User, thread: ParentTeacherThread) -> bool:
    if user.role != UserRole.TEACHER:
        return False
    return thread.teacher_id == user.id


def summary_for_parent(user: User) -> dict:
    threads = (
        ParentTeacherThread.query.filter_by(parent_user_id=user.id)
        .order_by(ParentTeacherThread.updated_at.desc())
        .limit(200)
        .all()
    )
    rows = []
    for t in threads:
        child = User.query.get(t.child_user_id)
        teacher = User.query.get(t.teacher_id)
        classroom = Classroom.query.get(t.classroom_id)
        latest = (
            ParentTeacherMessage.query.filter_by(thread_id=t.id)
            .order_by(ParentTeacherMessage.id.desc())
            .first()
        )
        unread = _unread_for(t, user.id)
        rows.append(
            {
                "id": t.id,
                "child": {"id": t.child_user_id, "full_name": child.full_name if child else None},
                "teacher": {
                    "id": t.teacher_id,
                    "full_name": teacher.full_name if teacher else None,
                },
                "classroom": {"id": t.classroom_id, "name": classroom.name if classroom else None},
                "updated_at": _iso(t.updated_at),
                "latest_preview": (latest.body or "")[:120] if latest else None,
                "unread_count": unread,
            }
        )
    return {"threads": rows}


def _unread_for(thread: ParentTeacherThread, user_id: int) -> int:
    state = ParentTeacherReadState.query.filter_by(thread_id=thread.id, user_id=user_id).first()
    q = ParentTeacherMessage.query.filter(
        ParentTeacherMessage.thread_id == thread.id,
        ParentTeacherMessage.sender_id != user_id,
    )
    if state and state.last_read_message_id:
        q = q.filter(ParentTeacherMessage.id > state.last_read_message_id)
    return q.count()


def _thread_metadata(thread: ParentTeacherThread) -> dict:
    child = User.query.get(thread.child_user_id)
    teacher = User.query.get(thread.teacher_id)
    classroom = Classroom.query.get(thread.classroom_id)
    return {
        "id": thread.id,
        "is_parent_conversation": True,
        "child": {"id": thread.child_user_id, "name": child.full_name if child else None},
        "teacher": {"id": thread.teacher_id, "name": teacher.full_name if teacher else None},
        "classroom": {"id": thread.classroom_id, "name": classroom.name if classroom else None},
    }


def list_messages_parent(user: User, thread_id: int) -> dict | tuple:
    thread = db.session.get(ParentTeacherThread, thread_id)
    if not thread or not _ensure_thread_access_parent(user, thread):
        return {"message": "Нет доступа."}, 403
    if not _parent_can_message(user.id, thread.child_user_id):
        return {"message": "Связь с педагогом отключена в настройках согласия."}, 403
    messages = (
        ParentTeacherMessage.query.filter_by(thread_id=thread.id)
        .order_by(ParentTeacherMessage.id.asc())
        .limit(100)
        .all()
    )
    return {
        "thread": _thread_metadata(thread),
        "messages": [
            {
                "id": m.id,
                "sender_id": m.sender_id,
                "body": m.body,
                "created_at": _iso(m.created_at),
            }
            for m in messages
        ],
    }


def send_message_parent(user: User, thread_id: int) -> dict | tuple:
    thread = db.session.get(ParentTeacherThread, thread_id)
    if not thread or not _ensure_thread_access_parent(user, thread):
        return {"message": "Нет доступа."}, 403
    if not _parent_can_message(user.id, thread.child_user_id):
        return {"message": "Связь с педагогом отключена в настройках согласия."}, 403
    body = str((request.get_json() or {}).get("body") or "").strip()
    if not body:
        return {"message": "Пустое сообщение."}, 400
    if len(body) > MESSAGE_BODY_MAX_LENGTH:
        return {"message": "Слишком длинное сообщение."}, 400
    m = ParentTeacherMessage(
        thread_id=thread.id,
        sender_id=user.id,
        body=body,
    )
    thread.updated_at = datetime.now(UTC)
    db.session.add(m)
    db.session.commit()
    return {
        "message": {
            "id": m.id,
            "sender_id": m.sender_id,
            "body": m.body,
            "created_at": _iso(m.created_at),
        }
    }, 201


def mark_read_parent(user: User, thread_id: int) -> dict | tuple:
    thread = db.session.get(ParentTeacherThread, thread_id)
    if not thread or not _ensure_thread_access_parent(user, thread):
        return {"message": "Нет доступа."}, 403
    latest = (
        ParentTeacherMessage.query.filter_by(thread_id=thread.id)
        .order_by(ParentTeacherMessage.id.desc())
        .first()
    )
    st = ParentTeacherReadState.query.filter_by(thread_id=thread.id, user_id=user.id).first()
    if st is None:
        st = ParentTeacherReadState(thread_id=thread.id, user_id=user.id)
        db.session.add(st)
    if latest:
        st.last_read_message_id = latest.id
    st.updated_at = datetime.now(UTC)
    db.session.commit()
    return {"ok": True, "unread": _unread_for(thread, user.id)}


def open_thread(user: User) -> dict | tuple:
    data = request.get_json() or {}
    child_id = int(data.get("child_id") or 0)
    classroom_id = int(data.get("classroom_id") or 0)
    if child_id <= 0 or classroom_id <= 0:
        return {"message": "Нужны child_id и classroom_id."}, 400
    link = (
        ParentChildLink.query.filter_by(
            parent_user_id=user.id, child_user_id=child_id, active=True
        )
        .filter(ParentChildLink.revoked_at.is_(None))
        .first()
    )
    if not link:
        return {"message": "Нет привязки к этому ребёнку."}, 403
    if not ClassMembership.query.filter_by(classroom_id=classroom_id, student_id=child_id).first():
        return {"message": "Ребёнок не в этом классе."}, 403
    classroom = Classroom.query.get(classroom_id)
    if not classroom:
        return {"message": "Класс не найден."}, 404
    teacher_id = classroom.teacher_id
    th = ParentTeacherThread.query.filter_by(
        parent_user_id=user.id,
        teacher_id=teacher_id,
        child_user_id=child_id,
        classroom_id=classroom_id,
    ).first()
    if not th:
        th = ParentTeacherThread(
            parent_user_id=user.id,
            teacher_id=teacher_id,
            child_user_id=child_id,
            classroom_id=classroom_id,
        )
        db.session.add(th)
        db.session.commit()
    return {"thread": _thread_metadata(th), "id": th.id}


def summary_for_teacher(user: User) -> dict:
    if user.role != UserRole.TEACHER:
        return {"message": "Только для учителя."}, 403
    threads = (
        ParentTeacherThread.query.filter_by(teacher_id=user.id)
        .order_by(ParentTeacherThread.updated_at.desc())
        .limit(200)
        .all()
    )
    out = []
    for t in threads:
        child = User.query.get(t.child_user_id)
        parent = User.query.get(t.parent_user_id)
        classroom = Classroom.query.get(t.classroom_id)
        latest = (
            ParentTeacherMessage.query.filter_by(thread_id=t.id)
            .order_by(ParentTeacherMessage.id.desc())
            .first()
        )
        out.append(
            {
                "id": t.id,
                "is_parent_conversation": True,
                "parent": {"id": t.parent_user_id, "full_name": parent.full_name if parent else None},
                "student": {"id": t.child_user_id, "full_name": child.full_name if child else None},
                "classroom": {"id": t.classroom_id, "name": classroom.name if classroom else None},
                "unread_count": _unread_for(t, user.id),
                "latest_preview": (latest.body or "")[:120] if latest else None,
                "updated_at": _iso(t.updated_at),
            }
        )
    return {"parent_threads": out}


def list_messages_teacher(user: User, thread_id: int) -> dict | tuple:
    thread = db.session.get(ParentTeacherThread, thread_id)
    if not thread or not _ensure_thread_access_teacher(user, thread):
        return {"message": "Нет доступа."}, 403
    messages = (
        ParentTeacherMessage.query.filter_by(thread_id=thread.id)
        .order_by(ParentTeacherMessage.id.asc())
        .limit(100)
        .all()
    )
    return {
        "thread": _thread_metadata(thread),
        "messages": [
            {
                "id": m.id,
                "sender_id": m.sender_id,
                "body": m.body,
                "created_at": _iso(m.created_at),
            }
            for m in messages
        ],
    }


def send_message_teacher(user: User, thread_id: int) -> dict | tuple:
    thread = db.session.get(ParentTeacherThread, thread_id)
    if not thread or not _ensure_thread_access_teacher(user, thread):
        return {"message": "Нет доступа."}, 403
    body = str((request.get_json() or {}).get("body") or "").strip()
    if not body:
        return {"message": "Пустое сообщение."}, 400
    if len(body) > MESSAGE_BODY_MAX_LENGTH:
        return {"message": "Слишком длинное сообщение."}, 400
    m = ParentTeacherMessage(
        thread_id=thread.id,
        sender_id=user.id,
        body=body,
    )
    thread.updated_at = datetime.now(UTC)
    db.session.add(m)
    db.session.commit()
    return {
        "message": {
            "id": m.id,
            "sender_id": m.sender_id,
            "body": m.body,
            "created_at": _iso(m.created_at),
        }
    }, 201


def mark_read_teacher(user: User, thread_id: int) -> dict | tuple:
    thread = db.session.get(ParentTeacherThread, thread_id)
    if not thread or not _ensure_thread_access_teacher(user, thread):
        return {"message": "Нет доступа."}, 403
    latest = (
        ParentTeacherMessage.query.filter_by(thread_id=thread.id)
        .order_by(ParentTeacherMessage.id.desc())
        .first()
    )
    st = ParentTeacherReadState.query.filter_by(thread_id=thread.id, user_id=user.id).first()
    if st is None:
        st = ParentTeacherReadState(thread_id=thread.id, user_id=user.id)
        db.session.add(st)
    if latest:
        st.last_read_message_id = latest.id
    st.updated_at = datetime.now(UTC)
    db.session.commit()
    return {"ok": True, "unread": _unread_for(thread, user.id)}
