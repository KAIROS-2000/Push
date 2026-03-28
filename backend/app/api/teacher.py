from __future__ import annotations

from flask import Blueprint, request
from sqlalchemy import or_

from ..core.assignment_sync import backfill_assignment_submissions_for_assignment, backfill_assignment_submissions_for_assignments
from ..core.db import db
from ..core.security import auth_required
from ..models.learning import (
    Assignment,
    AssignmentSubmission,
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
from ..seed.bootstrap import generate_code


teacher_bp = Blueprint('teacher', __name__)
VALID_AGE_GROUPS = {'junior', 'middle', 'senior'}
VALID_DIFFICULTIES = {'easy', 'medium', 'hard'}
REVIEWED_SUBMISSION_STATUSES = {'checked', 'needs_revision'}
VALID_SUBMISSION_REVIEW_STATUSES = {'checked', 'needs_revision'}
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


def _teacher_classes(current_user: User) -> list[Classroom]:
    return Classroom.query.filter_by(teacher_id=current_user.id).order_by(Classroom.created_at.desc()).all()


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


def _assignment_with_stats(assignment: Assignment, submissions: list[AssignmentSubmission] | None = None) -> dict:
    rows = submissions if submissions is not None else AssignmentSubmission.query.filter_by(assignment_id=assignment.id).all()
    return {
        **assignment.to_dict(),
        'submissions_count': len(rows),
        'checked_count': len([row for row in rows if row.status in REVIEWED_SUBMISSION_STATUSES]),
    }


def _sync_assignment_stats(assignments: list[Assignment]) -> None:
    if backfill_assignment_submissions_for_assignments(assignments):
        db.session.commit()


@teacher_bp.get('/overview')
@auth_required([UserRole.TEACHER])
def teacher_overview(current_user: User):
    classes = _teacher_classes(current_user)
    assignments = [assignment for classroom in classes for assignment in classroom.assignments]
    _sync_assignment_stats(assignments)
    total_students = sum(len(item.members) for item in classes)
    assignment_stats = [_assignment_with_stats(assignment) for assignment in assignments]
    total_assignments = len(assignments)
    total_submissions = sum(item['submissions_count'] for item in assignment_stats)
    return {
        'summary': {
            'classes': len(classes),
            'students': total_students,
            'assignments': total_assignments,
            'submissions': total_submissions,
        },
        'classes': [item.to_dict() for item in classes],
    }


@teacher_bp.post('/classes')
@auth_required([UserRole.TEACHER])
def create_class(current_user: User):
    data = request.get_json() or {}
    classroom = Classroom(
        name=data.get('name', 'Новый класс'),
        description=data.get('description'),
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


@teacher_bp.get('/classes/<int:classroom_id>')
@auth_required([UserRole.TEACHER])
def class_detail(current_user: User, classroom_id: int):
    classroom = Classroom.query.filter_by(id=classroom_id, teacher_id=current_user.id).first_or_404()
    _sync_assignment_stats(list(classroom.assignments))
    students = []
    for membership in classroom.members:
        progress_rows = UserProgress.query.filter_by(user_id=membership.student.id).all()
        completed = [row for row in progress_rows if row.status == 'completed']
        students.append({
            'id': membership.student.id,
            'username': membership.student.username,
            'full_name': membership.student.full_name,
            'xp': membership.student.xp,
            'level': membership.student.level,
            'completed_lessons': len(completed),
            'average_score': round(sum(row.score for row in completed) / len(completed), 1) if completed else 0,
        })
    assignments = [_assignment_with_stats(assignment) for assignment in classroom.assignments]
    return {'classroom': classroom.to_dict(), 'students': students, 'assignments': assignments}


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
    title = (data.get('title') or '').strip()
    summary = (data.get('summary') or '').strip()
    if not title or not summary:
        return {'message': 'Укажите название и краткое описание урока.'}, 400

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
    if task_title or task_prompt or starter_code or answer_keywords or judge_tests:
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

    db.session.commit()
    return {'lesson': lesson.to_dict(), 'catalog_item': _lesson_catalog_item(lesson)}, 201


@teacher_bp.post('/classes/<int:classroom_id>/assignments')
@auth_required([UserRole.TEACHER])
def create_assignment(current_user: User, classroom_id: int):
    classroom = Classroom.query.filter_by(id=classroom_id, teacher_id=current_user.id).first_or_404()
    data = request.get_json() or {}
    lesson_id = data.get('lesson_id')
    lesson = None
    assignment_type = normalize_assignment_type(data.get('assignment_type'))
    submission_format = normalize_submission_format(data.get('submission_format'))
    if lesson_id:
        parsed_lesson_id = _parse_positive_int(lesson_id)
        if parsed_lesson_id is None:
            return {'message': 'Некорректный идентификатор урока.'}, 400
        lesson = Lesson.query.get_or_404(parsed_lesson_id)
        if not _teacher_can_use_lesson(classroom, lesson):
            return {'message': 'Этот урок нельзя назначить выбранному классу.'}, 403
    title = (data.get('title') or '').strip() or ASSIGNMENT_TYPE_DEFAULT_TITLES[assignment_type]
    description = _compose_assignment_description(data, assignment_type)

    assignment = Assignment(
        classroom_id=classroom.id,
        lesson_id=lesson.id if lesson else None,
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
    classroom = Classroom.query.filter_by(id=classroom_id, teacher_id=current_user.id).first_or_404()
    _sync_assignment_stats(list(classroom.assignments))
    assignments = [_assignment_with_stats(assignment) for assignment in classroom.assignments]
    return {'assignments': assignments}


@teacher_bp.get('/assignments/<int:assignment_id>/submissions')
@auth_required([UserRole.TEACHER])
def assignment_submissions(current_user: User, assignment_id: int):
    assignment = Assignment.query.get_or_404(assignment_id)
    if assignment.classroom.teacher_id != current_user.id:
        return {'message': 'Forbidden'}, 403
    if backfill_assignment_submissions_for_assignment(assignment):
        db.session.commit()
    submissions = AssignmentSubmission.query.filter_by(assignment_id=assignment.id).order_by(AssignmentSubmission.submitted_at.desc()).all()
    return {
        'assignment': _assignment_with_stats(assignment, submissions),
        'submissions': [submission.to_dict() for submission in submissions],
    }


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
