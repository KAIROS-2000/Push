from __future__ import annotations

from flask import Blueprint, request

from ..core.db import db
from ..core.security import auth_required, hash_password, validate_password
from ..models.learning import (
    Lesson,
    Module,
    Quiz,
    Task,
    age_group_supports_code,
    has_explicit_code_task_intent,
    normalize_task_validation,
)
from ..models.user import User, UserRole
from ..seed.bootstrap import generate_code


admin_bp = Blueprint('admin', __name__)
VALID_QUIZ_QUESTION_TYPES = {'single', 'multiple', 'order', 'match', 'text'}


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


def _string_list(value) -> list[str]:
    if isinstance(value, str):
        return [item.strip() for item in value.splitlines() if item.strip()]
    if not isinstance(value, list):
        return []
    rows: list[str] = []
    for item in value:
        text = str(item or '').strip()
        if text:
            rows.append(text)
    return rows


def _split_csv(value: str | None) -> list[str]:
    return [item.strip() for item in (value or '').replace('\n', ',').split(',') if item.strip()]


def _normalized_test_cases(value) -> list[dict]:
    if not isinstance(value, list):
        return []
    rows: list[dict] = []
    for index, item in enumerate(value, start=1):
        if not isinstance(item, dict):
            continue
        test_input = str(item.get('input') if item.get('input') is not None else item.get('stdin') or '')
        expected = str(item.get('expected') if item.get('expected') is not None else item.get('stdout') or '')
        label = str(item.get('label') or f'Тест {index}').strip() or f'Тест {index}'
        if not test_input and not expected:
            continue
        rows.append({'label': label, 'input': test_input, 'expected': expected})
    return rows


def _normalize_module_lessons(module: Module) -> list[Lesson]:
    ordered = sorted(module.lessons, key=lambda lesson: (lesson.order_index, lesson.id))
    for index, lesson in enumerate(ordered, start=1):
        lesson.order_index = index
    db.session.flush()
    return ordered


def _insert_position(module: Module, raw_position) -> int:
    ordered = _normalize_module_lessons(module)
    position = _safe_int(raw_position, len(ordered) + 1, minimum=1, maximum=len(ordered) + 1)
    for lesson in ordered[position - 1:]:
        lesson.order_index += 1
    return position


def _build_theory_blocks(title: str, summary: str, theory_text: str, key_points: list[str]) -> list[dict]:
    blocks = [{'type': 'hero', 'title': title, 'text': summary}]
    if theory_text:
        blocks.append({'type': 'text', 'title': 'Объяснение', 'text': theory_text})
    if key_points:
        blocks.append({'type': 'list', 'title': 'Ключевые идеи', 'items': key_points})
    return blocks


def _build_interactive_steps(raw_steps) -> list[dict]:
    return [
        {'title': f'Шаг {index}', 'text': item}
        for index, item in enumerate(_string_list(raw_steps), start=1)
    ]


def _generate_module_lesson_slug(module: Module) -> str:
    while True:
        slug = f'{module.slug}-lesson-{generate_code(6).lower()}'
        if Lesson.query.filter_by(slug=slug).first() is None:
            return slug


def _normalize_quiz_questions(raw_questions) -> list[dict]:
    if not isinstance(raw_questions, list):
        return []

    normalized: list[dict] = []
    for index, item in enumerate(raw_questions, start=1):
        if not isinstance(item, dict):
            continue
        qtype = str(item.get('type') or 'single').strip().lower()
        prompt = str(item.get('prompt') or '').strip()
        if qtype not in VALID_QUIZ_QUESTION_TYPES or not prompt:
            continue

        question_id = f'admin-q{index}'

        if qtype in {'single', 'multiple'}:
            options = _string_list(item.get('options'))
            if len(options) < 2:
                continue
            raw_correct = item.get('correct')
            raw_indices = raw_correct if isinstance(raw_correct, list) else [raw_correct]
            correct_indices: list[int] = []
            for raw_value in raw_indices:
                try:
                    parsed = int(raw_value)
                except (TypeError, ValueError):
                    continue
                if 0 <= parsed < len(options) and parsed not in correct_indices:
                    correct_indices.append(parsed)
            if qtype == 'single':
                if len(correct_indices) != 1:
                    continue
                correct = [correct_indices[0]]
            else:
                if not correct_indices:
                    continue
                correct = sorted(correct_indices)
            normalized.append({
                'id': question_id,
                'type': qtype,
                'prompt': prompt,
                'options': options,
                'correct': correct,
            })
            continue

        if qtype == 'order':
            items = _string_list(item.get('items'))
            correct = _string_list(item.get('correct'))
            if len(items) < 2 or len(correct) != len(items) or sorted(correct) != sorted(items):
                continue
            normalized.append({
                'id': question_id,
                'type': qtype,
                'prompt': prompt,
                'items': items,
                'correct': correct,
            })
            continue

        if qtype == 'match':
            raw_pairs = item.get('pairs')
            if not isinstance(raw_pairs, list):
                continue
            pairs: list[tuple[str, str]] = []
            right_values: list[str] = []
            correct_map: dict[str, str] = {}
            for pair in raw_pairs:
                if not isinstance(pair, dict):
                    continue
                left = str(pair.get('left') or '').strip()
                right = str(pair.get('right') or '').strip()
                if not left or not right or left in correct_map:
                    continue
                correct_map[left] = right
                pairs.append((left, right))
                if right not in right_values:
                    right_values.append(right)
            if len(pairs) < 2 or len(right_values) < 2:
                continue
            normalized.append({
                'id': question_id,
                'type': qtype,
                'prompt': prompt,
                'left': [left for left, _ in pairs],
                'right': right_values,
                'correct': correct_map,
            })
            continue

        if qtype == 'text':
            correct_answers = _string_list(item.get('correct'))
            if not correct_answers:
                continue
            normalized.append({
                'id': question_id,
                'type': qtype,
                'prompt': prompt,
                'correct': correct_answers,
            })

    return normalized


def _build_task(lesson: Lesson, raw_task, lesson_title: str) -> Task | None:
    if not isinstance(raw_task, dict) or not raw_task.get('enabled'):
        return None

    age_group = lesson.module.age_group
    requested_task_type = 'code' if str(raw_task.get('task_type') or '').strip().lower() == 'code' else 'text'
    if requested_task_type == 'code' and not age_group_supports_code(age_group):
        raise ValueError('Для Junior-модуля кодовая практика недоступна. Выберите текстовое задание или квиз.')

    evaluation_mode = str(raw_task.get('evaluation_mode') or '').strip().lower()
    keywords = _split_csv(raw_task.get('keywords'))
    tests = _normalized_test_cases(raw_task.get('tests'))
    explicit_code_intent = has_explicit_code_task_intent(
        title=raw_task.get('title'),
        prompt=raw_task.get('prompt'),
        starter_code=raw_task.get('starter_code'),
    )
    if requested_task_type == 'text' and explicit_code_intent:
        raise ValueError('Задание выглядит как кодовая практика. Выберите формат "Кодовая задача" и добавьте автотесты.')
    task_validation = normalize_task_validation(
        {
            'evaluation_mode': evaluation_mode,
            'language': raw_task.get('language'),
            'keywords': keywords,
            'tests': tests,
            'time_limit_ms': raw_task.get('time_limit_ms'),
            'memory_limit_mb': raw_task.get('memory_limit_mb'),
        },
        is_custom_lesson=False,
        task_type=requested_task_type,
        age_group=age_group,
    )

    if requested_task_type == 'code' and not task_validation['tests']:
        raise ValueError('Для кодового задания добавьте хотя бы один тест с входом и ожидаемым выводом.')
    if task_validation['evaluation_mode'] == 'keywords' and not task_validation['keywords']:
        raise ValueError('Для автопроверки по ключевым словам добавьте хотя бы одно ключевое слово.')
    if task_validation['evaluation_mode'] == 'stdin_stdout' and not task_validation['tests']:
        raise ValueError('Для автопроверки добавьте хотя бы один тест с ожидаемым результатом.')

    task_type = 'code' if requested_task_type == 'code' or task_validation['evaluation_mode'] == 'stdin_stdout' else 'text'
    hints = _string_list(raw_task.get('hints'))
    return Task(
        lesson_id=lesson.id,
        task_type=task_type,
        title=str(raw_task.get('title') or '').strip() or f'Практика: {lesson_title}',
        prompt=str(raw_task.get('prompt') or '').strip() or 'Выполни практическое задание по теме урока.',
        starter_code=str(raw_task.get('starter_code') or '') if task_type == 'code' else '',
        validation=task_validation,
        hints=hints,
        xp_reward=_safe_int(raw_task.get('xp_reward'), 30, minimum=0, maximum=500),
    )


def _build_quiz(lesson: Lesson, raw_quiz, lesson_title: str) -> Quiz | None:
    if not isinstance(raw_quiz, dict) or not raw_quiz.get('enabled'):
        return None

    questions = _normalize_quiz_questions(raw_quiz.get('questions'))
    if not questions:
        raise ValueError('Добавьте хотя бы один корректный вопрос в итоговый квиз.')

    return Quiz(
        lesson_id=lesson.id,
        title=str(raw_quiz.get('title') or '').strip() or f'Квиз: {lesson_title}',
        passing_score=_safe_int(raw_quiz.get('passing_score'), 70, minimum=0, maximum=100),
        questions=questions,
        xp_reward=_safe_int(raw_quiz.get('xp_reward'), 50, minimum=0, maximum=500),
    )


@admin_bp.get('/overview')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def overview(current_user: User):
    return {
        'stats': {
            'users': User.query.count(),
            'students': User.query.filter_by(role=UserRole.STUDENT).count(),
            'teachers': User.query.filter_by(role=UserRole.TEACHER).count(),
            'modules': Module.query.count(),
            'lessons': Lesson.query.count(),
        }
    }


@admin_bp.get('/users')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def users(current_user: User):
    payload = [user.to_dict() for user in User.query.order_by(User.created_at.desc()).all()]
    return {'users': payload}


@admin_bp.get('/modules')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def list_modules(current_user: User):
    modules = Module.query.order_by(Module.order_index.asc()).all()
    return {'modules': [module.to_dict(include_lessons=True) for module in modules]}


@admin_bp.post('/modules')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def create_module(current_user: User):
    data = request.get_json() or {}
    module = Module(
        slug=data.get('slug'),
        title=data.get('title', 'Новый модуль'),
        description=data.get('description', 'Описание модуля'),
        age_group=data.get('age_group', 'middle'),
        icon=data.get('icon', 'sparkles'),
        color=data.get('color', '#4A90D9'),
        order_index=int(data.get('order_index', Module.query.count() + 1)),
        is_published=bool(data.get('is_published', False)),
    )
    db.session.add(module)
    db.session.commit()
    return {'module': module.to_dict()}, 201


@admin_bp.patch('/modules/<int:module_id>')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def update_module(current_user: User, module_id: int):
    module = Module.query.get_or_404(module_id)
    data = request.get_json() or {}
    for field in ['title', 'description', 'age_group', 'icon', 'color']:
        if field in data:
            setattr(module, field, data[field])
    if 'is_published' in data:
        module.is_published = bool(data['is_published'])
    db.session.commit()
    return {'module': module.to_dict()}




@admin_bp.delete('/modules/<int:module_id>')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def delete_module(current_user: User, module_id: int):
    module = Module.query.get_or_404(module_id)
    if module.is_custom_classroom_module:
        return {'message': 'Модули учительских классов удаляются из кабинета учителя, а не из roadmap-админки.'}, 400
    if module.is_published:
        return {'message': 'Сначала снимите модуль с публикации, затем его можно будет удалить.'}, 400

    lesson_ids = [lesson.id for lesson in module.lessons]
    if lesson_ids:
        assignment = Assignment.query.filter(Assignment.lesson_id.in_(lesson_ids)).first()
        if assignment is not None:
            return {'message': 'Нельзя удалить модуль: его уроки уже используются в назначенных заданиях.'}, 400

    for invite in ParentInvite.query.all():
        whitelist = invite.modules_whitelist or []
        if module.slug in whitelist:
            invite.modules_whitelist = [slug for slug in whitelist if slug != module.slug]

    db.session.delete(module)
    db.session.flush()
    _normalize_module_order()
    db.session.commit()
    return {'message': 'Модуль удалён.'}


@admin_bp.post('/modules/<int:module_id>/lessons')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def create_module_lesson(current_user: User, module_id: int):
    module = Module.query.get_or_404(module_id)
    if module.is_custom_classroom_module:
        return {'message': 'Через админку можно добавлять уроки только в общие roadmap-модули.'}, 400

    data = request.get_json() or {}
    title = str(data.get('title') or '').strip()
    summary = str(data.get('summary') or '').strip()
    if not title or not summary:
        return {'message': 'Укажите название и краткое описание урока.'}, 400

    theory_text = str(data.get('theory_text') or '').strip()
    key_points = _string_list(data.get('key_points'))
    interactive_steps = _build_interactive_steps(data.get('interactive_steps'))
    order_index = _insert_position(module, data.get('insert_position'))

    if bool(data.get('publish_module_if_needed')) and not module.is_published:
        module.is_published = True

    lesson = Lesson(
        module_id=module.id,
        slug=_generate_module_lesson_slug(module),
        title=title,
        summary=summary,
        content_format='mixed',
        theory_blocks=_build_theory_blocks(title, summary, theory_text, key_points),
        interactive_steps=interactive_steps,
        order_index=order_index,
        duration_minutes=_safe_int(data.get('duration_minutes'), 10, minimum=5, maximum=180),
        passing_score=_safe_int(data.get('passing_score'), 70, minimum=0, maximum=100),
        is_published=True,
    )
    db.session.add(lesson)
    db.session.flush()

    try:
        task = _build_task(lesson, data.get('task'), title)
        if task is not None:
            db.session.add(task)
        quiz = _build_quiz(lesson, data.get('quiz'), title)
        if quiz is not None:
            db.session.add(quiz)
    except ValueError as exc:
        db.session.rollback()
        return {'message': str(exc)}, 400

    db.session.commit()
    return {
        'lesson': lesson.to_dict(),
        'roadmap_visible': bool(module.is_published and lesson.is_published),
        'module': module.to_dict(include_lessons=True),
    }, 201


@admin_bp.post('/admins')
@auth_required([UserRole.SUPERADMIN])
def create_admin(current_user: User):
    data = request.get_json() or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    password_error = validate_password(password, minimum_length=8)
    if not email:
        return {'message': 'Укажите email нового администратора.'}, 400
    if password_error:
        return {'message': password_error}, 400

    username = (data.get('username') or email.split('@')[0]).strip().lower()
    if User.query.filter((User.email == email) | (User.username == username)).first():
        return {'message': 'Пользователь уже существует'}, 409
    admin = User(
        full_name=data.get('full_name', 'Администратор'),
        username=username,
        email=email,
        password_hash=hash_password(password),
        role=UserRole.ADMIN,
        age_group='adult',
        xp=2000,
    )
    db.session.add(admin)
    db.session.commit()
    return {'user': admin.to_dict()}, 201


@admin_bp.patch('/admins/<int:user_id>/block')
@auth_required([UserRole.SUPERADMIN])
def block_admin(current_user: User, user_id: int):
    user = User.query.get_or_404(user_id)
    if user.role != UserRole.ADMIN:
        return {'message': 'Можно блокировать только обычных админов'}, 400
    user.is_active = False
    db.session.commit()
    return {'user': user.to_dict()}


@admin_bp.patch('/admins/<int:user_id>/unblock')
@auth_required([UserRole.SUPERADMIN])
def unblock_admin(current_user: User, user_id: int):
    user = User.query.get_or_404(user_id)
    if user.role != UserRole.ADMIN:
        return {'message': 'Можно разблокировать только обычных админов'}, 400
    user.is_active = True
    db.session.commit()
    return {'user': user.to_dict()}


@admin_bp.delete('/admins/<int:user_id>')
@auth_required([UserRole.SUPERADMIN])
def delete_admin(current_user: User, user_id: int):
    user = User.query.get_or_404(user_id)
    if user.role != UserRole.ADMIN:
        return {'message': 'Можно удалять только обычных админов'}, 400
    db.session.delete(user)
    db.session.commit()
    return {'message': 'Админ удалён'}
