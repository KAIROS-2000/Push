from __future__ import annotations

import logging

from ..core.db import db
from ..models.learning import Achievement
from ..models.parent_cabinet import (
    ParentChildLink,
    ParentConsentSettings,
    ParentNotification,
    ParentNotificationType,
)
from ..models.user import User

_log = logging.getLogger(__name__)


def _append(parent_id: int, title: str, body: str, *, child_id: int | None, href: str | None, ntype: str) -> None:
    db.session.add(
        ParentNotification(
            parent_user_id=parent_id,
            child_user_id=child_id,
            title=title,
            body=body,
            type=ntype,
            href=href,
        )
    )


def notify_achievements_earned(student: User, earned: list[Achievement]) -> None:
    """In-app + email notification fan-out for new achievements.

    For every active parent link of the student we (a) append in-app
    `ParentNotification` rows that drive the cabinet bell, and (b) send a
    single batched email per parent that lists all newly-earned achievements
    in this sync. Email delivery is best-effort: a failure to send must not
    abort the achievement-award transaction or be visible to the student.

    `ParentConsentSettings.allow_notifications=False` mutes both channels —
    the parent has explicitly opted out.
    """

    if not earned:
        return
    links = (
        ParentChildLink.query.filter_by(child_user_id=student.id, active=True)
        .filter(ParentChildLink.revoked_at.is_(None))
        .all()
    )
    for link in links:
        consent = ParentConsentSettings.query.filter_by(
            parent_user_id=link.parent_user_id, child_user_id=student.id
        ).first()
        if consent and not consent.allow_notifications:
            continue
        for ach in earned[:5]:
            first = student.full_name.split()[0] if student.full_name else "Ребёнок"
            _append(
                link.parent_user_id,
                "Новое достижение",
                f"{first} получил(а) достижение: {ach.name}.",
                child_id=student.id,
                href="/parent/dashboard",
                ntype=ParentNotificationType.ACHIEVEMENT.value,
            )

        parent = db.session.get(User, link.parent_user_id)
        if parent and (parent.email or '').strip():
            _send_achievement_email_safe(parent, student, earned)


def _send_achievement_email_safe(parent: User, student: User, earned: list[Achievement]) -> None:
    """Send the achievement email and never raise — log and move on.

    Email sending hits the network, so we deliberately wrap every failure
    mode (provider 4xx/5xx, DNS issues, missing config in dev) and keep the
    achievement-award transaction safe.
    """

    # Local import keeps app start-up cycle clean and avoids circular imports
    # via core.achievements -> services -> email_service.
    from .email_service import EmailServiceError, send_child_achievement_email

    try:
        send_child_achievement_email(parent, student, earned)
    except EmailServiceError as exc:
        _log.warning(
            'child_achievement_email_send_failed parent_id=%s child_id=%s achievements=%s error=%s',
            parent.id,
            student.id,
            len(earned),
            exc,
        )
    except Exception:  # noqa: BLE001
        _log.exception(
            'child_achievement_email_unexpected_failure parent_id=%s child_id=%s',
            parent.id,
            student.id,
        )


def notify_welcome_after_link(parent: User, child: User) -> None:
    _append(
        parent.id,
        "Связь установлена",
        f"Теперь вы видите кабинет для {child.full_name} в едином семейном разделе.",
        child_id=child.id,
        href="/parent/dashboard",
        ntype=ParentNotificationType.INFO.value,
    )
