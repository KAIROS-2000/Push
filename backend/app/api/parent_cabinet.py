from __future__ import annotations

from datetime import UTC, datetime

from flask import Blueprint, request
from sqlalchemy.exc import IntegrityError

from ..core.billing import parent_billing_placeholder
from ..core.db import db
from ..core.security import (
    auth_required,
    clear_parent_link_redeem_failures,
    parent_link_redeem_allowed,
    register_parent_link_redeem_failure,
)
from ..models.learning import ClassMembership, UserAchievement
from ..models.parent_cabinet import (
    ParentChildLink,
    ParentConsentSettings,
    ParentLinkCode,
    ParentNotification,
    ParentSafetySettings,
    ParentTeacherMessage,
    ParentTeacherReadState,
    ParentTeacherThread,
)
from ..models.user import User, UserRole
from ..services import parent_event_notifications
from ..services import parent_insights
from ..services import parent_messaging

parent_bp = Blueprint("parent_cabinet", __name__)

NO_WHITELIST: set[str] | None = None


def _link_active(parent_id: int, child_id: int) -> ParentChildLink | None:
    return (
        ParentChildLink.query.filter_by(
            parent_user_id=parent_id, child_user_id=child_id, active=True
        )
        .filter(ParentChildLink.revoked_at.is_(None))
        .first()
    )


def _child_user_for_parent(parent: User, child_id: int) -> tuple[User | None, tuple | None]:
    if child_id != int(child_id) or child_id <= 0:
        return None, ({"message": "Некорректный идентификатор."}, 400)
    link = _link_active(parent.id, child_id)
    if not link:
        return None, ({"message": "Нет доступа к этому ребёнку."}, 403)
    child = User.query.get(child_id)
    if not child or child.role != UserRole.STUDENT or not child.is_active:
        return None, ({"message": "Ребёнок недоступен."}, 404)
    return child, None


def _ensure_safety_and_consent(parent_id: int, child_id: int) -> None:
    s = ParentSafetySettings.query.filter_by(
        parent_user_id=parent_id, child_user_id=child_id
    ).first()
    if not s:
        db.session.add(
            ParentSafetySettings(
                parent_user_id=parent_id,
                child_user_id=child_id,
            )
        )
    c = ParentConsentSettings.query.filter_by(
        parent_user_id=parent_id, child_user_id=child_id
    ).first()
    if not c:
        db.session.add(
            ParentConsentSettings(
                parent_user_id=parent_id,
                child_user_id=child_id,
            )
        )


@parent_bp.get("/dashboard")
@auth_required([UserRole.PARENT])
def parent_dashboard(user: User):
    links = (
        ParentChildLink.query.filter_by(parent_user_id=user.id, active=True)
        .filter(ParentChildLink.revoked_at.is_(None))
        .all()
    )
    children: list[dict] = []
    for link in links:
        child = User.query.get(link.child_user_id)
        if not child:
            continue
        children.append(
            {
                "id": child.id,
                "display_name": child.full_name,
                "relationship_label": link.relationship_label,
                "age_group": child.age_group,
            }
        )
    sample = children[0]["id"] if children else None
    payload: dict = {"user": user.to_dict(), "children": children, "selected_child_id": sample}
    if sample:
        child, err = _child_user_for_parent(user, int(sample))
        if child and not err:
            payload["summary"] = parent_insights.compact_progress_report(child, NO_WHITELIST)
    return payload


@parent_bp.get("/children")
@auth_required([UserRole.PARENT])
def list_children(user: User):
    links = (
        ParentChildLink.query.filter_by(parent_user_id=user.id, active=True)
        .filter(ParentChildLink.revoked_at.is_(None))
        .all()
    )
    rows = []
    for link in links:
        child = User.query.get(link.child_user_id)
        if not child:
            continue
        rows.append(
            {
                "id": child.id,
                "display_name": child.full_name,
                "relationship_label": link.relationship_label,
                "age_group": child.age_group,
                "linked_at": link.created_at.isoformat() if link.created_at else None,
            }
        )
    return {"children": rows}


PARENT_PROFILE_REQUIRED_FIELDS = ('full_name', 'phone', 'email_verified')


def _missing_parent_profile_fields(user: User) -> list[str]:
    """Return the parent profile fields that block child-linking, in display order.

    Parents register by email only and enter the cabinet immediately, so we
    cannot enforce these fields at signup. Instead they are required at the
    one moment they actually need to identify themselves: when attaching a
    child to the family account.
    """

    missing: list[str] = []
    if not (user.full_name or '').strip():
        missing.append('full_name')
    if not (user.phone or '').strip():
        missing.append('phone')
    if not user.email_verified:
        missing.append('email_verified')
    return missing


@parent_bp.get("/profile/status")
@auth_required([UserRole.PARENT])
def parent_profile_status(user: User):
    """Lightweight status endpoint the cabinet uses to decide which prompts to show.

    Returns the same `missing_fields` list that `link_child` would refuse on,
    so the UI can render the "complete profile" card without first triggering
    a 400 from the link endpoint.
    """

    missing = _missing_parent_profile_fields(user)
    return {
        "ready_to_link_child": not missing,
        "missing_fields": missing,
        "required_fields": list(PARENT_PROFILE_REQUIRED_FIELDS),
        "user": {
            "full_name": user.full_name or "",
            "phone": user.phone or "",
            "email": user.email,
            "email_verified": bool(user.email_verified),
        },
    }


@parent_bp.post("/children/link")
@auth_required([UserRole.PARENT])
def link_child(user: User):
    if not parent_link_redeem_allowed(user.id):
        return {"message": "Слишком много попыток. Повторите позже."}, 429

    missing = _missing_parent_profile_fields(user)
    if missing:
        # Surface a structured response so the cabinet can drive the user to
        # the right prompt (fill phone/name OR verify email) without a guess.
        return {
            "message": (
                "Перед привязкой ребёнка завершите профиль: "
                "укажите имя, номер телефона и подтвердите email."
            ),
            "code": "parent_profile_incomplete",
            "missing_fields": missing,
        }, 400

    raw = (request.get_json() or {}).get("code", "")
    code = str(raw or "").strip().upper().replace(" ", "")
    if len(code) != parent_insights.PARENT_LINK_CODE_LENGTH:
        register_parent_link_redeem_failure(user.id)
        db.session.commit()
        return {"message": "Код должен состоять из 12 символов."}, 400
    digest = parent_insights.hash_parent_link_code(code)
    row = (
        ParentLinkCode.query.filter_by(code_hash=digest, used_at=None)
        .filter(ParentLinkCode.revoked_at.is_(None))
        .order_by(ParentLinkCode.id.desc())
        .first()
    )
    now = datetime.now(UTC)
    if not row:
        register_parent_link_redeem_failure(user.id)
        db.session.commit()
        return {"message": "Код недействителен или срок его действия истёк."}, 400
    exp = row.expires_at
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=UTC)
    if exp < now:
        register_parent_link_redeem_failure(user.id)
        db.session.commit()
        return {"message": "Код недействителен или срок его действия истёк."}, 400
    child = User.query.get(row.child_user_id)
    if not child or child.role != UserRole.STUDENT:
        register_parent_link_redeem_failure(user.id)
        db.session.commit()
        return {"message": "Код недействителен."}, 400
    existing = _link_active(user.id, child.id)
    created = False
    if not existing:
        link = ParentChildLink(
            parent_user_id=user.id,
            child_user_id=child.id,
        )
        db.session.add(link)
        try:
            # Race-safe: UniqueConstraint(parent_user_id, child_user_id) prevents
            # concurrent duplicates; we surface that as idempotent success.
            db.session.flush()
            created = True
        except IntegrityError:
            db.session.rollback()
            existing = _link_active(user.id, child.id)
            if existing is None:
                # Constraint conflict but no active row visible — surface as transient error
                # rather than hiding it as success.
                register_parent_link_redeem_failure(user.id)
                db.session.commit()
                return {"message": "Не удалось установить связь. Повторите попытку."}, 409
    row.used_at = now
    _ensure_safety_and_consent(user.id, child.id)
    clear_parent_link_redeem_failures(user.id)
    db.session.commit()
    if created:
        parent_event_notifications.notify_welcome_after_link(user, child)
    return {
        "message": "Связь с ребёнком установлена.",
        "child": {
            "id": child.id,
            "display_name": child.full_name,
        },
    }, 201


@parent_bp.delete("/children/<int:child_id>/unlink")
@auth_required([UserRole.PARENT])
def unlink_child(user: User, child_id: int):
    link = _link_active(user.id, child_id)
    if not link:
        return {"message": "Связь не найдена."}, 404
    link.active = False
    link.revoked_at = datetime.now(UTC)
    db.session.commit()
    return {"ok": True}


@parent_bp.get("/children/<int:child_id>/summary")
@auth_required([UserRole.PARENT])
def child_summary(user: User, child_id: int):
    child, err = _child_user_for_parent(user, child_id)
    if err:
        return err
    assert child is not None
    return {
        "child": child.to_parent_dict(),
        "summary": parent_insights.compact_progress_report(child, NO_WHITELIST),
    }


@parent_bp.get("/children/<int:child_id>/digest")
@auth_required([UserRole.PARENT])
def child_digest(user: User, child_id: int):
    child, err = _child_user_for_parent(user, child_id)
    if err:
        return err
    assert child is not None
    consent = ParentConsentSettings.query.filter_by(
        parent_user_id=user.id, child_user_id=child_id
    ).first()
    if consent and not consent.allow_learning_analytics_display:
        return {
            "paragraph": "Отображение аналитики отключено в настройках согласия.",
            "lessons_week": 0,
            "practices_week": 0,
        }
    return {
        "paragraph": parent_insights.weekly_digest_narrative(child, NO_WHITELIST),
        "learning_activity_minutes_estimate": parent_insights.learning_activity_estimate_minutes(
            child, NO_WHITELIST
        ),
        "label": "Оценка учебной активности за неделю (не точное время у экрана).",
    }


@parent_bp.get("/children/<int:child_id>/skills")
@auth_required([UserRole.PARENT])
def child_skills(user: User, child_id: int):
    child, err = _child_user_for_parent(user, child_id)
    if err:
        return err
    assert child is not None
    rows = parent_insights.module_report(child, NO_WHITELIST)
    labels = {
        "mastered": "Уверенно получается",
        "in_progress": "Тренируется",
        "needs_help": "Нужна помощь",
        "not_started": "Впереди",
    }
    for row in rows:
        row["state_label"] = labels.get(row.get("skill_state", "not_started"), "Впереди")
    return {"modules": rows}


@parent_bp.get("/children/<int:child_id>/activity")
@auth_required([UserRole.PARENT])
def child_activity(user: User, child_id: int):
    child, err = _child_user_for_parent(user, child_id)
    if err:
        return err
    assert child is not None
    week = parent_insights.weekly_activity(child, NO_WHITELIST)
    prev = parent_insights.weekly_activity_prev_week(child, NO_WHITELIST)
    return {
        "this_week": week,
        "previous_week": prev,
        "trend_text": parent_insights.activity_trend_text(child, NO_WHITELIST),
        "streak": child.streak,
        "activity_minutes_estimate": parent_insights.learning_activity_estimate_minutes(
            child, NO_WHITELIST
        ),
    }


@parent_bp.get("/children/<int:child_id>/practice-history")
@auth_required([UserRole.PARENT])
def child_practice_history(user: User, child_id: int):
    child, err = _child_user_for_parent(user, child_id)
    if err:
        return err
    assert child is not None
    return {"items": parent_insights.assignment_rows_for_parent(child, 50, NO_WHITELIST)}


@parent_bp.get("/children/<int:child_id>/signals")
@auth_required([UserRole.PARENT])
def child_signals(user: User, child_id: int):
    child, err = _child_user_for_parent(user, child_id)
    if err:
        return err
    assert child is not None
    return {"signals": parent_insights.help_and_risk_signals(child, NO_WHITELIST)}


@parent_bp.get("/children/<int:child_id>/safety")
@auth_required([UserRole.PARENT])
def get_safety(user: User, child_id: int):
    _, err = _child_user_for_parent(user, child_id)
    if err:
        return err
    row = ParentSafetySettings.query.filter_by(
        parent_user_id=user.id, child_user_id=child_id
    ).first()
    if not row:
        _ensure_safety_and_consent(user.id, child_id)
        db.session.commit()
        row = ParentSafetySettings.query.filter_by(
            parent_user_id=user.id, child_user_id=child_id
        ).first()
    return {
        "weekly_screen_time_limit_minutes": row.weekly_screen_time_limit_minutes
        if row
        else None,
        "daily_screen_time_limit_minutes": row.daily_screen_time_limit_minutes if row else None,
        "hide_child_public_profile": bool(row and row.hide_child_public_profile),
        "allow_achievement_sharing": bool(row.allow_achievement_sharing) if row else True,
    }


@parent_bp.patch("/children/<int:child_id>/safety")
@auth_required([UserRole.PARENT])
def patch_safety(user: User, child_id: int):
    _, err = _child_user_for_parent(user, child_id)
    if err:
        return err
    data = request.get_json() or {}
    row = ParentSafetySettings.query.filter_by(
        parent_user_id=user.id, child_user_id=child_id
    ).first()
    if not row:
        _ensure_safety_and_consent(user.id, child_id)
        row = ParentSafetySettings.query.filter_by(
            parent_user_id=user.id, child_user_id=child_id
        ).first()
    if "weekly_screen_time_limit_minutes" in data:
        v = data["weekly_screen_time_limit_minutes"]
        row.weekly_screen_time_limit_minutes = int(v) if v is not None else None
    if "daily_screen_time_limit_minutes" in data:
        v = data["daily_screen_time_limit_minutes"]
        row.daily_screen_time_limit_minutes = int(v) if v is not None else None
    if "hide_child_public_profile" in data:
        row.hide_child_public_profile = bool(data["hide_child_public_profile"])
    if "allow_achievement_sharing" in data:
        row.allow_achievement_sharing = bool(data["allow_achievement_sharing"])
    db.session.commit()
    row = ParentSafetySettings.query.filter_by(
        parent_user_id=user.id, child_user_id=child_id
    ).first()
    return {
        "weekly_screen_time_limit_minutes": row.weekly_screen_time_limit_minutes
        if row
        else None,
        "daily_screen_time_limit_minutes": row.daily_screen_time_limit_minutes if row else None,
        "hide_child_public_profile": bool(row and row.hide_child_public_profile),
        "allow_achievement_sharing": bool(row.allow_achievement_sharing) if row else True,
    }


@parent_bp.get("/children/<int:child_id>/consent")
@auth_required([UserRole.PARENT])
def get_consent(user: User, child_id: int):
    _, err = _child_user_for_parent(user, child_id)
    if err:
        return err
    row = ParentConsentSettings.query.filter_by(
        parent_user_id=user.id, child_user_id=child_id
    ).first()
    if not row:
        _ensure_safety_and_consent(user.id, child_id)
        db.session.commit()
        row = ParentConsentSettings.query.filter_by(
            parent_user_id=user.id, child_user_id=child_id
        ).first()
    return {
        "allow_notifications": row.allow_notifications,
        "allow_browser_notifications": row.allow_browser_notifications,
        "allow_achievement_sharing": row.allow_achievement_sharing,
        "allow_learning_analytics_display": row.allow_learning_analytics_display,
        "allow_parent_teacher_communication": row.allow_parent_teacher_communication,
    }


@parent_bp.patch("/children/<int:child_id>/consent")
@auth_required([UserRole.PARENT])
def patch_consent(user: User, child_id: int):
    _, err = _child_user_for_parent(user, child_id)
    if err:
        return err
    data = request.get_json() or {}
    row = ParentConsentSettings.query.filter_by(
        parent_user_id=user.id, child_user_id=child_id
    ).first()
    if not row:
        _ensure_safety_and_consent(user.id, child_id)
        row = ParentConsentSettings.query.filter_by(
            parent_user_id=user.id, child_user_id=child_id
        ).first()
    for key in (
        "allow_notifications",
        "allow_browser_notifications",
        "allow_achievement_sharing",
        "allow_learning_analytics_display",
        "allow_parent_teacher_communication",
    ):
        if key in data:
            setattr(row, key, bool(data[key]))
    db.session.commit()
    row = ParentConsentSettings.query.filter_by(
        parent_user_id=user.id, child_user_id=child_id
    ).first()
    return {
        "allow_notifications": row.allow_notifications,
        "allow_browser_notifications": row.allow_browser_notifications,
        "allow_achievement_sharing": row.allow_achievement_sharing,
        "allow_learning_analytics_display": row.allow_learning_analytics_display,
        "allow_parent_teacher_communication": row.allow_parent_teacher_communication,
    }


@parent_bp.get("/billing")
@auth_required([UserRole.PARENT])
def billing(user: User):
    return parent_billing_placeholder(user)


@parent_bp.get("/notifications")
@auth_required([UserRole.PARENT])
def list_notifications(user: User):
    rows = (
        ParentNotification.query.filter_by(parent_user_id=user.id)
        .order_by(ParentNotification.created_at.desc())
        .limit(100)
        .all()
    )
    return {
        "notifications": [
            {
                "id": r.id,
                "title": r.title,
                "body": r.body,
                "type": r.type,
                "child_id": r.child_user_id,
                "href": r.href,
                "read_at": r.read_at.isoformat() if r.read_at else None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    }


@parent_bp.patch("/notifications/<int:nid>/read")
@auth_required([UserRole.PARENT])
def mark_notification_read(user: User, nid: int):
    row = ParentNotification.query.filter_by(id=nid, parent_user_id=user.id).first()
    if not row:
        return {"message": "Не найдено."}, 404
    row.read_at = datetime.now(UTC)
    db.session.commit()
    return {"ok": True}


@parent_bp.get("/children/<int:child_id>/achievements")
@auth_required([UserRole.PARENT])
def child_achievements(user: User, child_id: int):
    child, err = _child_user_for_parent(user, child_id)
    if err:
        return err
    assert child is not None
    items = (
        UserAchievement.query.filter_by(user_id=child_id)
        .order_by(UserAchievement.earned_at.desc())
        .limit(20)
        .all()
    )
    return {
        "achievements": [
            {**u.achievement.to_dict(), "earned_at": u.earned_at.isoformat() if u.earned_at else None}
            for u in items
        ]
    }


@parent_bp.get("/messaging/threads")
@auth_required([UserRole.PARENT])
def parent_messaging_list(user: User):
    return parent_messaging.summary_for_parent(user)


@parent_bp.get("/messaging/threads/<int:thread_id>/messages")
@auth_required([UserRole.PARENT])
def parent_thread_messages(user: User, thread_id: int):
    return parent_messaging.list_messages_parent(user, thread_id)


@parent_bp.post("/messaging/threads/<int:thread_id>/messages")
@auth_required([UserRole.PARENT])
def parent_thread_send(user: User, thread_id: int):
    return parent_messaging.send_message_parent(user, thread_id)


@parent_bp.post("/messaging/threads/<int:thread_id>/read")
@auth_required([UserRole.PARENT])
def parent_thread_read(user: User, thread_id: int):
    return parent_messaging.mark_read_parent(user, thread_id)


@parent_bp.post("/messaging/threads")
@auth_required([UserRole.PARENT])
def parent_thread_open(user: User):
    return parent_messaging.open_thread(user)
