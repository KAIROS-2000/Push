from __future__ import annotations

from datetime import UTC, datetime

from flask import Blueprint, request
from sqlalchemy import or_

from ..core.db import db
from .lesson_builder import build_lesson_quiz
from ..core.security import auth_required
from ..models.learning import (
    Assignment,
    AssignmentSubmission,
    ClassJoinRequest,
    ClassMembership,
    Classroom,
    Lesson,
    Module,
    Task,
    UserProgress,
    age_group_supports_code,
    build_custom_classroom_module_slug,
    custom_classroom_module_slug_prefix,
    encode_assignment_description,
    has_explicit_code_task_intent,
    normalize_assignment_type,
    normalize_submission_format,
    normalize_task_validation,
)
from ..models.user import User, UserRole
from ..services import parent_messaging
from ..services.teacher_query_service import TeacherQueryService
from ..seed.bootstrap import generate_code


teacher_bp = Blueprint('teacher', __name__)
VALID_AGE_GROUPS = {'junior', 'middle', 'senior'}
VALID_DIFFICULTIES = {'easy', 'medium', 'hard'}
VALID_SUBMISSION_REVIEW_STATUSES = {'checked', 'needs_revision'}
VALID_JOIN_REQUEST_STATUSES = {'pending', 'approved', 'rejected'}
ASSIGNMENT_TYPE_DEFAULT_TITLES = {
    'lesson_practice': 'Практика по уроку',
    'mini_project': 'Мини-проект',
    'quiz': 'Тест по теме',
    'reflection': 'Рефлексия по теме',
}
ASSIGNMENT_TYPE_DEFAULT_DESCRIPTIONS = {
    'lesson_practice': 'Повтори ключевые шаги урока и покажи решение.',
    'mini_project': 'Создай мини-проект по теме и опиши, как он работает.',
    'quiz': 'Пройди короткий тест и обоснуй ответы на сложные вопросы.',
    'reflection': 'Коротко опиши, что получилось, что было сложно и что стоит улучшить.',
}
ASSIGNMENT_REQUIRED_FIELD_LABELS = {
    'title': 'название задания',
    'lesson_id': 'урок',
    'due_date': 'дедлайн',
    'learning_goal': 'цель обучения',
    'resources': 'материалы',
    'work_steps': 'шаги выполнения',
    'success_criteria': 'критерии успеха',
    'description': 'описание задания',
}
CLASS_REQUIRED_FIELD_LABELS = {
    'name': 'название класса',
}
LESSON_REQUIRED_FIELD_LABELS = {
    'title': 'название урока',
    'summary': 'краткое описание урока',
    'duration_minutes': 'длительность урока',
    'passing_score': 'минимальный результат для прохождения',
    'theory_text': 'объяснение темы',
    'key_points': 'ключевые идеи',
    'interactive_steps': 'маршрут урока',
    'task_title': 'название практики',
    'task_prompt': 'формулировка задания',
    'starter_code': 'стартовый код',
    'answer_keywords': 'ключевые слова для автопроверки',
    'judge_tests': 'автотесты',
}


def _teacher_classes(current_user: User) -> list[Classroom]:
    return Classroom.query.filter_by(teacher_id=current_user.id).order_by(Classroom.created_at.desc()).all()


def _teacher_join_request_or_404(current_user: User, request_id: int) -> ClassJoinRequest:
    return (
        ClassJoinRequest.query.join(Classroom)
        .filter(ClassJoinRequest.id == request_id, Classroom.teacher_id == current_user.id)
        .first_or_404()
    )


def _safe_int(value, default: int, minimum: int | None = None, maximum: int | None = None) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    if minimum is not None:
        parsed = max(parsed, minimum)
    if maximum is not None:
        parsed = min(parsed, maximum)
    return parsed


def _parse_positive_int(value) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _parse_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _has_text(value) -> bool:
    return bool(str(value or '').strip())


def _has_int_value(value) -> bool:
    return _parse_int(value) is not None


def _normalize_age_group(value: str | None) -> str:
    normalized = (value or 'middle').strip().lower()
    return normalized if normalized in VALID_AGE_GROUPS else 'middle'


def _normalize_difficulty(value: str | None) -> str:
    normalized = (value or 'medium').strip().lower()
    return normalized if normalized in VALID_DIFFICULTIES else 'medium'


def _split_lines(value: str | None) -> list[str]:
    return [item.strip() for item in (value or '').splitlines() if item.strip()]


def _split_csv(value: str | None) -> list[str]:
    return [item.strip() for item in (value or '').split(',') if item.strip()]


def _normalize_due_date(value: str | None) -> str | None:
    normalized = (value or '').strip()
    return normalized or None


def _normalize_submission_review_status(value: str | None) -> str:
    normalized = (value or 'checked').strip().lower()
    return normalized if normalized in VALID_SUBMISSION_REVIEW_STATUSES else 'checked'


def _complete_judge_tests(value) -> list[dict]:
    if not isinstance(value, list):
        return []

    tests: list[dict] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        test_input = str(
            item.get('input')
            if item.get('input') is not None
            else item.get('stdin') or ''
        ).strip()
        expected = str(
            item.get('expected')
            if item.get('expected') is not None
            else item.get('stdout') or ''
        ).strip()
        if test_input and expected:
            tests.append(item)
    return tests


def _has_partial_judge_test(value) -> bool:
    if not isinstance(value, list):
        return False

    for item in value:
        if not isinstance(item, dict):
            continue
        test_input = str(
            item.get('input')
            if item.get('input') is not None
            else item.get('stdin') or ''
        ).strip()
        expected = str(
            item.get('expected')
            if item.get('expected') is not None
            else item.get('stdout') or ''
        ).strip()
        if bool(test_input) != bool(expected):
            return True
    return False


def _lesson_practice_requested(data: dict) -> bool:
    if 'practice_enabled' in data:
        return bool(data.get('practice_enabled'))
    return any(
        [
            _has_text(data.get('task_title')),
            _has_text(data.get('task_prompt')),
            _has_text(data.get('starter_code')),
            bool(_split_csv(data.get('answer_keywords'))),
            bool(data.get('judge_tests')),
        ]
    )


def _compose_assignment_description(data: dict, assignment_type: str) -> str:
    summary = (data.get('description') or '').strip()
    goal = (data.get('learning_goal') or '').strip()
    criteria = _split_lines(data.get('success_criteria'))
    steps = _split_lines(data.get('work_steps'))
    resources = _split_lines(data.get('resources'))

    sections: list[str] = []
    if summary:
        sections.append(summary)
    else:
        sections.append(ASSIGNMENT_TYPE_DEFAULT_DESCRIPTIONS[assignment_type])

    if goal:
        sections.append(f'Цель: {goal}')
    if steps:
        sections.append('Шаги выполнения:\n' + '\n'.join(f'- {item}' for item in steps))
    if criteria:
        sections.append('Критерии успеха:\n' + '\n'.join(f'- {item}' for item in criteria))
    if resources:
        sections.append('Материалы:\n' + '\n'.join(f'- {item}' for item in resources))

    return '\n\n'.join(sections).strip()


def _missing_assignment_fields(data: dict) -> list[str]:
    missing: list[str] = []

    for field in (
        'title',
        'due_date',
        'learning_goal',
        'resources',
        'work_steps',
        'success_criteria',
        'description',
    ):
        if not (data.get(field) or '').strip():
            missing.append(field)

    lesson_id = data.get('lesson_id')
    if lesson_id is None or (isinstance(lesson_id, str) and not lesson_id.strip()):
        missing.append('lesson_id')

    return missing


def _missing_class_fields(data: dict) -> list[str]:
    return ['name'] if not _has_text(data.get('name')) else []


def _missing_lesson_fields(data: dict) -> list[str]:
    missing: list[str] = []

    for field in ('title', 'summary', 'theory_text'):
        if not _has_text(data.get(field)):
            missing.append(field)

    if not _has_int_value(data.get('duration_minutes')):
        missing.append('duration_minutes')
    if not _has_int_value(data.get('passing_score')):
        missing.append('passing_score')
    if len(_split_lines(data.get('key_points')) or _split_csv(data.get('key_points'))) < 2:
        missing.append('key_points')
    if len(_split_lines(data.get('interactive_steps'))) < 2:
        missing.append('interactive_steps')

    if not _lesson_practice_requested(data):
        return missing

    requested_task_type = 'code' if (data.get('task_type') or '').strip().lower() == 'code' else 'text'
    evaluation_mode = (data.get('evaluation_mode') or '').strip().lower()
    needs_tests = requested_task_type == 'code' or evaluation_mode == 'stdin_stdout'

    if not _has_text(data.get('task_title')):
        missing.append('task_title')
    if not _has_text(data.get('task_prompt')):
        missing.append('task_prompt')
    if requested_task_type == 'code' and not _has_text(data.get('starter_code')):
        missing.append('starter_code')
    if evaluation_mode == 'keywords' and not _split_csv(data.get('answer_keywords')):
        missing.append('answer_keywords')
    if needs_tests and (
        not _complete_judge_tests(data.get('judge_tests'))
        or _has_partial_judge_test(data.get('judge_tests'))
    ):
        missing.append('judge_tests')

    return missing


def _get_or_create_custom_module(classroom: Classroom, age_group: str) -> Module:
    slug = build_custom_classroom_module_slug(classroom.id, age_group)
    module = Module.query.filter_by(slug=slug).first()
    if module:
        return module

    module = Module(
        slug=slug,
        title=f'Уроки класса {classroom.name}',
        description=f'Авторские уроки для класса {classroom.name}',
        age_group=age_group,
        icon='book-open',
        color='#0EA5E9',
        order_index=Module.query.count() + 1,
        is_published=False,
    )
    db.session.add(module)
    db.session.flush()
    return module


def _teacher_can_use_lesson(classroom: Classroom, lesson: Lesson) -> bool:
    if lesson.module.is_published:
        return True
    return lesson.module.custom_classroom_id == classroom.id


def _lesson_catalog_item(lesson: Lesson) -> dict:
    return {
        **lesson.to_summary_dict(),
        'lesson_url': f'/lessons/{lesson.id}',
        'module_age_group': lesson.module.age_group,
        'source': 'teacher' if lesson.module.is_custom_classroom_module else 'catalog',
        'source_label': 'Урок учителя' if lesson.module.is_custom_classroom_module else 'Библиотека уроков',
    }


def _catalog_lessons_for_teacher(current_user: User, classroom: Classroom | None = None) -> list[Lesson]:
    filters = [Module.is_published.is_(True)]
    classroom_ids = [classroom.id] if classroom else [item.id for item in _teacher_classes(current_user)]
    filters.extend(Module.slug.like(f'{custom_classroom_module_slug_prefix(classroom_id)}%') for classroom_id in classroom_ids)
    return (
        Lesson.query.join(Module)
        .filter(or_(*filters))
        .order_by(Module.is_published.desc(), Module.title.asc(), Lesson.order_index.asc())
        .all()
    )


@teacher_bp.get('/overview')
@auth_required([UserRole.TEACHER])
def teacher_overview(current_user: User):
    return TeacherQueryService().overview_payload(current_user)


@teacher_bp.post('/classes')
@auth_required([UserRole.TEACHER])
def create_class(current_user: User):
    data = request.get_json() or {}
    missing_fields = _missing_class_fields(data)
    if missing_fields:
        labels = ', '.join(CLASS_REQUIRED_FIELD_LABELS[field] for field in missing_fields)
        return {
            'message': f'Заполните обязательные поля: {labels}.',
            'fields': missing_fields,
        }, 400

    classroom = Classroom(
        name=str(data.get('name') or '').strip(),
        description=(data.get('description') or '').strip() or None,
        code=generate_code(),
        teacher_id=current_user.id,
    )
    db.session.add(classroom)
    db.session.commit()
    return {'classroom': classroom.to_dict()}, 201


@teacher_bp.get('/classes')
@auth_required([UserRole.TEACHER])
def list_classes(current_user: User):
    classes = _teacher_classes(current_user)
    return {'classes': [item.to_dict() for item in classes]}


@teacher_bp.get('/join-requests')
@auth_required([UserRole.TEACHER])
def list_join_requests(current_user: User):
    status = (request.args.get('status') or 'pending').strip().lower()
    if status != 'all' and status not in VALID_JOIN_REQUEST_STATUSES:
        return {'message': 'Некорректный статус заявки.'}, 400

    query = ClassJoinRequest.query.join(Classroom).filter(
        Classroom.teacher_id == current_user.id
    )
    if status != 'all':
        query = query.filter(ClassJoinRequest.status == status)

    join_requests = query.order_by(ClassJoinRequest.created_at.desc()).all()
    return {'requests': [item.to_dict() for item in join_requests]}


@teacher_bp.post('/join-requests/<int:request_id>/approve')
@auth_required([UserRole.TEACHER])
def approve_join_request(current_user: User, request_id: int):
    join_request = _teacher_join_request_or_404(current_user, request_id)
    if join_request.status != 'pending':
        return {'message': 'Заявка уже обработана.'}, 400

    applicant = db.session.get(User, join_request.student_id)
    if not applicant or applicant.role != UserRole.STUDENT:
        return {'message': 'В класс могут вступать только ученики.'}, 400

    existing_membership = ClassMembership.query.filter_by(
        classroom_id=join_request.classroom_id,
        student_id=join_request.student_id,
    ).first()
    if not existing_membership:
        db.session.add(
            ClassMembership(
                classroom_id=join_request.classroom_id,
                student_id=join_request.student_id,
            )
        )

    join_request.status = 'approved'
    join_request.decided_at = datetime.now(UTC)
    join_request.decided_by_id = current_user.id
    db.session.commit()
    return {
        'message': 'Ученик добавлен в класс.',
        'request': join_request.to_dict(),
    }


@teacher_bp.post('/join-requests/<int:request_id>/reject')
@auth_required([UserRole.TEACHER])
def reject_join_request(current_user: User, request_id: int):
    join_request = _teacher_join_request_or_404(current_user, request_id)
    if join_request.status != 'pending':
        return {'message': 'Заявка уже обработана.'}, 400

    join_request.status = 'rejected'
    join_request.decided_at = datetime.now(UTC)
    join_request.decided_by_id = current_user.id
    db.session.commit()
    return {
        'message': 'Заявка отклонена.',
        'request': join_request.to_dict(),
    }


@teacher_bp.get('/classes/<int:classroom_id>')
@auth_required([UserRole.TEACHER])
def class_detail(current_user: User, classroom_id: int):
    return TeacherQueryService().class_detail_payload(current_user, classroom_id)


def _sync_lesson_progress_from_review(submission: AssignmentSubmission) -> None:
    lesson = submission.assignment.lesson
    if lesson is None or not lesson.module.is_custom_classroom_module:
        return

    progress = UserProgress.query.filter_by(user_id=submission.student_id, lesson_id=lesson.id).first()
    if progress is None:
        progress = UserProgress(user_id=submission.student_id, lesson_id=lesson.id, status='not_started')
        db.session.add(progress)
        db.session.flush()

    progress.score = max(progress.score, submission.score)
    if submission.status == 'checked':
        progress.status = 'completed'
        progress.completed_at = progress.completed_at or submission.submitted_at
        return

    progress.status = 'needs_revision'
    progress.completed_at = None


@teacher_bp.post('/classes/<int:classroom_id>/lessons')
@auth_required([UserRole.TEACHER])
def create_class_lesson(current_user: User, classroom_id: int):
    classroom = Classroom.query.filter_by(id=classroom_id, teacher_id=current_user.id).first_or_404()
    data = request.get_json() or {}
    missing_fields = _missing_lesson_fields(data)
    if missing_fields:
        labels = ', '.join(LESSON_REQUIRED_FIELD_LABELS[field] for field in missing_fields)
        return {
            'message': f'Заполните обязательные поля: {labels}.',
            'fields': missing_fields,
        }, 400

    title = (data.get('title') or '').strip()
    summary = (data.get('summary') or '').strip()

    age_group = _normalize_age_group(data.get('age_group'))
    module = _get_or_create_custom_module(classroom, age_group)
    previous_lesson = Lesson.query.filter_by(module_id=module.id).order_by(Lesson.order_index.desc()).first()
    order_index = (previous_lesson.order_index if previous_lesson else 0) + 1

    theory_text = (data.get('theory_text') or '').strip()
    key_points = _split_lines(data.get('key_points')) or _split_csv(data.get('answer_keywords'))
    theory_blocks = [{'type': 'hero', 'title': title, 'text': summary}]
    if theory_text:
        theory_blocks.append({'type': 'text', 'title': 'Объяснение', 'text': theory_text})
    if key_points:
        theory_blocks.append({'type': 'list', 'title': 'Ключевые идеи', 'items': key_points})

    interactive_steps = [
        {'title': f'Шаг {index}', 'text': item}
        for index, item in enumerate(_split_lines(data.get('interactive_steps')), start=1)
    ]

    lesson = Lesson(
        module_id=module.id,
        slug=f'teacher-class-{classroom.id}-lesson-{order_index}-{generate_code(4).lower()}',
        title=title,
        summary=summary,
        content_format='mixed',
        theory_blocks=theory_blocks,
        interactive_steps=interactive_steps,
        order_index=order_index,
        duration_minutes=_safe_int(data.get('duration_minutes'), 10, minimum=5, maximum=180),
        passing_score=_safe_int(data.get('passing_score'), 70, minimum=0, maximum=100),
        is_published=False,
    )
    db.session.add(lesson)
    db.session.flush()

    task_title = (data.get('task_title') or '').strip()
    task_prompt = (data.get('task_prompt') or '').strip()
    starter_code = data.get('starter_code') or ''
    requested_task_type = 'code' if (data.get('task_type') or '').strip().lower() == 'code' else 'text'
    requested_is_code_task = requested_task_type == 'code' or bool(starter_code.strip())
    practice_enabled = _lesson_practice_requested(data)
    answer_keywords = _split_csv(data.get('answer_keywords'))
    explicit_code_intent = has_explicit_code_task_intent(
        title=task_title,
        prompt=task_prompt,
        starter_code=starter_code,
    )
    if requested_task_type == 'text' and explicit_code_intent:
        return {'message': 'Задание выглядит как кодовая практика. Выберите формат "Код" и добавьте автотесты.'}, 400
    judge_tests = data.get('judge_tests')
    requested_code_runner = (data.get('evaluation_mode') or '').strip().lower() == 'stdin_stdout' or bool(judge_tests)
    if not age_group_supports_code(age_group) and (requested_is_code_task or requested_code_runner):
        return {'message': 'Для Junior-уроков кодовая практика недоступна. Используйте текстовое задание без стартового кода и автотестов.'}, 400
    task_hints = _split_lines(data.get('task_hints')) or (
        [
            'Проверь, что программа читает входные данные из stdin.',
            'Сравни формат вывода с ожидаемым ответом посимвольно.',
            'Прогони решение на граничных примерах перед отправкой.',
        ]
        if requested_is_code_task
        else [
            'Сверь ответ с объяснением урока.',
            'Разбей решение на короткие шаги.',
            'Проверь, есть ли в ответе ключевые слова темы.',
        ]
    )
    if practice_enabled:
        task_validation = normalize_task_validation(
            {
                'evaluation_mode': data.get('evaluation_mode'),
                'language': data.get('programming_language'),
                'keywords': answer_keywords,
                'tests': judge_tests,
                'time_limit_ms': data.get('time_limit_ms'),
                'memory_limit_mb': data.get('memory_limit_mb'),
            },
            is_custom_lesson=True,
            task_type='code' if requested_is_code_task else 'text',
            age_group=age_group,
        )
        if requested_is_code_task and not task_validation['tests']:
            return {'message': 'Кодовая задача сохраняется только с автотестами. Добавьте хотя бы один тест с входом и ожидаемым выводом.'}, 400
        if task_validation['evaluation_mode'] == 'keywords' and not task_validation['keywords']:
            return {'message': 'Для автопроверки по ключевым словам добавьте хотя бы одно ключевое слово.'}, 400
        if task_validation['evaluation_mode'] == 'stdin_stdout' and not task_validation['tests']:
            return {'message': 'Для проверки кода добавьте хотя бы один тест с входом и ожидаемым выводом.'}, 400
        task_type = 'code' if requested_is_code_task or task_validation['evaluation_mode'] == 'stdin_stdout' else 'text'
        normalized_starter_code = starter_code if task_type == 'code' else ''
        db.session.add(
            Task(
                lesson_id=lesson.id,
                task_type=task_type,
                title=task_title or f'Практика: {title}',
                prompt=task_prompt or 'Выполни практическое задание по этому уроку.',
                starter_code=normalized_starter_code,
                validation=task_validation,
                hints=task_hints,
                xp_reward=0,
            )
        )

    try:
        quiz = build_lesson_quiz(lesson, data.get('quiz'), title, question_prefix='teacher-q')
        if quiz is not None:
            db.session.add(quiz)
    except ValueError as exc:
        db.session.rollback()
        return {'message': str(exc)}, 400

    db.session.commit()
    return {'lesson': lesson.to_dict(include_private=True), 'catalog_item': _lesson_catalog_item(lesson)}, 201


@teacher_bp.post('/classes/<int:classroom_id>/assignments')
@auth_required([UserRole.TEACHER])
def create_assignment(current_user: User, classroom_id: int):
    classroom = Classroom.query.filter_by(id=classroom_id, teacher_id=current_user.id).first_or_404()
    data = request.get_json() or {}
    missing_fields = _missing_assignment_fields(data)
    if missing_fields:
        labels = ', '.join(ASSIGNMENT_REQUIRED_FIELD_LABELS[field] for field in missing_fields)
        return {
            'message': f'Заполните обязательные поля: {labels}.',
            'fields': missing_fields,
        }, 400

    lesson_id = data.get('lesson_id')
    lesson = None
    assignment_type = normalize_assignment_type(data.get('assignment_type'))
    submission_format = normalize_submission_format(data.get('submission_format'))
    parsed_lesson_id = _parse_positive_int(lesson_id)
    if parsed_lesson_id is None:
        return {'message': 'Некорректный идентификатор урока.'}, 400
    lesson = Lesson.query.get_or_404(parsed_lesson_id)
    if not _teacher_can_use_lesson(classroom, lesson):
        return {'message': 'Этот урок нельзя назначить выбранному классу.'}, 403
    title = (data.get('title') or '').strip()
    description = _compose_assignment_description(data, assignment_type)

    assignment = Assignment(
        classroom_id=classroom.id,
        lesson_id=lesson.id,
        title=title,
        description=encode_assignment_description(description, assignment_type, submission_format),
        difficulty=_normalize_difficulty(data.get('difficulty')),
        due_date=_normalize_due_date(data.get('due_date')),
        xp_reward=0,
    )
    db.session.add(assignment)
    db.session.commit()
    return {'assignment': assignment.to_dict()}, 201


@teacher_bp.get('/classes/<int:classroom_id>/assignments')
@auth_required([UserRole.TEACHER])
def list_assignments(current_user: User, classroom_id: int):
    return TeacherQueryService().class_assignments_payload(current_user, classroom_id)


@teacher_bp.get('/assignments/<int:assignment_id>/submissions')
@auth_required([UserRole.TEACHER])
def assignment_submissions(current_user: User, assignment_id: int):
    try:
        return TeacherQueryService().assignment_submissions_payload(current_user, assignment_id)
    except PermissionError:
        return {'message': 'Forbidden'}, 403


@teacher_bp.patch('/submissions/<int:submission_id>/grade')
@auth_required([UserRole.TEACHER])
def grade_submission(current_user: User, submission_id: int):
    submission = AssignmentSubmission.query.get_or_404(submission_id)
    if submission.assignment.classroom.teacher_id != current_user.id:
        return {'message': 'Forbidden'}, 403
    data = request.get_json() or {}
    submission.score = _safe_int(data.get('score', submission.score), submission.score, minimum=0, maximum=100)
    submission.feedback = data.get('feedback', submission.feedback)
    submission.status = _normalize_submission_review_status(data.get('status'))
    _sync_lesson_progress_from_review(submission)
    db.session.commit()
    return {'submission': submission.to_dict()}


@teacher_bp.get('/lesson-catalog')
@auth_required([UserRole.TEACHER])
def lesson_catalog(current_user: User):
    classroom_id = request.args.get('classroom_id', type=int)
    classroom = None
    if classroom_id:
        classroom = Classroom.query.filter_by(id=classroom_id, teacher_id=current_user.id).first_or_404()
    lessons = _catalog_lessons_for_teacher(current_user, classroom)
    return {'lessons': [_lesson_catalog_item(lesson) for lesson in lessons]}


@teacher_bp.get('/parent-threads')
@auth_required([UserRole.TEACHER])
def teacher_parent_threads(current_user: User):
    return parent_messaging.summary_for_teacher(current_user)


@teacher_bp.get('/parent-threads/<int:thread_id>/messages')
@auth_required([UserRole.TEACHER])
def teacher_parent_thread_messages(current_user: User, thread_id: int):
    return parent_messaging.list_messages_teacher(current_user, thread_id)


@teacher_bp.post('/parent-threads/<int:thread_id>/messages')
@auth_required([UserRole.TEACHER])
def teacher_parent_thread_send(current_user: User, thread_id: int):
    return parent_messaging.send_message_teacher(current_user, thread_id)


@teacher_bp.post('/parent-threads/<int:thread_id>/read')
@auth_required([UserRole.TEACHER])
def teacher_parent_thread_read(current_user: User, thread_id: int):
    return parent_messaging.mark_read_teacher(current_user, thread_id)
