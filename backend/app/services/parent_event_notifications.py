from __future__ import annotations

from ..core.db import db
from ..models.learning import Achievement
from ..models.parent_cabinet import (
    ParentChildLink,
    ParentConsentSettings,
    ParentNotification,
    ParentNotificationType,
)
from ..models.user import User


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


def notify_welcome_after_link(parent: User, child: User) -> None:
    _append(
        parent.id,
        "Связь установлена",
        f"Теперь вы видите кабинет для {child.full_name} в едином семейном разделе.",
        child_id=child.id,
        href="/parent/dashboard",
        ntype=ParentNotificationType.INFO.value,
    )
