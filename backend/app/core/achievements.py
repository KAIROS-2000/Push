from __future__ import annotations

from datetime import UTC, datetime, timedelta

from .db import db
from ..models.learning import Achievement, Module, Task, UserAchievement, UserProgress
from ..models.user import User, UserRole

LIGHTNING_WINDOW = timedelta(minutes=1)
MARATHON_STREAK_TARGET = 30
PERFECT_FIVE_TARGET = 5


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _has_first_code(user: User) -> bool:
    return (
        Task.query.join(UserProgress, UserProgress.lesson_id == Task.lesson_id)
        .filter(
            UserProgress.user_id == user.id,
            UserProgress.status == 'completed',
            Task.task_type == 'code',
        )
        .first()
        is not None
    )


def _has_perfect_five(user: User) -> bool:
    progresses = (
        UserProgress.query.filter(
            UserProgress.user_id == user.id,
            UserProgress.status == 'completed',
            UserProgress.completed_at.isnot(None),
        )
        .order_by(UserProgress.completed_at.asc(), UserProgress.id.asc())
        .all()
    )
    streak = 0
    for progress in progresses:
        if progress.score >= 100:
            streak += 1
            if streak >= PERFECT_FIVE_TARGET:
                return True
        else:
            streak = 0
    return False


def _has_marathon(user: User) -> bool:
    return int(user.streak or 0) >= MARATHON_STREAK_TARGET


def _has_explorer(user: User) -> bool:
    age_group = (user.age_group or 'middle').strip().lower() or 'middle'
    modules = Module.query.filter_by(is_published=True, age_group=age_group).all()
    lesson_ids = [lesson.id for module in modules for lesson in module.lessons]
    if not lesson_ids:
        return False

    completed_lesson_ids = {
        row.lesson_id
        for row in UserProgress.query.filter(
            UserProgress.user_id == user.id,
            UserProgress.status == 'completed',
            UserProgress.lesson_id.in_(lesson_ids),
        ).all()
    }
    return all(lesson_id in completed_lesson_ids for lesson_id in lesson_ids)


def _has_lightning(user: User) -> bool:
    progresses = (
        UserProgress.query.filter(
            UserProgress.user_id == user.id,
            UserProgress.status == 'completed',
            UserProgress.attempts > 0,
            UserProgress.started_at.isnot(None),
            UserProgress.completed_at.isnot(None),
        )
        .all()
    )
    if not progresses:
        return False

    lesson_ids = [progress.lesson_id for progress in progresses]
    lessons_with_tasks = {
        lesson_id
        for (lesson_id,) in db.session.query(Task.lesson_id).filter(Task.lesson_id.in_(lesson_ids)).distinct().all()
    }
    for progress in progresses:
        if progress.lesson_id not in lessons_with_tasks:
            continue
        started_at = _as_utc(progress.started_at)
        completed_at = _as_utc(progress.completed_at)
        if started_at is None or completed_at is None:
            continue
        if completed_at >= started_at and completed_at - started_at <= LIGHTNING_WINDOW:
            return True
    return False


ACHIEVEMENT_CHECKS = {
    'first_code': _has_first_code,
    'perfect_five': _has_perfect_five,
    'marathon': _has_marathon,
    'explorer': _has_explorer,
    'lightning': _has_lightning,
}


def purge_achievements_for_user(user: User) -> int:
    rows = UserAchievement.query.filter_by(user_id=user.id).all()
    if not rows:
        return 0

    removed_xp = sum(row.achievement.xp_reward for row in rows if row.achievement)
    for row in rows:
        db.session.delete(row)

    user.xp = max(int(user.xp or 0) - removed_xp, 0)
    db.session.flush()
    return len(rows)


def sync_achievements_for_user(user: User) -> list[Achievement]:
    if user.role != UserRole.STUDENT:
        purge_achievements_for_user(user)
        return []

    achievements = Achievement.query.order_by(Achievement.id.asc()).all()
    if not achievements:
        return []

    earned_ids = {row.achievement_id for row in UserAchievement.query.filter_by(user_id=user.id).all()}
    newly_earned: list[Achievement] = []
    for achievement in achievements:
        if achievement.id in earned_ids:
            continue
        checker = ACHIEVEMENT_CHECKS.get(achievement.code)
        if checker and checker(user):
            db.session.add(UserAchievement(user_id=user.id, achievement_id=achievement.id))
            user.add_xp(achievement.xp_reward)
            earned_ids.add(achievement.id)
            newly_earned.append(achievement)

    if newly_earned:
        db.session.flush()
    return newly_earned
