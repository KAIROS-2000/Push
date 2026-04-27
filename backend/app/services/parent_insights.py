from __future__ import annotations

import hashlib
import secrets
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from flask import current_app

from ..core.db import db
from ..models.learning import (
    AssignmentSubmission,
    Lesson,
    Module,
    UserAchievement,
    UserProgress,
)
from ..models.user import User

# Uppercase alnum without ambiguous 0/O, 1/I/L
PARENT_LINK_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
PARENT_LINK_CODE_LENGTH = 12


def hash_parent_link_code(plain: str) -> str:
    pepper = (current_app.config.get("SECRET_KEY") or "").encode()
    return hashlib.sha256(pepper + b":" + plain.strip().upper().encode("utf-8")).hexdigest()


def generate_parent_link_code_plain() -> str:
    return "".join(
        secrets.choice(PARENT_LINK_CODE_ALPHABET) for _ in range(PARENT_LINK_CODE_LENGTH)
    )


def normalized_module_whitelist(raw_value) -> set[str] | None:
    if not isinstance(raw_value, list):
        return None
    values = {str(item or "").strip() for item in raw_value if str(item or "").strip()}
    return values or None


def lesson_allowed_for_parent(lesson: Lesson | None, allowed_module_slugs: set[str] | None) -> bool:
    if allowed_module_slugs is None:
        return True
    return bool(lesson and lesson.module and lesson.module.slug in allowed_module_slugs)


def assignment_allowed_for_parent(assignment, allowed_module_slugs: set[str] | None) -> bool:
    if allowed_module_slugs is None:
        return True
    return bool(
        assignment
        and assignment.lesson
        and lesson_allowed_for_parent(assignment.lesson, allowed_module_slugs)
    )


def compact_progress_report(
    student: User, allowed_module_slugs: set[str] | None = None
) -> dict:
    progresses = [
        row
        for row in UserProgress.query.filter_by(user_id=student.id).all()
        if lesson_allowed_for_parent(row.lesson, allowed_module_slugs)
    ]
    completed = [row for row in progresses if row.status == "completed"]
    total_score = sum(row.score for row in completed)
    assignments = [
        row
        for row in AssignmentSubmission.query.filter_by(student_id=student.id).all()
        if assignment_allowed_for_parent(row.assignment, allowed_module_slugs)
    ]
    return {
        "completed_lessons": len(completed),
        "average_score": round(total_score / len(completed), 1) if completed else 0,
        "tasks_submitted": len(assignments),
        "current_level": student.level,
        "xp": student.xp,
        "streak": student.streak,
    }


def weekly_activity(
    student: User, allowed_module_slugs: set[str] | None = None
) -> list[dict]:
    rows = []
    progresses = [
        row
        for row in UserProgress.query.filter_by(user_id=student.id).all()
        if lesson_allowed_for_parent(row.lesson, allowed_module_slugs)
    ]
    assignments = [
        row
        for row in AssignmentSubmission.query.filter_by(student_id=student.id).all()
        if assignment_allowed_for_parent(row.assignment, allowed_module_slugs)
    ]
    grouped: dict[str, dict[str, int]] = defaultdict(
        lambda: {"lessons": 0, "assignments": 0, "score_sum": 0, "score_count": 0}
    )
    for progress in progresses:
        if progress.status == "completed" and progress.completed_at:
            key = progress.completed_at.date().isoformat()
            grouped[key]["lessons"] += 1
            grouped[key]["score_sum"] += progress.score
            grouped[key]["score_count"] += 1
    for submission in assignments:
        key = submission.submitted_at.date().isoformat()
        grouped[key]["assignments"] += 1
        grouped[key]["score_sum"] += submission.score
        grouped[key]["score_count"] += 1
    today = datetime.now(UTC).date()
    for offset in range(6, -1, -1):
        day = today - timedelta(days=offset)
        key = day.isoformat()
        score_count = grouped[key]["score_count"]
        rows.append(
            {
                "date": key,
                "label": day.strftime("%d.%m"),
                "lessons": grouped[key]["lessons"],
                "assignments": grouped[key]["assignments"],
                "average_score": (
                    round(grouped[key]["score_sum"] / score_count, 1) if score_count else 0
                ),
            }
        )
    return rows


def _lesson_state_for_insights(progress: UserProgress | None) -> str:
    if not progress:
        return "not_started"
    st = (progress.status or "").strip().lower()
    if st in {"completed", "not_started", "in_progress", "pending_review", "needs_revision"}:
        if st in {"not_started", "in_progress", "pending_review", "needs_revision"}:
            return st
    return st or "not_started"


def module_report(
    student: User, allowed_module_slugs: set[str] | None = None
) -> list[dict]:
    modules = (
        Module.query.filter_by(
            is_published=True, age_group=student.age_group or "middle"
        )
        .order_by(Module.order_index.asc())
        .all()
    )
    payload = []
    for module in modules:
        if allowed_module_slugs is not None and module.slug not in allowed_module_slugs:
            continue
        completed = 0
        total = len(module.lessons)
        inprog = 0
        for lesson in module.lessons:
            progress = UserProgress.query.filter_by(
                user_id=student.id, lesson_id=lesson.id
            ).first()
            st = _lesson_state_for_insights(progress)
            if st == "completed":
                completed += 1
            elif st in {"in_progress", "pending_review", "needs_revision"}:
                inprog += 1
        pct = int((completed / max(total, 1)) * 100)
        if completed >= total and total > 0:
            sk = "mastered"
        elif completed > 0 or inprog > 0 or pct > 0:
            sk = "in_progress"
        else:
            sk = "not_started"
        # refine needs_help: low scores or needs_revision
        if sk == "in_progress":
            for lesson in module.lessons:
                progress = UserProgress.query.filter_by(
                    user_id=student.id, lesson_id=lesson.id
                ).first()
                if progress and (progress.status == "needs_revision" or (progress.score or 0) < 50):
                    sk = "needs_help"
                    break
        payload.append(
            {
                "id": module.id,
                "title": module.title,
                "slug": module.slug,
                "color": module.color,
                "completed_lessons": completed,
                "total_lessons": total,
                "progress_percent": pct,
                "skill_state": sk,
            }
        )
    return payload


def assignment_rows_for_parent(
    student: User, limit: int = 30, allowed_module_slugs: set[str] | None = None
) -> list[dict]:
    submissions = (
        AssignmentSubmission.query.filter_by(student_id=student.id)
        .order_by(AssignmentSubmission.submitted_at.desc())
        .all()
    )
    visible = [
        s
        for s in submissions
        if assignment_allowed_for_parent(s.assignment, allowed_module_slugs)
    ]
    return [s.to_parent_dict() for s in visible[:limit]]


def _week_range() -> tuple[datetime, datetime]:
    now = datetime.now(UTC)
    start = (now - timedelta(days=7)).replace(hour=0, minute=0, second=0, microsecond=0)
    return start, now


def learning_activity_estimate_minutes(
    student: User, allowed_module_slugs: set[str] | None = None
) -> int:
    """Rough estimate from completed lessons + submission events (not screen time)."""
    start, end = _week_range()
    minutes = 0
    for row in UserProgress.query.filter_by(user_id=student.id).all():
        if not lesson_allowed_for_parent(row.lesson, allowed_module_slugs):
            continue
        if row.status != "completed" or not row.completed_at:
            continue
        if not (start <= _ensure_aware(row.completed_at) <= end):
            continue
        minutes += 12
    for sub in AssignmentSubmission.query.filter_by(student_id=student.id).all():
        if not assignment_allowed_for_parent(sub.assignment, allowed_module_slugs):
            continue
        if not (start <= _ensure_aware(sub.submitted_at) <= end):
            continue
        minutes += 8
    return minutes


def _ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def weekly_digest_narrative(student: User, allowed_module_slugs: set[str] | None) -> str:
    start, end = _week_range()
    first = student.full_name.split()[0] if student.full_name else "Ребёнок"
    lessons = 0
    practices = 0
    for row in UserProgress.query.filter_by(user_id=student.id).all():
        if not lesson_allowed_for_parent(row.lesson, allowed_module_slugs):
            continue
        if row.status == "completed" and row.completed_at and start <= _ensure_aware(row.completed_at) <= end:
            lessons += 1
    for sub in AssignmentSubmission.query.filter_by(student_id=student.id).all():
        if not assignment_allowed_for_parent(sub.assignment, allowed_module_slugs):
            continue
        if start <= _ensure_aware(sub.submitted_at) <= end:
            practices += 1
    ach_count = 0
    for ua in (
        UserAchievement.query.filter_by(user_id=student.id)
        .order_by(UserAchievement.earned_at.desc())
        .all()
    ):
        if start <= _ensure_aware(ua.earned_at) <= end:
            ach_count += 1
    parts = [
        f"На этой неделе {first} завершил(а) {lessons} урок(ов) и {practices} практик(и)."
    ]
    if ach_count:
        parts.append(f"Получено достижений: {ach_count}.")
    if lessons == 0 and practices == 0:
        return (
            f"Эта неделя спокойная: {first} пока без новых завершённых уроков — "
            "это нормально, можно мягко напомнить о занятиях в удобном темпе."
        )
    return " ".join(parts)


def help_and_risk_signals(
    student: User, allowed_module_slugs: set[str] | None
) -> list[dict[str, Any]]:
    signals: list[dict[str, Any]] = []
    now = datetime.now(UTC)
    for sub in AssignmentSubmission.query.filter_by(student_id=student.id).all():
        if not assignment_allowed_for_parent(sub.assignment, allowed_module_slugs):
            continue
        st = (sub.status or "").strip().lower()
        title = sub.assignment.title if sub.assignment else "Задание"
        if st == "pending_review":
            signals.append(
                {
                    "severity": "info",
                    "title": "Задание на проверке",
                    "explanation": f"«{title}» отправлено и ждёт ответа преподавателя.",
                    "suggested_action": "Можно ненавязчиво поинтересоваться у ребёнка, спокоен ли он в ожидании.",
                }
            )
        elif st == "needs_revision":
            signals.append(
                {
                    "severity": "attention",
                    "title": "Есть доработка",
                    "explanation": f"По «{title}» учитель попросил внести правки — это шаг к улучшению.",
                    "suggested_action": "Стоит вместе с ребёнком уточнить комментарий преподавателя.",
                }
            )
    for row in UserProgress.query.filter_by(user_id=student.id).all():
        if not lesson_allowed_for_parent(row.lesson, allowed_module_slugs):
            continue
        if row.status == "needs_revision":
            lt = row.lesson.title if row.lesson else "уроке"
            signals.append(
                {
                    "severity": "warning",
                    "title": "Нужна помощь с темой",
                    "explanation": f"В уроке «{lt}» есть запрос на доработку.",
                    "suggested_action": "Стоит повторить тему вместе с преподавателем.",
                }
            )
        if (row.attempts or 0) >= 4 and (row.score or 0) < 60 and row.status != "completed":
            signals.append(
                {
                    "severity": "info",
                    "title": "Много попыток без уверенного результата",
                    "explanation": "Несколько попыток — часть обучения; важна поддержка без давления.",
                    "suggested_action": "Предложите вместе разобрать задание по шагам.",
                }
            )
    last_activity: datetime | None = None
    for row in UserProgress.query.filter_by(user_id=student.id).all():
        for dt in (row.started_at, row.completed_at):
            if dt and (last_activity is None or _ensure_aware(dt) > last_activity):
                last_activity = _ensure_aware(dt)
    if last_activity and (now - last_activity).days >= 5:
        signals.append(
            {
                "severity": "info",
                "title": "Долго не было учебной активности",
                "explanation": "Несколько дней подряд без уроков и практики — бывает в загруженные недели.",
                "suggested_action": "Можно вместе выбрать короткое спокойное окно для занятий.",
            }
        )
    return signals[:12]


def weekly_activity_prev_week(
    student: User, allowed_module_slugs: set[str] | None = None
) -> list[dict]:
    today = datetime.now(UTC).date()
    start_prev = today - timedelta(days=13)
    end_prev = today - timedelta(days=7)
    rows: list[dict] = []
    progresses = [
        row
        for row in UserProgress.query.filter_by(user_id=student.id).all()
        if lesson_allowed_for_parent(row.lesson, allowed_module_slugs)
    ]
    assignments = [
        row
        for row in AssignmentSubmission.query.filter_by(student_id=student.id).all()
        if assignment_allowed_for_parent(row.assignment, allowed_module_slugs)
    ]
    grouped: dict[str, dict[str, int]] = defaultdict(
        lambda: {"lessons": 0, "assignments": 0, "score_sum": 0, "score_count": 0}
    )
    for progress in progresses:
        if progress.status == "completed" and progress.completed_at:
            d = progress.completed_at.date()
            if start_prev <= d <= end_prev:
                key = d.isoformat()
                grouped[key]["lessons"] += 1
                grouped[key]["score_sum"] += progress.score
                grouped[key]["score_count"] += 1
    for submission in assignments:
        d = submission.submitted_at.date()
        if start_prev <= d <= end_prev:
            key = d.isoformat()
            grouped[key]["assignments"] += 1
            grouped[key]["score_sum"] += submission.score
            grouped[key]["score_count"] += 1
    day = end_prev
    for _ in range(7):
        key = day.isoformat()
        score_count = grouped[key]["score_count"]
        rows.append(
            {
                "date": key,
                "label": day.strftime("%d.%m"),
                "lessons": grouped[key]["lessons"],
                "assignments": grouped[key]["assignments"],
                "average_score": (
                    round(grouped[key]["score_sum"] / score_count, 1) if score_count else 0
                ),
            }
        )
        day -= timedelta(days=1)
    rows.reverse()
    return rows


def _count_weekly_events(student: User, allowed_module_slugs: set[str] | None) -> float:
    start, end = _week_range()
    n = 0.0
    for row in UserProgress.query.filter_by(user_id=student.id).all():
        if not lesson_allowed_for_parent(row.lesson, allowed_module_slugs):
            continue
        if row.status == "completed" and row.completed_at and start <= _ensure_aware(row.completed_at) <= end:
            n += 1
    for sub in AssignmentSubmission.query.filter_by(student_id=student.id).all():
        if not assignment_allowed_for_parent(sub.assignment, allowed_module_slugs):
            continue
        if start <= _ensure_aware(sub.submitted_at) <= end:
            n += 1
    return n


def _count_prev_week_events(student: User, allowed_module_slugs: set[str] | None) -> float:
    now = datetime.now(UTC)
    end = (now - timedelta(days=7)).replace(hour=23, minute=59, second=59, microsecond=999999)
    start = end - timedelta(days=7)
    n = 0.0
    for row in UserProgress.query.filter_by(user_id=student.id).all():
        if not lesson_allowed_for_parent(row.lesson, allowed_module_slugs):
            continue
        if (
            row.status == "completed"
            and row.completed_at
            and start <= _ensure_aware(row.completed_at) <= end
        ):
            n += 1
    for sub in AssignmentSubmission.query.filter_by(student_id=student.id).all():
        if not assignment_allowed_for_parent(sub.assignment, allowed_module_slugs):
            continue
        if start <= _ensure_aware(sub.submitted_at) <= end:
            n += 1
    return n


def activity_trend_text(student: User, allowed_module_slugs: set[str] | None) -> str:
    a = _count_weekly_events(student, allowed_module_slugs)
    b = _count_prev_week_events(student, allowed_module_slugs)
    if b <= 0 and a <= 0:
        return "Пока мало событий за последние две недели — это нормально в начале пути."
    if b <= 0:
        return "На этой неделе активности больше, чем на прошлой."
    pct = int(round((a - b) / max(b, 1) * 100))
    if abs(pct) < 5:
        return "Активность на этой неделе близка к прошлой — стабильный темп."
    if pct > 0:
        return f"Событий за неделю стало больше примерно на {min(pct, 100)}% по сравнению с прошлой."
    return f"Событий за неделю стало меньше примерно на {min(abs(pct), 100)}% — можно мягко поддержать ритм."

