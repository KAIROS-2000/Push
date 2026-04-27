from __future__ import annotations

import json

import redis
from datetime import UTC, datetime, timedelta

from flask import Blueprint, abort, request

from ..core.config import Config
from ..core.code_judge import (
    CodeJudgeConfigurationError,
    CodeJudgeUnavailableError,
    judge_task_submission,
    summarize_judge_report,
)
from ..core.assignment_sync import sync_student_assignment_submissions_for_lesson
from ..core.achievements import sync_achievements_for_user
from ..core.db import db
from ..core.gigachat import (
    GigaChatConfigurationError,
    GigaChatUnavailableError,
    request_lesson_chat_completion,
)
from ..core.security import (
    auth_required,
    hash_password,
    revoke_refresh_tokens_for_user,
    validate_password,
)
from ..models.learning import (
    Achievement,
    Assignment,
    AssignmentSubmission,
    ClassJoinRequest,
    ClassMembership,
    Classroom,
    Lesson,
    Module,
    Quiz,
    Task,
    UserAchievement,
    UserProgress,
    lesson_requires_teacher_review as lesson_requires_teacher_review_helper,
)
from ..models.parent_cabinet import ParentLinkCode
from ..models.user import User, UserRole
from ..services import parent_insights
from ..services.parent_privacy import child_hidden_from_public_catalog


student_bp = Blueprint("student", __name__)


STATE_MAP = {
    "completed": "completed",
    "current": "current",
    "locked": "locked",
    "open": "open",
}

PROGRESS_STATUS_LABELS = {
    "not_started": "Урок ещё не начат.",
    "in_progress": "Прогресс сохранён. Урок остаётся в процессе.",
    "pending_review": "Урок отправлен учителю и ожидает проверки.",
    "needs_revision": "Учитель просит доработать урок и отправить его заново.",
    "completed": "Урок завершён и отмечен как пройденный.",
}

MANUAL_REVIEW_PROGRESS_STATUSES = {"pending_review", "needs_revision"}
VALID_AGE_GROUPS = {"junior", "middle", "senior"}
_AGE_GROUP_RANK = {"junior": 0, "middle": 1, "senior": 2}
LEADERBOARD_LIMIT = 50
GLOBAL_LEADERBOARD_REFRESH_INTERVAL = timedelta(minutes=5)
GLOBAL_LEADERBOARD_CACHE_KEY_ALL = "__all__"
_global_leaderboard_cache: dict[
    tuple[str, str], tuple[datetime, list[dict]]
] = {}


def _user_outranks_lesson(user_age_group: str | None, lesson_age_group: str | None) -> bool:
    user_rank = _AGE_GROUP_RANK.get((user_age_group or "").strip().lower(), 0)
    lesson_rank = _AGE_GROUP_RANK.get((lesson_age_group or "").strip().lower(), 0)
    return user_rank > lesson_rank


def _student_outranks_lesson(user: User, lesson: Lesson | None) -> bool:
    if user.role != UserRole.STUDENT or lesson is None or lesson.module is None:
        return False
    return _user_outranks_lesson(user.age_group, lesson.module.age_group)


def _leaderboard_cache_age_key(age_group: str | None) -> str:
    if not age_group:
        return GLOBAL_LEADERBOARD_CACHE_KEY_ALL
    return age_group.strip().lower()


def _read_leaderboard_from_cache(age_key: str) -> list[dict] | None:
    from ..core.redis_client import get_redis, redis_available, redis_key

    if not redis_available():
        return None
    client = get_redis(Config.REDIS_DB_LEADERBOARD)
    if not client:
        return None
    try:
        raw = client.get(redis_key('leaderboard', 'global', age_key))
        if not raw:
            return None
        data = json.loads(raw)
        if not isinstance(data, list):
            return None
        return [dict(row) for row in data if isinstance(row, dict)]
    except (TypeError, ValueError, json.JSONDecodeError, OSError, redis.RedisError):
        return None


def _write_leaderboard_to_cache(age_key: str, rows: list[dict]) -> None:
    from ..core.redis_client import get_redis, redis_available, redis_key

    if not redis_available():
        return
    client = get_redis(Config.REDIS_DB_LEADERBOARD)
    if not client:
        return
    try:
        ttl = int(GLOBAL_LEADERBOARD_REFRESH_INTERVAL.total_seconds())
        client.setex(
            redis_key('leaderboard', 'global', age_key),
            ttl,
            json.dumps(rows, ensure_ascii=False),
        )
    except (TypeError, ValueError, OSError, redis.RedisError):
        pass


def _leaderboard_row(student: User, position: int) -> dict:
    return {
        "id": student.id,
        "position": position,
        "username": student.username,
        "full_name": student.full_name,
        "xp": student.xp,
        "level": student.level,
        "age_group": student.age_group,
    }


def _student_memberships(user: User) -> list[ClassMembership]:
    if user.role != UserRole.STUDENT:
        return []

    return (
        ClassMembership.query.join(Classroom)
        .filter(ClassMembership.student_id == user.id)
        .order_by(Classroom.name.asc(), Classroom.id.asc())
        .all()
    )


def _classrooms_payload(memberships: list[ClassMembership]) -> list[dict]:
    return [membership.classroom.to_dict() for membership in memberships]


def _global_leaderboard_rows(age_group: str | None) -> list[dict]:
    now = datetime.now(UTC)
    age_key = _leaderboard_cache_age_key(age_group)
    redis_rows = _read_leaderboard_from_cache(age_key)
    if redis_rows is not None:
        visible: list[dict] = []
        for row in redis_rows:
            sid = row.get("id")
            try:
                if sid is not None and child_hidden_from_public_catalog(int(sid)):
                    continue
            except (TypeError, ValueError):
                pass
            visible.append(dict(row))
            if len(visible) >= LEADERBOARD_LIMIT:
                break
        return [
            {**r, "position": idx} for idx, r in enumerate(visible[:LEADERBOARD_LIMIT], start=1)
        ]

    cache_key = (str(db.engine.url), age_key)
    cached = _global_leaderboard_cache.get(cache_key)
    if cached and cached[0] > now:
        return [row.copy() for row in cached[1]]

    query = User.query.filter(User.role == UserRole.STUDENT, User.is_active.is_(True))
    if age_group:
        query = query.filter_by(age_group=age_group)

    students = (
        query.order_by(User.xp.desc(), User.created_at.asc())
        .limit(LEADERBOARD_LIMIT * 3)
        .all()
    )
    students = [s for s in students if not child_hidden_from_public_catalog(s.id)][
        :LEADERBOARD_LIMIT
    ]
    rows = [_leaderboard_row(student, idx) for idx, student in enumerate(students, start=1)]
    _global_leaderboard_cache[cache_key] = (
        now + GLOBAL_LEADERBOARD_REFRESH_INTERVAL,
        rows,
    )
    _write_leaderboard_to_cache(age_key, rows)
    return [row.copy() for row in rows]


def _class_leaderboard_rows(classroom_id: int) -> list[dict]:
    students = (
        User.query.join(ClassMembership, ClassMembership.student_id == User.id)
        .filter(
            ClassMembership.classroom_id == classroom_id,
            User.role == UserRole.STUDENT,
            User.is_active.is_(True),
        )
        .order_by(User.xp.desc(), User.created_at.asc())
        .limit(LEADERBOARD_LIMIT * 3)
        .all()
    )
    students = [s for s in students if not child_hidden_from_public_catalog(s.id)][
        :LEADERBOARD_LIMIT
    ]
    return [_leaderboard_row(student, idx) for idx, student in enumerate(students, start=1)]


def _get_or_create_progress(user_id: int, lesson_id: int) -> UserProgress:
    progress = UserProgress.query.filter_by(
        user_id=user_id, lesson_id=lesson_id
    ).first()
    if progress:
        return progress
    progress = UserProgress(user_id=user_id, lesson_id=lesson_id, status="not_started")
    db.session.add(progress)
    db.session.flush()
    return progress


def _mark_progress_started(progress: UserProgress) -> None:
    if progress.started_at is None:
        progress.started_at = datetime.now(UTC)


def _clamp_completion_percent(value) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        parsed = 0
    return max(0, min(parsed, 100))


def _coerce_nonnegative_int(value) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        parsed = 0
    return max(0, parsed)


def _normalize_age_group(value: str | None, default: str = "middle") -> str:
    normalized = (value or "").strip().lower()
    return normalized if normalized in VALID_AGE_GROUPS else default


def _status_from_completion_percent(lesson: Lesson, completion_percent: int) -> str:
    if completion_percent >= lesson.passing_score:
        return "completed"
    if completion_percent > 0:
        return "in_progress"
    return "not_started"


def _lesson_requires_teacher_review(lesson: Lesson) -> bool:
    return lesson_requires_teacher_review_helper(lesson)


def _lesson_state_for_user(
    user: User, module: Module, lesson: Lesson, lesson_index: int
) -> str:
    progress = UserProgress.query.filter_by(
        user_id=user.id, lesson_id=lesson.id
    ).first()
    if progress and progress.status == "completed":
        return STATE_MAP["completed"]
    if module.is_custom_classroom_module:
        return (
            STATE_MAP["current"]
            if progress
            and progress.status in {"in_progress", *MANUAL_REVIEW_PROGRESS_STATUSES}
            else STATE_MAP["open"]
        )
    if lesson_index == 0:
        return (
            STATE_MAP["current"]
            if not progress or progress.status != "completed"
            else STATE_MAP["completed"]
        )
    prev_lesson = module.lessons[lesson_index - 1]
    prev_progress = UserProgress.query.filter_by(
        user_id=user.id, lesson_id=prev_lesson.id
    ).first()
    if (
        prev_progress
        and prev_progress.status == "completed"
        and prev_progress.score >= prev_lesson.passing_score
    ):
        return STATE_MAP["current"]
    return STATE_MAP["locked"]


def _lesson_context(lesson: Lesson) -> tuple[Module, int]:
    module = lesson.module
    lesson_index = next(
        (idx for idx, item in enumerate(module.lessons) if item.id == lesson.id), 0
    )
    return module, lesson_index


def _student_has_assignment_for_lesson(student: User, lesson: Lesson) -> bool:
    return (
        Assignment.query.join(
            ClassMembership, ClassMembership.classroom_id == Assignment.classroom_id
        )
        .filter(
            ClassMembership.student_id == student.id, Assignment.lesson_id == lesson.id
        )
        .first()
        is not None
    )


def _user_can_access_lesson(user: User, lesson: Lesson) -> bool:
    module = lesson.module
    if module.is_published:
        return True
    classroom_id = module.custom_classroom_id
    if classroom_id is None:
        return user.role != UserRole.STUDENT
    if user.role == UserRole.STUDENT:
        return (
            ClassMembership.query.filter_by(
                classroom_id=classroom_id, student_id=user.id
            ).first()
            is not None
        )
    if user.role == UserRole.TEACHER:
        return (
            Classroom.query.filter_by(id=classroom_id, teacher_id=user.id).first()
            is not None
        )
    return True


def _effective_lesson_state_for_student(student: User, lesson: Lesson) -> str:
    module, lesson_index = _lesson_context(lesson)
    state = _lesson_state_for_user(student, module, lesson, lesson_index)
    if state == STATE_MAP["locked"] and _student_has_assignment_for_lesson(
        student, lesson
    ):
        return STATE_MAP["open"]
    return state


def _normalize_text(value: str) -> str:
    return " ".join((value or "").strip().lower().split())


def _question_is_correct(question: dict, actual) -> bool:
    qtype = question.get("type", "single")
    correct = question.get("correct")

    if qtype == "single":
        expected = correct[0] if isinstance(correct, list) and correct else correct
        if isinstance(actual, list):
            actual = actual[0] if actual else None
        return actual == expected

    if qtype == "multiple":
        expected = sorted(correct or [])
        if not isinstance(actual, list):
            actual = [actual] if actual is not None else []
        return sorted(actual) == expected

    if qtype == "order":
        if not isinstance(actual, list):
            return False
        return actual == (correct or [])

    if qtype == "match":
        expected_map = correct or {}
        return isinstance(actual, dict) and actual == expected_map

    if qtype == "text":
        accepted = correct if isinstance(correct, list) else [correct]
        return _normalize_text(str(actual)) in {
            _normalize_text(str(item)) for item in accepted
        }

    return False


def _assignment_payload_for_student(
    student: User, assignment: Assignment, classroom_name: str | None = None
) -> dict:
    submission = AssignmentSubmission.query.filter_by(
        assignment_id=assignment.id, student_id=student.id
    ).first()
    lesson_state = None
    lesson_accessible = False
    if assignment.lesson and _user_can_access_lesson(student, assignment.lesson):
        lesson_state = _effective_lesson_state_for_student(student, assignment.lesson)
        lesson_accessible = lesson_state != STATE_MAP["locked"]
    return {
        **assignment.to_dict(),
        "classroom_name": classroom_name or assignment.classroom.name,
        "submission": submission.to_dict() if submission else None,
        "lesson_state": lesson_state,
        "lesson_accessible": lesson_accessible,
    }


@student_bp.get("/bootstrap")
def bootstrap_public():
    modules = (
        Module.query.filter_by(is_published=True)
        .order_by(Module.order_index.asc())
        .all()
    )
    return {
        "stats": {
            "modules": len(modules),
            "lessons": sum(len(module.lessons) for module in modules),
            "roles": 5,
        },
        "featured_modules": [
            module.to_dict(include_lessons=True) for module in modules[:4]
        ],
    }


@student_bp.get("/dashboard")
@auth_required()
def dashboard(current_user: User):
    if current_user.role == UserRole.PARENT:
        return {
            "message": "Семейный кабинет: откройте /parent/dashboard.",
        }, 403
    progresses = UserProgress.query.filter_by(user_id=current_user.id).all()
    completed_lessons = [item for item in progresses if item.status == "completed"]
    achievements = UserAchievement.query.filter_by(user_id=current_user.id).all()
    assignments = (
        (
            Assignment.query.join(Classroom)
            .join(ClassMembership, ClassMembership.classroom_id == Classroom.id)
            .filter(ClassMembership.student_id == current_user.id)
            .order_by(Assignment.created_at.desc())
            .all()
        )
        if current_user.role == UserRole.STUDENT
        else []
    )

    continue_lesson = None
    modules = (
        Module.query.filter_by(
            is_published=True, age_group=current_user.age_group or "middle"
        )
        .order_by(Module.order_index.asc())
        .all()
    )
    for module in modules:
        for idx, lesson in enumerate(module.lessons):
            state = _lesson_state_for_user(current_user, module, lesson, idx)
            if state == "current":
                continue_lesson = {
                    "module_title": module.title,
                    **lesson.to_summary_dict(),
                }
                break
        if continue_lesson:
            break

    active_parent_code = None
    if current_user.role == UserRole.STUDENT:
        now = datetime.now(UTC)
        active_parent_code = (
            ParentLinkCode.query.filter(
                ParentLinkCode.child_user_id == current_user.id,
                ParentLinkCode.used_at.is_(None),
                ParentLinkCode.revoked_at.is_(None),
                ParentLinkCode.expires_at > now,
            )
            .order_by(ParentLinkCode.created_at.desc())
            .first()
        )
    assignments_preview = (
        [
            _assignment_payload_for_student(current_user, assignment)
            for assignment in assignments[:6]
        ]
        if current_user.role == UserRole.STUDENT
        else []
    )

    return {
        "user": current_user.to_dict(),
        "summary": {
            "completed_lessons": len(completed_lessons),
            "assignments_open": len(assignments),
            "achievements": len(achievements),
        },
        "continue_lesson": continue_lesson,
        "daily_quests": [
            {
                "id": "dq1",
                "title": "Пройди 1 урок",
                "xp": 25,
                "completed": bool(continue_lesson is None),
            },
            {
                "id": "dq2",
                "title": "Реши 1 практику",
                "xp": 20,
                "completed": len([row for row in completed_lessons if row.score >= 70])
                > 0,
            },
            {
                "id": "dq3",
                "title": "Ответь на 3 вопроса теста",
                "xp": 15,
                "completed": len(completed_lessons) > 0,
            },
        ],
        "recent_achievements": [
            item.achievement.to_dict() for item in achievements[-4:]
        ],
        "my_classes": [
            membership.classroom.to_dict() for membership in current_user.memberships
        ],
        "assignments_preview": assignments_preview,
        "parent_link_code": {
            "active": bool(active_parent_code),
            "expires_at": active_parent_code.expires_at.isoformat() if active_parent_code else None,
        },
    }


@student_bp.get("/modules")
@auth_required()
def list_modules(current_user: User):
    requested_group = _normalize_age_group(
        request.args.get("age_group") or current_user.age_group
    )
    modules = (
        Module.query.filter_by(is_published=True, age_group=requested_group)
        .order_by(Module.order_index.asc())
        .all()
    )
    payload = []
    for module in modules:
        lessons = []
        for idx, lesson in enumerate(module.lessons):
            progress = UserProgress.query.filter_by(
                user_id=current_user.id, lesson_id=lesson.id
            ).first()
            lessons.append(
                {
                    **lesson.to_summary_dict(),
                    "state": _lesson_state_for_user(current_user, module, lesson, idx),
                    "progress": progress.to_dict() if progress else None,
                }
            )
        payload.append({**module.to_dict(), "lessons": lessons})
    return {"modules": payload, "age_group": requested_group}


@student_bp.get("/modules/<int:module_id>/lessons")
@auth_required()
def module_lessons(current_user: User, module_id: int):
    module = Module.query.get_or_404(module_id)
    lessons = []
    for idx, lesson in enumerate(module.lessons):
        progress = UserProgress.query.filter_by(
            user_id=current_user.id, lesson_id=lesson.id
        ).first()
        lessons.append(
            {
                **lesson.to_summary_dict(),
                "state": _lesson_state_for_user(current_user, module, lesson, idx),
                "progress": progress.to_dict() if progress else None,
            }
        )
    return {"module": module.to_dict(), "lessons": lessons}


@student_bp.get("/lessons/<int:lesson_id>")
@auth_required()
def get_lesson(current_user: User, lesson_id: int):
    lesson = db.session.get(Lesson, lesson_id)
    if lesson is None:
        abort(404)
    if not _user_can_access_lesson(current_user, lesson):
        return {"message": "У вас нет доступа к этому уроку."}, 403
    module, idx = _lesson_context(lesson)
    state = _lesson_state_for_user(current_user, module, lesson, idx)
    if current_user.role == UserRole.STUDENT:
        state = _effective_lesson_state_for_student(current_user, lesson)
        if state == STATE_MAP["locked"]:
            return {"message": "Сначала завершите предыдущий урок."}, 403
    progress = UserProgress.query.filter_by(
        user_id=current_user.id, lesson_id=lesson.id
    ).first()
    if progress is None:
        progress = UserProgress(
            user_id=current_user.id, lesson_id=lesson.id, status="not_started"
        )
    include_quiz_review = progress.status in {"completed", "pending_review"}
    finished = state == STATE_MAP["completed"] or progress.status == "completed"
    return {
        "lesson": lesson.to_dict(include_private=include_quiz_review),
        "state": state,
        "progress": progress.to_dict(),
        "is_finished": finished,
        "viewer_role": current_user.role.value,
    }


@student_bp.post("/lessons/<int:lesson_id>/gigachat")
@auth_required()
def lesson_gigachat(current_user: User, lesson_id: int):
    lesson = Lesson.query.get_or_404(lesson_id)
    if not _user_can_access_lesson(current_user, lesson):
        return {"message": "У вас нет доступа к этому уроку."}, 403
    if (
        current_user.role == UserRole.STUDENT
        and _effective_lesson_state_for_student(current_user, lesson)
        == STATE_MAP["locked"]
    ):
        return {"message": "Сначала откройте доступ к этому уроку."}, 403

    data = request.get_json() or {}
    try:
        payload = request_lesson_chat_completion(
            lesson=lesson,
            current_user=current_user,
            raw_messages=data.get("messages"),
            current_answer=(data.get("current_answer") or "").strip() or None,
        )
    except GigaChatConfigurationError as exc:
        return {"message": str(exc)}, 400
    except GigaChatUnavailableError as exc:
        return {"message": str(exc)}, 503

    return payload


@student_bp.patch("/lessons/<int:lesson_id>/complete")
@auth_required([UserRole.STUDENT])
def complete_lesson(current_user: User, lesson_id: int):
    lesson = Lesson.query.get_or_404(lesson_id)
    if not _user_can_access_lesson(current_user, lesson):
        return {"message": "У вас нет доступа к этому уроку."}, 403
    if _effective_lesson_state_for_student(current_user, lesson) == STATE_MAP["locked"]:
        return {"message": "Сначала завершите предыдущий урок."}, 403

    data = request.get_json() or {}
    completion_percent = _clamp_completion_percent(data.get("completion_percent"))
    submitted_answer = (data.get("answer") or "").strip()
    progress = _get_or_create_progress(current_user.id, lesson.id)
    manual_review_required = _lesson_requires_teacher_review(lesson)
    has_practice_task = bool(lesson.tasks)

    # Preserve the best saved lesson percentage so repeated openings do not roll progress back.
    effective_percent = max(completion_percent, progress.score)
    progress.score = effective_percent
    if manual_review_required and effective_percent >= lesson.passing_score:
        if (
            progress.status != "completed"
            and has_practice_task
            and not submitted_answer
        ):
            return {
                "message": "Сначала заполни ответ по практике, а затем заверши урок."
            }, 400
        progress.status = (
            "completed" if progress.status == "completed" else "pending_review"
        )
    else:
        progress.status = _status_from_completion_percent(lesson, effective_percent)

    if (
        progress.status == "in_progress"
        and progress.started_at is None
        and effective_percent > 0
    ):
        _mark_progress_started(progress)

    if progress.status in {"completed", "pending_review"}:
        progress.completed_at = progress.completed_at or datetime.now(UTC)
        sync_student_assignment_submissions_for_lesson(
            current_user, lesson, progress, answer=submitted_answer or None
        )
    else:
        progress.completed_at = None

    sync_achievements_for_user(
        current_user,
        award_xp=not _student_outranks_lesson(current_user, lesson),
    )
    completed_lessons_count = UserProgress.query.filter(
        UserProgress.user_id == current_user.id,
        UserProgress.status.in_(["completed", "pending_review"]),
    ).count()
    first_completed_lesson = (
        progress.status in {"completed", "pending_review"}
        and completed_lessons_count == 1
    )

    db.session.commit()
    return {
        "message": PROGRESS_STATUS_LABELS[progress.status],
        "completion_percent": completion_percent,
        "progress": progress.to_dict(),
        "state": _effective_lesson_state_for_student(current_user, lesson),
        "redirect_url": "/profile",
        "first_completed_lesson": first_completed_lesson,
    }


@student_bp.post("/tasks/<int:task_id>/submit")
@auth_required()
def submit_task(current_user: User, task_id: int):
    task = Task.query.get_or_404(task_id)
    if not _user_can_access_lesson(current_user, task.lesson):
        return {"message": "У вас нет доступа к этому уроку."}, 403
    if (
        current_user.role == UserRole.STUDENT
        and _effective_lesson_state_for_student(current_user, task.lesson)
        == STATE_MAP["locked"]
    ):
        return {
            "message": "Сначала откройте доступ к этому уроку через предыдущее задание или учителя."
        }, 403
    data = request.get_json() or {}
    raw_answer = data.get("answer") or ""
    has_answer = bool(raw_answer.strip())
    hints_used = _coerce_nonnegative_int(data.get("hints_used"))
    manual_review_required = task.requires_teacher_review()
    judge_report = None
    validation = task.normalized_validation(include_private=True)
    if validation["evaluation_mode"] == "manual":
        score = 100 if has_answer else 0
        passed = has_answer
        feedback = (
            "Ответ сохранён. Теперь заверши урок, чтобы отправить его учителю на проверку."
            if has_answer
            else "Добавь решение, чтобы сохранить ответ для учителя."
        )
    else:
        if not has_answer:
            return {"message": "Сначала добавь решение в редактор."}, 400
        try:
            judge_report = judge_task_submission(task, raw_answer)
        except CodeJudgeConfigurationError as exc:
            return {"message": str(exc)}, 400
        except CodeJudgeUnavailableError as exc:
            return {"message": str(exc)}, 503
        score = judge_report["score"]
        passed = judge_report["passed"]
        feedback = judge_report["feedback"]

    progress = _get_or_create_progress(current_user.id, task.lesson_id)
    progress.attempts += 1
    progress.hints_used = max(int(progress.hints_used or 0), hints_used)
    was_completed = progress.status == "completed"
    xp_awarded = 0
    xp_skipped = False
    outranks_lesson = _student_outranks_lesson(current_user, task.lesson)
    if manual_review_required:
        if progress.status != "completed":
            progress.status = "in_progress" if has_answer else progress.status
            if has_answer and progress.status == "in_progress":
                _mark_progress_started(progress)
    else:
        progress.score = max(progress.score, score)
        if passed:
            _mark_progress_started(progress)
            progress.status = "completed"
            progress.completed_at = progress.completed_at or datetime.now(UTC)
            if not was_completed:
                if outranks_lesson:
                    xp_skipped = True
                else:
                    current_user.add_xp(task.xp_reward)
                    xp_awarded = task.xp_reward
        elif has_answer and progress.status == "not_started":
            progress.status = "in_progress"
            _mark_progress_started(progress)
    if progress.status == "completed":
        sync_student_assignment_submissions_for_lesson(
            current_user,
            task.lesson,
            progress,
            answer=raw_answer or None,
            feedback=summarize_judge_report(judge_report) if judge_report else None,
        )
    if not manual_review_required:
        _award_achievement_if_needed(
            current_user, code="first_code", award_xp=not outranks_lesson
        )
    sync_achievements_for_user(current_user, award_xp=not outranks_lesson)
    db.session.commit()
    return {
        "passed": passed,
        "score": score,
        "xp_awarded": xp_awarded,
        "xp_skipped": xp_skipped,
        "feedback": feedback,
        "judge_report": judge_report,
        "requires_teacher_review": manual_review_required,
        "progress": progress.to_dict(),
        "user": current_user.to_dict(),
    }


@student_bp.post("/lessons/<int:lesson_id>/start")
@auth_required([UserRole.STUDENT])
def start_lesson(current_user: User, lesson_id: int):
    lesson = Lesson.query.get_or_404(lesson_id)
    if not _user_can_access_lesson(current_user, lesson):
        return {"message": "У вас нет доступа к этому уроку."}, 403
    if _effective_lesson_state_for_student(current_user, lesson) == STATE_MAP["locked"]:
        return {"message": "Сначала завершите предыдущий урок."}, 403

    progress = _get_or_create_progress(current_user.id, lesson.id)
    _mark_progress_started(progress)
    db.session.commit()
    return {"progress": progress.to_dict()}


@student_bp.post("/lessons/<int:lesson_id>/hints")
@auth_required([UserRole.STUDENT])
def record_lesson_hints(current_user: User, lesson_id: int):
    lesson = Lesson.query.get_or_404(lesson_id)
    if not _user_can_access_lesson(current_user, lesson):
        return {"message": "У вас нет доступа к этому уроку."}, 403
    if _effective_lesson_state_for_student(current_user, lesson) == STATE_MAP["locked"]:
        return {"message": "Сначала завершите предыдущий урок."}, 403

    data = request.get_json() or {}
    progress = _get_or_create_progress(current_user.id, lesson.id)
    _mark_progress_started(progress)
    progress.hints_used = max(
        int(progress.hints_used or 0),
        _coerce_nonnegative_int(data.get("hints_used")),
    )
    db.session.commit()
    return {"progress": progress.to_dict()}


@student_bp.post("/quizzes/<int:quiz_id>/submit")
@auth_required()
def submit_quiz(current_user: User, quiz_id: int):
    quiz = Quiz.query.get_or_404(quiz_id)
    if not _user_can_access_lesson(current_user, quiz.lesson):
        return {"message": "У вас нет доступа к этому уроку."}, 403
    if (
        current_user.role == UserRole.STUDENT
        and _effective_lesson_state_for_student(current_user, quiz.lesson)
        == STATE_MAP["locked"]
    ):
        return {
            "message": "Сначала откройте доступ к этому уроку через предыдущее задание или учителя."
        }, 403
    answers = (request.get_json() or {}).get("answers", {})
    correct = 0
    details = []
    for question in quiz.questions:
        question_id = question["id"]
        actual = answers.get(question_id)
        is_correct = _question_is_correct(question, actual)
        if is_correct:
            correct += 1
        details.append(
            {
                "id": question_id,
                "correct": is_correct,
                "type": question.get("type", "single"),
            }
        )
    score = int((correct / max(len(quiz.questions), 1)) * 100)
    progress = _get_or_create_progress(current_user.id, quiz.lesson_id)
    progress.attempts += 1
    _mark_progress_started(progress)
    progress.score = max(progress.score, score)
    passed = score >= quiz.passing_score
    was_completed = progress.status == "completed"
    xp_awarded = 0
    xp_skipped = False
    manual_review_required = _lesson_requires_teacher_review(quiz.lesson)
    outranks_lesson = _student_outranks_lesson(current_user, quiz.lesson)
    if passed:
        progress.status = (
            "pending_review"
            if manual_review_required and not was_completed
            else "completed"
        )
        progress.completed_at = progress.completed_at or datetime.now(UTC)
        if not was_completed and not manual_review_required:
            if outranks_lesson:
                xp_skipped = True
            else:
                current_user.add_xp(quiz.xp_reward)
                xp_awarded = quiz.xp_reward
    elif progress.status == "not_started":
        progress.status = "in_progress"
        _mark_progress_started(progress)
    if progress.status in {"completed", "pending_review"}:
        sync_student_assignment_submissions_for_lesson(
            current_user, quiz.lesson, progress
        )
    sync_achievements_for_user(current_user, award_xp=not outranks_lesson)
    db.session.commit()
    return {
        "passed": passed,
        "score": score,
        "correct_answers": correct,
        "total_questions": len(quiz.questions),
        "xp_awarded": xp_awarded,
        "xp_skipped": xp_skipped,
        "details": details,
        "review_questions": quiz.to_dict(include_private=True)["questions"],
        "progress": progress.to_dict(),
        "user": current_user.to_dict(),
    }


@student_bp.get("/achievements")
@auth_required()
def list_achievements(current_user: User):
    earned_ids = {
        item.achievement_id
        for item in UserAchievement.query.filter_by(user_id=current_user.id).all()
    }
    achievements = Achievement.query.order_by(Achievement.id.asc()).all()
    return {
        "achievements": [
            {**achievement.to_dict(), "earned": achievement.id in earned_ids}
            for achievement in achievements
        ]
    }


@student_bp.get("/leaderboard")
@auth_required()
def leaderboard(current_user: User):
    age_group = request.args.get("age_group")
    scope = (request.args.get("scope") or "global").strip().lower()
    memberships = _student_memberships(current_user)
    classes = _classrooms_payload(memberships)

    if scope == "class":
        if not memberships:
            return {"message": "Вы не состоите в классе."}, 403

        classroom_id = request.args.get("classroom_id", type=int)
        if classroom_id is not None:
            selected_membership = next(
                (
                    membership
                    for membership in memberships
                    if membership.classroom_id == classroom_id
                ),
                None,
            )
            if selected_membership is None:
                return {"message": "Этот класс недоступен."}, 403
        else:
            selected_membership = memberships[0]

        classroom = selected_membership.classroom
        return {
            "leaderboard": _class_leaderboard_rows(classroom.id),
            "me": current_user.to_dict(),
            "classes": classes,
            "scope": "class",
            "classroom": classroom.to_dict(),
            "refresh_seconds": 0,
        }

    return {
        "leaderboard": _global_leaderboard_rows(age_group),
        "me": current_user.to_dict(),
        "classes": classes,
        "scope": "global",
        "classroom": None,
        "refresh_seconds": int(GLOBAL_LEADERBOARD_REFRESH_INTERVAL.total_seconds()),
    }


@student_bp.post("/classes/join")
@auth_required([UserRole.STUDENT])
def join_class(current_user: User):
    data = request.get_json() or {}
    code = (data.get("code") or "").strip().upper()
    classroom = Classroom.query.filter_by(code=code).first()
    if not classroom:
        return {"message": "Класс с таким кодом не найден."}, 404
    if ClassMembership.query.filter_by(
        classroom_id=classroom.id, student_id=current_user.id
    ).first():
        return {"message": "Вы уже в этом классе.", "classroom": classroom.to_dict()}

    pending_request = ClassJoinRequest.query.filter_by(
        classroom_id=classroom.id, student_id=current_user.id, status="pending"
    ).first()
    if pending_request:
        return {
            "message": "Заявка уже отправлена и ожидает подтверждения учителя.",
            "classroom": classroom.to_dict(),
            "request": pending_request.to_dict(),
        }

    join_request = ClassJoinRequest(
        classroom_id=classroom.id,
        student_id=current_user.id,
        status="pending",
    )
    db.session.add(join_request)
    db.session.commit()
    return {
        "message": "Заявка отправлена учителю. После подтверждения класс появится в кабинете.",
        "classroom": classroom.to_dict(),
        "request": join_request.to_dict(),
    }, 202


@student_bp.get("/classes/my")
@auth_required([UserRole.STUDENT])
def my_classes(current_user: User):
    memberships = ClassMembership.query.filter_by(student_id=current_user.id).all()
    classrooms = [membership.classroom.to_dict() for membership in memberships]
    assignments = []
    for membership in memberships:
        for assignment in membership.classroom.assignments:
            assignments.append(
                _assignment_payload_for_student(
                    current_user, assignment, membership.classroom.name
                )
            )
    return {"classes": classrooms, "assignments": assignments}


@student_bp.post("/assignments/<int:assignment_id>/submit")
@auth_required([UserRole.STUDENT])
def submit_assignment(current_user: User, assignment_id: int):
    assignment = Assignment.query.get_or_404(assignment_id)
    membership = ClassMembership.query.filter_by(
        classroom_id=assignment.classroom_id, student_id=current_user.id
    ).first()
    if not membership:
        return {"message": "Это задание не назначено вашему классу."}, 403
    answer = (request.get_json() or {}).get("answer", "")
    existing = AssignmentSubmission.query.filter_by(
        assignment_id=assignment.id, student_id=current_user.id
    ).first()
    score = 100 if len(answer.strip()) >= 10 else 60
    if existing:
        existing.answer = answer
        existing.score = max(existing.score, score)
        existing.status = "pending_review"
    else:
        db.session.add(
            AssignmentSubmission(
                assignment_id=assignment.id,
                student_id=current_user.id,
                answer=answer,
                score=score,
                status="pending_review",
            )
        )
    db.session.commit()
    return {
        "message": "Ответ отправлен учителю на проверку.",
        "user": current_user.to_dict(),
    }


@student_bp.get("/users/me")
@auth_required()
def my_profile(current_user: User):
    return {
        "user": current_user.to_dict(),
        "report": parent_insights.compact_progress_report(current_user),
    }


@student_bp.patch("/users/me")
@auth_required()
def update_profile(current_user: User):
    data = request.get_json() or {}
    if "full_name" in data and data["full_name"]:
        current_user.full_name = data["full_name"]
    if "theme" in data and data["theme"] in {"light", "dark"}:
        current_user.theme = data["theme"]
    if "password" in data:
        password = data.get("password") or ""
        if password:
            password_error = validate_password(password)
            if password_error:
                return {"message": password_error}, 400
            current_user.password_hash = hash_password(password)
            revoke_refresh_tokens_for_user(current_user.id)
    db.session.commit()
    return {"user": current_user.to_dict()}


@student_bp.post("/student/parent-link-code")
@auth_required([UserRole.STUDENT])
def create_student_parent_link_code(current_user: User):
    now = datetime.now(UTC)
    open_codes = (
        ParentLinkCode.query.filter(
            ParentLinkCode.child_user_id == current_user.id,
            ParentLinkCode.used_at.is_(None),
            ParentLinkCode.revoked_at.is_(None),
        )
        .all()
    )
    for row in open_codes:
        row.revoked_at = now
    for _ in range(8):
        plain = parent_insights.generate_parent_link_code_plain()
        digest = parent_insights.hash_parent_link_code(plain)
        if not ParentLinkCode.query.filter_by(code_hash=digest).first():
            break
    else:
        return {"message": "Не удалось сгенерировать уникальный код. Повторите попытку."}, 500
    expires = ParentLinkCode.default_expiry()
    row = ParentLinkCode(
        child_user_id=current_user.id,
        code_hash=digest,
        expires_at=expires,
    )
    db.session.add(row)
    db.session.commit()
    return {
        "code": plain,
        "expires_at": expires.isoformat(),
        "message": "Передайте этот код родителю. Он сможет привязать кабинет в разделе для родителей.",
    }, 201


@student_bp.get("/student/parent-link-codes")
@auth_required([UserRole.STUDENT])
def list_student_parent_link_codes(current_user: User):
    rows = (
        ParentLinkCode.query.filter_by(child_user_id=current_user.id)
        .order_by(ParentLinkCode.created_at.desc())
        .all()
    )
    out = []
    for row in rows:
        out.append(
            {
                "id": row.id,
                "expires_at": row.expires_at.isoformat() if row.expires_at else None,
                "used_at": row.used_at.isoformat() if row.used_at else None,
                "revoked_at": row.revoked_at.isoformat() if row.revoked_at else None,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
        )
    return {"codes": out}


@student_bp.post("/student/parent-link-codes/<int:code_id>/revoke")
@auth_required([UserRole.STUDENT])
def revoke_student_parent_link_code(current_user: User, code_id: int):
    row = ParentLinkCode.query.filter_by(id=code_id, child_user_id=current_user.id).first()
    if not row:
        return {"message": "Код не найден."}, 404
    if row.used_at:
        return {"message": "Код уже был использован."}, 400
    row.revoked_at = datetime.now(UTC)
    db.session.commit()
    return {"ok": True}


def _award_achievement_if_needed(user: User, code: str, *, award_xp: bool = True) -> None:
    achievement = Achievement.query.filter_by(code=code).first()
    if not achievement:
        return
    exists = UserAchievement.query.filter_by(
        user_id=user.id, achievement_id=achievement.id
    ).first()
    if exists:
        return
    db.session.add(UserAchievement(user_id=user.id, achievement_id=achievement.id))
    if award_xp:
        user.add_xp(achievement.xp_reward)
    db.session.flush()
