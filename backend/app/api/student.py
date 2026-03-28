from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime, timedelta

from flask import Blueprint, request

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
from ..core.security import auth_required, hash_password, validate_password
from ..models.learning import (
    Achievement,
    Assignment,
    AssignmentSubmission,
    ClassMembership,
    Classroom,
    Lesson,
    Module,
    ParentInvite,
    Quiz,
    Task,
    UserAchievement,
    UserProgress,
    lesson_requires_teacher_review as lesson_requires_teacher_review_helper,
)
from ..models.user import User, UserRole
from ..seed.bootstrap import generate_code


student_bp = Blueprint('student', __name__)


STATE_MAP = {
    'completed': 'completed',
    'current': 'current',
    'locked': 'locked',
    'open': 'open',
}

PROGRESS_STATUS_LABELS = {
    'not_started': 'Урок ещё не начат.',
    'in_progress': 'Прогресс сохранён. Урок остаётся в процессе.',
    'pending_review': 'Урок отправлен учителю и ожидает проверки.',
    'needs_revision': 'Учитель просит доработать урок и отправить его заново.',
    'completed': 'Урок завершён и отмечен как пройденный.',
}

MANUAL_REVIEW_PROGRESS_STATUSES = {'pending_review', 'needs_revision'}
VALID_AGE_GROUPS = {'junior', 'middle', 'senior'}


def _get_or_create_progress(user_id: int, lesson_id: int) -> UserProgress:
    progress = UserProgress.query.filter_by(user_id=user_id, lesson_id=lesson_id).first()
    if progress:
        return progress
    progress = UserProgress(user_id=user_id, lesson_id=lesson_id, status='not_started')
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


def _normalize_age_group(value: str | None, default: str = 'middle') -> str:
    normalized = (value or '').strip().lower()
    return normalized if normalized in VALID_AGE_GROUPS else default


def _status_from_completion_percent(lesson: Lesson, completion_percent: int) -> str:
    if completion_percent >= lesson.passing_score:
        return 'completed'
    if completion_percent > 0:
        return 'in_progress'
    return 'not_started'


def _lesson_requires_teacher_review(lesson: Lesson) -> bool:
    return lesson_requires_teacher_review_helper(lesson)


def _lesson_state_for_user(user: User, module: Module, lesson: Lesson, lesson_index: int) -> str:
    progress = UserProgress.query.filter_by(user_id=user.id, lesson_id=lesson.id).first()
    if progress and progress.status == 'completed':
        return STATE_MAP['completed']
    if module.is_custom_classroom_module:
        return STATE_MAP['current'] if progress and progress.status in {'in_progress', *MANUAL_REVIEW_PROGRESS_STATUSES} else STATE_MAP['open']
    if lesson_index == 0:
        return STATE_MAP['current'] if not progress or progress.status != 'completed' else STATE_MAP['completed']
    prev_lesson = module.lessons[lesson_index - 1]
    prev_progress = UserProgress.query.filter_by(user_id=user.id, lesson_id=prev_lesson.id).first()
    if prev_progress and prev_progress.status == 'completed' and prev_progress.score >= prev_lesson.passing_score:
        return STATE_MAP['current']
    return STATE_MAP['locked']


def _lesson_context(lesson: Lesson) -> tuple[Module, int]:
    module = lesson.module
    lesson_index = next((idx for idx, item in enumerate(module.lessons) if item.id == lesson.id), 0)
    return module, lesson_index


def _student_has_assignment_for_lesson(student: User, lesson: Lesson) -> bool:
    return (
        Assignment.query.join(ClassMembership, ClassMembership.classroom_id == Assignment.classroom_id)
        .filter(ClassMembership.student_id == student.id, Assignment.lesson_id == lesson.id)
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
        return ClassMembership.query.filter_by(classroom_id=classroom_id, student_id=user.id).first() is not None
    if user.role == UserRole.TEACHER:
        return Classroom.query.filter_by(id=classroom_id, teacher_id=user.id).first() is not None
    return True


def _effective_lesson_state_for_student(student: User, lesson: Lesson) -> str:
    module, lesson_index = _lesson_context(lesson)
    state = _lesson_state_for_user(student, module, lesson, lesson_index)
    if state == STATE_MAP['locked'] and _student_has_assignment_for_lesson(student, lesson):
        return STATE_MAP['open']
    return state


def _normalize_text(value: str) -> str:
    return ' '.join((value or '').strip().lower().split())


def _question_is_correct(question: dict, actual) -> bool:
    qtype = question.get('type', 'single')
    correct = question.get('correct')

    if qtype == 'single':
        expected = correct[0] if isinstance(correct, list) and correct else correct
        if isinstance(actual, list):
            actual = actual[0] if actual else None
        return actual == expected

    if qtype == 'multiple':
        expected = sorted(correct or [])
        if not isinstance(actual, list):
            actual = [actual] if actual is not None else []
        return sorted(actual) == expected

    if qtype == 'order':
        if not isinstance(actual, list):
            return False
        return actual == (correct or [])

    if qtype == 'match':
        expected_map = correct or {}
        return isinstance(actual, dict) and actual == expected_map

    if qtype == 'text':
        accepted = correct if isinstance(correct, list) else [correct]
        return _normalize_text(str(actual)) in {_normalize_text(str(item)) for item in accepted}

    return False


def _compact_progress_report(student: User) -> dict:
    progresses = UserProgress.query.filter_by(user_id=student.id).all()
    completed = [row for row in progresses if row.status == 'completed']
    total_score = sum(row.score for row in completed)
    assignments = AssignmentSubmission.query.filter_by(student_id=student.id).all()
    return {
        'completed_lessons': len(completed),
        'average_score': round(total_score / len(completed), 1) if completed else 0,
        'tasks_submitted': len(assignments),
        'current_level': student.level,
        'xp': student.xp,
        'streak': student.streak,
    }


def _weekly_activity(student: User) -> list[dict]:
    rows = []
    progresses = UserProgress.query.filter_by(user_id=student.id).all()
    assignments = AssignmentSubmission.query.filter_by(student_id=student.id).all()
    grouped: dict[str, dict[str, int]] = defaultdict(lambda: {'lessons': 0, 'assignments': 0, 'score_sum': 0, 'score_count': 0})
    for progress in progresses:
        if progress.status == 'completed' and progress.completed_at:
            key = progress.completed_at.date().isoformat()
            grouped[key]['lessons'] += 1
            grouped[key]['score_sum'] += progress.score
            grouped[key]['score_count'] += 1
    for submission in assignments:
        key = submission.submitted_at.date().isoformat()
        grouped[key]['assignments'] += 1
        grouped[key]['score_sum'] += submission.score
        grouped[key]['score_count'] += 1
    today = datetime.now(UTC).date()
    for offset in range(6, -1, -1):
        day = today - timedelta(days=offset)
        key = day.isoformat()
        score_count = grouped[key]['score_count']
        rows.append({
            'date': key,
            'label': day.strftime('%d.%m'),
            'lessons': grouped[key]['lessons'],
            'assignments': grouped[key]['assignments'],
            'average_score': round(grouped[key]['score_sum'] / score_count, 1) if score_count else 0,
        })
    return rows


def _module_report(student: User) -> list[dict]:
    modules = Module.query.filter_by(is_published=True, age_group=student.age_group or 'middle').order_by(Module.order_index.asc()).all()
    payload = []
    for module in modules:
        completed = 0
        total = len(module.lessons)
        for idx, lesson in enumerate(module.lessons):
            state = _lesson_state_for_user(student, module, lesson, idx)
            if state == 'completed':
                completed += 1
        payload.append({
            'id': module.id,
            'title': module.title,
            'color': module.color,
            'completed_lessons': completed,
            'total_lessons': total,
            'progress_percent': int((completed / max(total, 1)) * 100),
        })
    return payload


def _assignment_summary(student: User) -> list[dict]:
    submissions = AssignmentSubmission.query.filter_by(student_id=student.id).order_by(AssignmentSubmission.submitted_at.desc()).limit(5).all()
    return [submission.to_dict() for submission in submissions]


def _assignment_payload_for_student(student: User, assignment: Assignment, classroom_name: str | None = None) -> dict:
    submission = AssignmentSubmission.query.filter_by(assignment_id=assignment.id, student_id=student.id).first()
    lesson_state = None
    lesson_accessible = False
    if assignment.lesson and _user_can_access_lesson(student, assignment.lesson):
        lesson_state = _effective_lesson_state_for_student(student, assignment.lesson)
        lesson_accessible = lesson_state != STATE_MAP['locked']
    return {
        **assignment.to_dict(),
        'classroom_name': classroom_name or assignment.classroom.name,
        'submission': submission.to_dict() if submission else None,
        'lesson_state': lesson_state,
        'lesson_accessible': lesson_accessible,
    }


@student_bp.get('/bootstrap')
def bootstrap_public():
    modules = Module.query.filter_by(is_published=True).order_by(Module.order_index.asc()).all()
    return {
        'stats': {
            'modules': len(modules),
            'lessons': sum(len(module.lessons) for module in modules),
            'roles': 4,
        },
        'featured_modules': [module.to_dict(include_lessons=True) for module in modules[:4]],
    }


@student_bp.get('/dashboard')
@auth_required()
def dashboard(current_user: User):
    progresses = UserProgress.query.filter_by(user_id=current_user.id).all()
    completed_lessons = [item for item in progresses if item.status == 'completed']
    sync_achievements_for_user(current_user)
    achievements = UserAchievement.query.filter_by(user_id=current_user.id).all()
    assignments = (
        Assignment.query.join(Classroom)
        .join(ClassMembership, ClassMembership.classroom_id == Classroom.id)
        .filter(ClassMembership.student_id == current_user.id)
        .order_by(Assignment.created_at.desc())
        .all()
    ) if current_user.role == UserRole.STUDENT else []

    continue_lesson = None
    modules = Module.query.filter_by(is_published=True, age_group=current_user.age_group or 'middle').order_by(Module.order_index.asc()).all()
    for module in modules:
        for idx, lesson in enumerate(module.lessons):
            state = _lesson_state_for_user(current_user, module, lesson, idx)
            if state == 'current':
                continue_lesson = {'module_title': module.title, **lesson.to_summary_dict()}
                break
        if continue_lesson:
            break

    parent_invite = ParentInvite.query.filter_by(student_id=current_user.id, active=True).order_by(ParentInvite.created_at.desc()).first() if current_user.role == UserRole.STUDENT else None
    assignments_preview = [
        _assignment_payload_for_student(current_user, assignment)
        for assignment in assignments[:6]
    ] if current_user.role == UserRole.STUDENT else []

    return {
        'user': current_user.to_dict(),
        'summary': {
            'completed_lessons': len(completed_lessons),
            'assignments_open': len(assignments),
            'achievements': len(achievements),
        },
        'continue_lesson': continue_lesson,
        'daily_quests': [
            {'id': 'dq1', 'title': 'Пройди 1 урок', 'xp': 25, 'completed': bool(continue_lesson is None)},
            {'id': 'dq2', 'title': 'Реши 1 практику', 'xp': 20, 'completed': len([row for row in completed_lessons if row.score >= 70]) > 0},
            {'id': 'dq3', 'title': 'Ответь на 3 вопроса теста', 'xp': 15, 'completed': len(completed_lessons) > 0},
        ],
        'recent_achievements': [item.achievement.to_dict() for item in achievements[-4:]],
        'my_classes': [membership.classroom.to_dict() for membership in current_user.memberships],
        'assignments_preview': assignments_preview,
        'parent_invite': parent_invite.to_dict() if parent_invite else None,
    }


@student_bp.get('/modules')
@auth_required()
def list_modules(current_user: User):
    requested_group = _normalize_age_group(request.args.get('age_group') or current_user.age_group)
    modules = Module.query.filter_by(is_published=True, age_group=requested_group).order_by(Module.order_index.asc()).all()
    payload = []
    for module in modules:
        lessons = []
        for idx, lesson in enumerate(module.lessons):
            progress = UserProgress.query.filter_by(user_id=current_user.id, lesson_id=lesson.id).first()
            lessons.append({
                **lesson.to_summary_dict(),
                'state': _lesson_state_for_user(current_user, module, lesson, idx),
                'progress': progress.to_dict() if progress else None,
            })
        payload.append({**module.to_dict(), 'lessons': lessons})
    return {'modules': payload, 'age_group': requested_group}


@student_bp.get('/modules/<int:module_id>/lessons')
@auth_required()
def module_lessons(current_user: User, module_id: int):
    module = Module.query.get_or_404(module_id)
    lessons = []
    for idx, lesson in enumerate(module.lessons):
        progress = UserProgress.query.filter_by(user_id=current_user.id, lesson_id=lesson.id).first()
        lessons.append({
            **lesson.to_summary_dict(),
            'state': _lesson_state_for_user(current_user, module, lesson, idx),
            'progress': progress.to_dict() if progress else None,
        })
    return {'module': module.to_dict(), 'lessons': lessons}


@student_bp.get('/lessons/<int:lesson_id>')
@auth_required()
def get_lesson(current_user: User, lesson_id: int):
    lesson = Lesson.query.get_or_404(lesson_id)
    if not _user_can_access_lesson(current_user, lesson):
        return {'message': 'У вас нет доступа к этому уроку.'}, 403
    module, idx = _lesson_context(lesson)
    state = _lesson_state_for_user(current_user, module, lesson, idx)
    if current_user.role == UserRole.STUDENT:
        state = _effective_lesson_state_for_student(current_user, lesson)
        if state == STATE_MAP['locked']:
            return {'message': 'Сначала завершите предыдущий урок.'}, 403
    progress = _get_or_create_progress(current_user.id, lesson.id)
    changed = False
    if progress.status == 'not_started':
        progress.status = 'in_progress'
        changed = True
    if progress.status == 'in_progress' and progress.started_at is None:
        _mark_progress_started(progress)
        changed = True
    if changed:
        db.session.commit()
    return {'lesson': lesson.to_dict(), 'state': state, 'progress': progress.to_dict()}


@student_bp.post('/lessons/<int:lesson_id>/gigachat')
@auth_required()
def lesson_gigachat(current_user: User, lesson_id: int):
    lesson = Lesson.query.get_or_404(lesson_id)
    if not _user_can_access_lesson(current_user, lesson):
        return {'message': 'У вас нет доступа к этому уроку.'}, 403
    if current_user.role == UserRole.STUDENT and _effective_lesson_state_for_student(current_user, lesson) == STATE_MAP['locked']:
        return {'message': 'Сначала откройте доступ к этому уроку.'}, 403

    data = request.get_json() or {}
    try:
        payload = request_lesson_chat_completion(
            lesson=lesson,
            current_user=current_user,
            raw_messages=data.get('messages'),
            current_answer=(data.get('current_answer') or '').strip() or None,
        )
    except GigaChatConfigurationError as exc:
        return {'message': str(exc)}, 400
    except GigaChatUnavailableError as exc:
        return {'message': str(exc)}, 503

    return payload


@student_bp.patch('/lessons/<int:lesson_id>/complete')
@auth_required([UserRole.STUDENT])
def complete_lesson(current_user: User, lesson_id: int):
    lesson = Lesson.query.get_or_404(lesson_id)
    if not _user_can_access_lesson(current_user, lesson):
        return {'message': 'У вас нет доступа к этому уроку.'}, 403
    if _effective_lesson_state_for_student(current_user, lesson) == STATE_MAP['locked']:
        return {'message': 'Сначала завершите предыдущий урок.'}, 403

    data = request.get_json() or {}
    completion_percent = _clamp_completion_percent(data.get('completion_percent'))
    submitted_answer = (data.get('answer') or '').strip()
    progress = _get_or_create_progress(current_user.id, lesson.id)
    manual_review_required = _lesson_requires_teacher_review(lesson)
    has_practice_task = bool(lesson.tasks)

    # Preserve the best saved lesson percentage so repeated openings do not roll progress back.
    effective_percent = max(completion_percent, progress.score)
    progress.score = effective_percent
    if manual_review_required and effective_percent >= lesson.passing_score:
        if progress.status != 'completed' and has_practice_task and not submitted_answer:
            return {'message': 'Сначала заполни ответ по практике, а затем заверши урок.'}, 400
        progress.status = 'completed' if progress.status == 'completed' else 'pending_review'
    else:
        progress.status = _status_from_completion_percent(lesson, effective_percent)

    if progress.status == 'in_progress' and progress.started_at is None and effective_percent > 0:
        _mark_progress_started(progress)

    if progress.status in {'completed', 'pending_review'}:
        progress.completed_at = progress.completed_at or datetime.now(UTC)
        sync_student_assignment_submissions_for_lesson(current_user, lesson, progress, answer=submitted_answer or None)
    else:
        progress.completed_at = None

    sync_achievements_for_user(current_user)
    completed_lessons_count = UserProgress.query.filter(
        UserProgress.user_id == current_user.id,
        UserProgress.status.in_(['completed', 'pending_review']),
    ).count()
    first_completed_lesson = progress.status in {'completed', 'pending_review'} and completed_lessons_count == 1

    db.session.commit()
    return {
        'message': PROGRESS_STATUS_LABELS[progress.status],
        'completion_percent': completion_percent,
        'progress': progress.to_dict(),
        'state': _effective_lesson_state_for_student(current_user, lesson),
        'redirect_url': '/profile',
        'first_completed_lesson': first_completed_lesson,
    }


@student_bp.post('/tasks/<int:task_id>/submit')
@auth_required()
def submit_task(current_user: User, task_id: int):
    task = Task.query.get_or_404(task_id)
    if not _user_can_access_lesson(current_user, task.lesson):
        return {'message': 'У вас нет доступа к этому уроку.'}, 403
    if current_user.role == UserRole.STUDENT and _effective_lesson_state_for_student(current_user, task.lesson) == STATE_MAP['locked']:
        return {'message': 'Сначала откройте доступ к этому уроку через предыдущее задание или учителя.'}, 403
    data = request.get_json() or {}
    raw_answer = data.get('answer') or ''
    has_answer = bool(raw_answer.strip())
    manual_review_required = task.requires_teacher_review()
    judge_report = None
    validation = task.normalized_validation(include_private=True)
    if validation['evaluation_mode'] == 'manual':
        score = 100 if has_answer else 0
        passed = has_answer
        feedback = (
            'Ответ сохранён. Теперь заверши урок, чтобы отправить его учителю на проверку.'
            if has_answer
            else 'Добавь решение, чтобы сохранить ответ для учителя.'
        )
    else:
        if not has_answer:
            return {'message': 'Сначала добавь решение в редактор.'}, 400
        try:
            judge_report = judge_task_submission(task, raw_answer)
        except CodeJudgeConfigurationError as exc:
            return {'message': str(exc)}, 400
        except CodeJudgeUnavailableError as exc:
            return {'message': str(exc)}, 503
        score = judge_report['score']
        passed = judge_report['passed']
        feedback = judge_report['feedback']

    progress = _get_or_create_progress(current_user.id, task.lesson_id)
    progress.attempts += 1
    was_completed = progress.status == 'completed'
    xp_awarded = 0
    if manual_review_required:
        if progress.status != 'completed':
            progress.status = 'in_progress' if has_answer else progress.status
            if has_answer and progress.status == 'in_progress':
                _mark_progress_started(progress)
    else:
        progress.score = max(progress.score, score)
        if passed:
            progress.status = 'completed'
            progress.completed_at = progress.completed_at or datetime.now(UTC)
            if not was_completed:
                current_user.add_xp(task.xp_reward)
                xp_awarded = task.xp_reward
        elif has_answer and progress.status == 'not_started':
            progress.status = 'in_progress'
            _mark_progress_started(progress)
    if progress.status == 'completed':
        sync_student_assignment_submissions_for_lesson(
            current_user,
            task.lesson,
            progress,
            answer=raw_answer or None,
            feedback=summarize_judge_report(judge_report) if judge_report else None,
        )
    if not manual_review_required:
        _award_achievement_if_needed(current_user, code='first_code')
    sync_achievements_for_user(current_user)
    db.session.commit()
    return {
        'passed': passed,
        'score': score,
        'xp_awarded': xp_awarded,
        'feedback': feedback,
        'judge_report': judge_report,
        'requires_teacher_review': manual_review_required,
        'progress': progress.to_dict(),
        'user': current_user.to_dict(),
    }


@student_bp.post('/quizzes/<int:quiz_id>/submit')
@auth_required()
def submit_quiz(current_user: User, quiz_id: int):
    quiz = Quiz.query.get_or_404(quiz_id)
    if not _user_can_access_lesson(current_user, quiz.lesson):
        return {'message': 'У вас нет доступа к этому уроку.'}, 403
    if current_user.role == UserRole.STUDENT and _effective_lesson_state_for_student(current_user, quiz.lesson) == STATE_MAP['locked']:
        return {'message': 'Сначала откройте доступ к этому уроку через предыдущее задание или учителя.'}, 403
    answers = (request.get_json() or {}).get('answers', {})
    correct = 0
    details = []
    for question in quiz.questions:
        question_id = question['id']
        actual = answers.get(question_id)
        is_correct = _question_is_correct(question, actual)
        if is_correct:
            correct += 1
        details.append({'id': question_id, 'correct': is_correct, 'type': question.get('type', 'single')})
    score = int((correct / max(len(quiz.questions), 1)) * 100)
    progress = _get_or_create_progress(current_user.id, quiz.lesson_id)
    progress.attempts += 1
    progress.score = max(progress.score, score)
    passed = score >= quiz.passing_score
    was_completed = progress.status == 'completed'
    xp_awarded = 0
    manual_review_required = _lesson_requires_teacher_review(quiz.lesson)
    if passed:
        progress.status = 'pending_review' if manual_review_required and not was_completed else 'completed'
        progress.completed_at = progress.completed_at or datetime.now(UTC)
        if not was_completed and not manual_review_required:
            current_user.add_xp(quiz.xp_reward)
            xp_awarded = quiz.xp_reward
    elif progress.status == 'not_started':
        progress.status = 'in_progress'
        _mark_progress_started(progress)
    if progress.status in {'completed', 'pending_review'}:
        sync_student_assignment_submissions_for_lesson(current_user, quiz.lesson, progress)
    sync_achievements_for_user(current_user)
    db.session.commit()
    return {
        'passed': passed,
        'score': score,
        'correct_answers': correct,
        'total_questions': len(quiz.questions),
        'xp_awarded': xp_awarded,
        'details': details,
        'progress': progress.to_dict(),
        'user': current_user.to_dict(),
    }


@student_bp.get('/achievements')
@auth_required()
def list_achievements(current_user: User):
    sync_achievements_for_user(current_user)
    earned_ids = {item.achievement_id for item in UserAchievement.query.filter_by(user_id=current_user.id).all()}
    achievements = Achievement.query.order_by(Achievement.id.asc()).all()
    return {
        'achievements': [{**achievement.to_dict(), 'earned': achievement.id in earned_ids} for achievement in achievements]
    }


@student_bp.get('/leaderboard')
@auth_required()
def leaderboard(current_user: User):
    age_group = request.args.get('age_group')
    query = User.query.filter(User.role == UserRole.STUDENT, User.is_active.is_(True))
    if age_group:
        query = query.filter_by(age_group=age_group)
    students = query.order_by(User.xp.desc(), User.created_at.asc()).limit(50).all()
    payload = []
    for idx, student in enumerate(students, start=1):
        payload.append({'position': idx, 'username': student.username, 'xp': student.xp, 'level': student.level, 'age_group': student.age_group})
    return {'leaderboard': payload, 'me': current_user.to_dict()}


@student_bp.post('/classes/join')
@auth_required([UserRole.STUDENT])
def join_class(current_user: User):
    data = request.get_json() or {}
    code = (data.get('code') or '').strip().upper()
    classroom = Classroom.query.filter_by(code=code).first()
    if not classroom:
        return {'message': 'Класс с таким кодом не найден.'}, 404
    if ClassMembership.query.filter_by(classroom_id=classroom.id, student_id=current_user.id).first():
        return {'message': 'Вы уже в этом классе.', 'classroom': classroom.to_dict()}
    db.session.add(ClassMembership(classroom_id=classroom.id, student_id=current_user.id))
    db.session.commit()
    return {'message': 'Вы присоединились к классу.', 'classroom': classroom.to_dict()}


@student_bp.get('/classes/my')
@auth_required([UserRole.STUDENT])
def my_classes(current_user: User):
    memberships = ClassMembership.query.filter_by(student_id=current_user.id).all()
    classrooms = [membership.classroom.to_dict() for membership in memberships]
    assignments = []
    for membership in memberships:
        for assignment in membership.classroom.assignments:
            assignments.append(_assignment_payload_for_student(current_user, assignment, membership.classroom.name))
    return {'classes': classrooms, 'assignments': assignments}


@student_bp.post('/assignments/<int:assignment_id>/submit')
@auth_required([UserRole.STUDENT])
def submit_assignment(current_user: User, assignment_id: int):
    assignment = Assignment.query.get_or_404(assignment_id)
    membership = ClassMembership.query.filter_by(classroom_id=assignment.classroom_id, student_id=current_user.id).first()
    if not membership:
        return {'message': 'Это задание не назначено вашему классу.'}, 403
    answer = (request.get_json() or {}).get('answer', '')
    existing = AssignmentSubmission.query.filter_by(assignment_id=assignment.id, student_id=current_user.id).first()
    score = 100 if len(answer.strip()) >= 10 else 60
    if existing:
        existing.answer = answer
        existing.score = max(existing.score, score)
        existing.status = 'pending_review'
    else:
        db.session.add(AssignmentSubmission(assignment_id=assignment.id, student_id=current_user.id, answer=answer, score=score, status='pending_review'))
    db.session.commit()
    return {'message': 'Ответ отправлен учителю на проверку.', 'user': current_user.to_dict()}


@student_bp.get('/users/me')
@auth_required()
def my_profile(current_user: User):
    sync_achievements_for_user(current_user)
    return {'user': current_user.to_dict(), 'report': _compact_progress_report(current_user)}


@student_bp.patch('/users/me')
@auth_required()
def update_profile(current_user: User):
    data = request.get_json() or {}
    if 'full_name' in data and data['full_name']:
        current_user.full_name = data['full_name']
    if 'theme' in data and data['theme'] in {'light', 'dark'}:
        current_user.theme = data['theme']
    if 'password' in data:
        password = data.get('password') or ''
        if password:
            password_error = validate_password(password, minimum_length=6)
            if password_error:
                return {'message': password_error}, 400
            current_user.password_hash = hash_password(password)
    db.session.commit()
    return {'user': current_user.to_dict()}


@student_bp.post('/parent/invite')
@auth_required([UserRole.STUDENT])
def create_parent_invite(current_user: User):
    data = request.get_json() or {}
    existing = ParentInvite.query.filter_by(student_id=current_user.id, active=True).order_by(ParentInvite.created_at.desc()).first()
    if existing:
        return {'invite': existing.to_dict(), 'url': f"/parent/{existing.code}"}
    invite = ParentInvite(
        student_id=current_user.id,
        code=f"PAR-{generate_code(8)}",
        label=data.get('label') or 'Семейный доступ',
        weekly_limit_minutes=data.get('weekly_limit_minutes'),
        modules_whitelist=data.get('modules_whitelist') or [],
        expires_at=ParentInvite.next_month_expiry(),
    )
    db.session.add(invite)
    db.session.commit()
    return {'invite': invite.to_dict(), 'url': f"/parent/{invite.code}"}, 201


@student_bp.get('/parent/invites')
@auth_required([UserRole.STUDENT])
def list_parent_invites(current_user: User):
    invites = ParentInvite.query.filter_by(student_id=current_user.id).order_by(ParentInvite.created_at.desc()).all()
    return {'invites': [invite.to_dict() for invite in invites]}


@student_bp.patch('/parent/invite/<string:code>')
@auth_required([UserRole.STUDENT])
def update_parent_invite(current_user: User, code: str):
    invite = ParentInvite.query.filter_by(code=code, student_id=current_user.id).first_or_404()
    data = request.get_json() or {}
    if 'active' in data:
        invite.active = bool(data['active'])
    if 'weekly_limit_minutes' in data:
        invite.weekly_limit_minutes = int(data['weekly_limit_minutes']) if data['weekly_limit_minutes'] else None
    if 'modules_whitelist' in data:
        invite.modules_whitelist = data['modules_whitelist'] or []
    db.session.commit()
    return {'invite': invite.to_dict()}


@student_bp.get('/parent/access/<string:code>')
def parent_access(code: str):
    invite = ParentInvite.query.filter_by(code=code, active=True).first()
    if not invite or invite.is_expired or not invite.student or not invite.student.is_active:
        return {'message': 'Ссылка недействительна или истекла.'}, 404

    student = invite.student
    sync_achievements_for_user(student)
    achievements = UserAchievement.query.filter_by(user_id=student.id).order_by(UserAchievement.earned_at.desc()).all()
    return {
        'invite': invite.to_dict(),
        'child': student.to_dict(),
        'summary': _compact_progress_report(student),
        'weekly_activity': _weekly_activity(student),
        'modules': _module_report(student),
        'recent_achievements': [row.achievement.to_dict() for row in achievements[:4]],
        'recent_assignments': _assignment_summary(student),
    }


def _award_achievement_if_needed(user: User, code: str) -> None:
    achievement = Achievement.query.filter_by(code=code).first()
    if not achievement:
        return
    exists = UserAchievement.query.filter_by(user_id=user.id, achievement_id=achievement.id).first()
    if exists:
        return
    db.session.add(UserAchievement(user_id=user.id, achievement_id=achievement.id))
    user.add_xp(achievement.xp_reward)
    db.session.flush()
