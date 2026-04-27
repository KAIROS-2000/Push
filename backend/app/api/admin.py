from __future__ import annotations

from datetime import UTC, datetime, timedelta

from flask import Blueprint, current_app, request, send_file
from sqlalchemy import case, func, or_

from ..core.db import db
from .lesson_builder import build_lesson_quiz
from ..core.security import (
    ADMIN_PASSWORD_MIN_LENGTH,
    auth_required,
    hash_password,
    invalidate_session_version_cache,
    revoke_refresh_tokens_for_user,
    validate_password,
)
from ..models.learning import (
    AssignmentSubmission,
    ClassJoinRequest,
    ClassMembership,
    Classroom,
    CUSTOM_CLASSROOM_MODULE_PREFIX,
    Lesson,
    Module,
    Task,
    Assignment,
    UserProgress,
    age_group_supports_code,
    custom_classroom_module_slug_prefix,
    decode_assignment_description,
    has_explicit_code_task_intent,
    normalize_task_validation,
)
from ..models.messaging import Conversation, ConversationReadState, Message
from ..models.parent_cabinet import ParentLinkCode
from ..models.user import (
    TEACHER_APPROVAL_APPROVED,
    TEACHER_APPROVAL_PENDING,
    TEACHER_APPROVAL_REJECTED,
    TEACHER_APPROVAL_STATUSES,
    AdminAuditLog,
    RefreshToken,
    User,
    UserRole,
    USERNAME_MAX_LENGTH,
)
from ..seed.bootstrap import generate_code
from ..services.teacher_approval_service import cleanup_expired_teacher_requests, teacher_rejection_expiration


admin_bp = Blueprint('admin', __name__)
DEFAULT_DIRECTORY_PAGE_SIZE = 20
MAX_DIRECTORY_PAGE_SIZE = 100
VISIBLE_USER_ROLES = (UserRole.STUDENT, UserRole.TEACHER)
MANAGED_ADMIN_ROLES = (UserRole.ADMIN,)
VALID_STATUS_FILTERS = {'all', 'active', 'blocked'}
VALID_TEACHER_REQUEST_FILTERS = {'all', *TEACHER_APPROVAL_STATUSES}


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


def _normalize_module_order() -> list[Module]:
    ordered = Module.query.order_by(Module.order_index.asc(), Module.id.asc()).all()
    roadmap_modules = [module for module in ordered if not module.is_custom_classroom_module]
    for index, module in enumerate(roadmap_modules, start=1):
        module.order_index = index
    db.session.flush()
    return roadmap_modules


def _normalize_status_filter(value: str | None) -> str:
    normalized = (value or 'all').strip().lower()
    return normalized if normalized in VALID_STATUS_FILTERS else 'all'


def _normalize_teacher_request_filter(value: str | None) -> str:
    normalized = (value or TEACHER_APPROVAL_PENDING).strip().lower()
    return normalized if normalized in VALID_TEACHER_REQUEST_FILTERS else TEACHER_APPROVAL_PENDING


def _pagination_payload(total: int, page: int, page_size: int) -> dict:
    total_pages = max(1, (total + page_size - 1) // page_size)
    return {
        'page': page,
        'page_size': page_size,
        'total': total,
        'total_pages': total_pages,
    }


def _serialize_admin_user(user: User) -> dict:
    return {
        **user.to_dict(),
        'created_at': user.created_at.isoformat() if user.created_at else None,
        'last_login_at': user.last_login_at.isoformat() if user.last_login_at else None,
    }


def _list_users_for_roles(role_filters: tuple[UserRole, ...]) -> tuple[list[User], dict, dict]:
    username_filter = (request.args.get('username') or '').strip().lower()
    status_filter = _normalize_status_filter(request.args.get('status'))
    page = _safe_int(request.args.get('page'), 1, minimum=1)
    page_size = _safe_int(
        request.args.get('page_size'),
        DEFAULT_DIRECTORY_PAGE_SIZE,
        minimum=1,
        maximum=MAX_DIRECTORY_PAGE_SIZE,
    )

    query = User.query.filter(User.role.in_(role_filters))
    if UserRole.TEACHER in role_filters:
        query = query.filter(
            or_(
                User.role != UserRole.TEACHER,
                User.teacher_approval_status == TEACHER_APPROVAL_APPROVED,
            )
        )
    if username_filter:
        query = query.filter(User.username.ilike(f'%{username_filter}%'))
    if status_filter == 'active':
        query = query.filter(User.is_active.is_(True))
    elif status_filter == 'blocked':
        query = query.filter(User.is_active.is_(False))

    query = query.order_by(User.created_at.desc(), User.id.desc())
    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    return items, _pagination_payload(total, page, page_size), {
        'username': username_filter,
        'status': status_filter,
    }


def _log_admin_action(
    actor: User,
    *,
    action: str,
    entity_type: str,
    entity_id: int | None,
    entity_label: str,
    details: dict | None = None,
) -> None:
    payload = details.copy() if isinstance(details, dict) else {}
    payload.setdefault('actor_name', actor.full_name)
    payload.setdefault('actor_username', actor.username)
    db.session.add(
        AdminAuditLog(
            actor_user_id=actor.id,
            actor_role=actor.role.value,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_label=entity_label,
            details_json=payload,
        )
    )


def _ensure_managed_user_target(user: User) -> tuple[dict, int] | None:
    if user.role not in VISIBLE_USER_ROLES:
        return {'message': 'Через этот раздел можно управлять только учениками и учителями.'}, 400
    return None


def _ensure_admin_target(user: User) -> tuple[dict, int] | None:
    if user.role not in MANAGED_ADMIN_ROLES:
        return {'message': 'Можно управлять только обычными администраторами.'}, 400
    return None


def _ensure_teacher_request_target(user: User) -> tuple[dict, int] | None:
    if user.role != UserRole.TEACHER:
        return {'message': 'Через этот раздел можно управлять только заявками учителей.'}, 400
    return None


def _delete_user_conversations(user_id: int, classroom_ids: list[int] | None = None) -> int:
    filters = [Conversation.teacher_id == user_id, Conversation.student_id == user_id]
    if classroom_ids:
        filters.append(Conversation.classroom_id.in_(classroom_ids))
    conversations = Conversation.query.filter(or_(*filters)).all()
    conversation_ids = [conversation.id for conversation in conversations]
    if not conversation_ids:
        return 0

    ConversationReadState.query.filter(
        ConversationReadState.conversation_id.in_(conversation_ids)
    ).delete(synchronize_session=False)
    Message.query.filter(Message.conversation_id.in_(conversation_ids)).delete(
        synchronize_session=False
    )
    Conversation.query.filter(Conversation.id.in_(conversation_ids)).delete(
        synchronize_session=False
    )
    return len(conversation_ids)


def _delete_custom_classroom_modules(classroom_ids: list[int]) -> int:
    deleted_count = 0
    for classroom_id in classroom_ids:
        modules = Module.query.filter(
            Module.slug.like(f'{custom_classroom_module_slug_prefix(classroom_id)}%')
        ).all()
        for module in modules:
            db.session.delete(module)
            deleted_count += 1
    return deleted_count


def _delete_managed_user_dependencies(user: User) -> dict:
    classroom_ids: list[int] = []
    deleted_conversations = 0
    deleted_custom_modules = 0

    if user.role == UserRole.TEACHER:
        classrooms = Classroom.query.filter_by(teacher_id=user.id).all()
        classroom_ids = [classroom.id for classroom in classrooms]
        deleted_conversations += _delete_user_conversations(user.id, classroom_ids)
        ClassJoinRequest.query.filter(ClassJoinRequest.decided_by_id == user.id).update(
            {ClassJoinRequest.decided_by_id: None},
            synchronize_session=False,
        )
        for classroom in classrooms:
            db.session.delete(classroom)
        db.session.flush()
        deleted_custom_modules = _delete_custom_classroom_modules(classroom_ids)
    else:
        deleted_conversations += _delete_user_conversations(user.id)

    ClassJoinRequest.query.filter(ClassJoinRequest.student_id == user.id).delete(
        synchronize_session=False
    )
    ClassJoinRequest.query.filter(ClassJoinRequest.decided_by_id == user.id).update(
        {ClassJoinRequest.decided_by_id: None},
        synchronize_session=False,
    )
    AssignmentSubmission.query.filter(AssignmentSubmission.student_id == user.id).delete(
        synchronize_session=False
    )
    ParentLinkCode.query.filter(ParentLinkCode.child_user_id == user.id).delete(
        synchronize_session=False
    )
    ClassMembership.query.filter(ClassMembership.student_id == user.id).delete(
        synchronize_session=False
    )
    ConversationReadState.query.filter(ConversationReadState.user_id == user.id).delete(
        synchronize_session=False
    )

    return {
        'classrooms_deleted': len(classroom_ids),
        'conversations_deleted': deleted_conversations,
        'custom_modules_deleted': deleted_custom_modules,
    }


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


def _build_task(lesson: Lesson, raw_task, lesson_title: str) -> Task | None:
    if not isinstance(raw_task, dict) or not raw_task.get('enabled'):
        return None

    age_group = lesson.module.age_group
    requested_task_type = 'code' if str(raw_task.get('task_type') or '').strip().lower() == 'code' else 'text'
    if requested_task_type == 'code' and not age_group_supports_code(age_group):
        raise ValueError('Для Junior-модуля кодовая практика недоступна. Выберите текстовое задание или квиз.')

    evaluation_mode = str(raw_task.get('evaluation_mode') or '').strip().lower()
    if evaluation_mode == 'manual':
        raise ValueError(
            'Админ и суперадмин не могут создавать уроки с ручной проверкой. '
            'Используйте ключевые слова или автотесты.'
        )
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


def _scalar_int(query) -> int:
    return int(query.scalar() or 0)


def _scalar_float(query) -> float:
    return float(query.scalar() or 0)


def _percent(numerator: int | float, denominator: int | float) -> float:
    if not denominator:
        return 0.0
    return round((float(numerator) / float(denominator)) * 100, 1)


def _distribution(rows: list[tuple[str | None, int]]) -> list[dict]:
    items = []
    for label, value in rows:
        normalized_label = getattr(label, 'value', label)
        items.append({'label': str(normalized_label or 'unknown'), 'value': int(value or 0)})
    return items


def _build_activity_series(now: datetime, days: int = 14) -> list[dict]:
    start_day = (now - timedelta(days=days - 1)).date()
    series = {
        (start_day + timedelta(days=offset)).isoformat(): {
            'date': (start_day + timedelta(days=offset)).isoformat(),
            'registrations': 0,
            'lesson_completions': 0,
            'practice_submissions': 0,
        }
        for offset in range(days)
    }
    window_start = datetime.combine(start_day, datetime.min.time(), tzinfo=UTC)

    for (created_at,) in db.session.query(User.created_at).filter(User.created_at >= window_start).all():
        if created_at:
            key = created_at.date().isoformat()
            if key in series:
                series[key]['registrations'] += 1

    for (completed_at,) in (
        db.session.query(UserProgress.completed_at)
        .filter(UserProgress.completed_at.isnot(None), UserProgress.completed_at >= window_start)
        .all()
    ):
        if completed_at:
            key = completed_at.date().isoformat()
            if key in series:
                series[key]['lesson_completions'] += 1

    for (submitted_at,) in (
        db.session.query(AssignmentSubmission.submitted_at)
        .filter(AssignmentSubmission.submitted_at >= window_start)
        .all()
    ):
        if submitted_at:
            key = submitted_at.date().isoformat()
            if key in series:
                series[key]['practice_submissions'] += 1

    return list(series.values())


def _assignment_type_distribution() -> list[dict]:
    counters: dict[str, int] = {}
    for (description,) in db.session.query(Assignment.description).all():
        metadata, _ = decode_assignment_description(description)
        assignment_type = str(metadata.get('assignment_type') or 'lesson_practice')
        counters[assignment_type] = counters.get(assignment_type, 0) + 1
    return [
        {'label': label, 'value': value}
        for label, value in sorted(counters.items(), key=lambda item: (-item[1], item[0]))
    ]


def _lowest_completion_lessons(limit: int = 8) -> list[dict]:
    completed_case = case((UserProgress.status == 'completed', 1), else_=0)
    rows = (
        db.session.query(
            Lesson.id.label('lesson_id'),
            Lesson.title.label('lesson_title'),
            Module.title.label('module_title'),
            func.count(UserProgress.id).label('started_count'),
            func.sum(completed_case).label('completed_count'),
            func.avg(UserProgress.score).label('average_score'),
            func.sum(UserProgress.attempts).label('attempts'),
        )
        .join(Module, Module.id == Lesson.module_id)
        .outerjoin(UserProgress, UserProgress.lesson_id == Lesson.id)
        .filter(Lesson.is_published.is_(True), Module.is_published.is_(True))
        .group_by(Lesson.id, Lesson.title, Module.title)
        .all()
    )

    lessons: list[dict] = []
    for row in rows:
        started_count = int(row.started_count or 0)
        if started_count <= 0:
            continue
        completed_count = int(row.completed_count or 0)
        lessons.append(
            {
                'lesson_id': int(row.lesson_id),
                'title': row.lesson_title,
                'module_title': row.module_title,
                'started_count': started_count,
                'completed_count': completed_count,
                'completion_rate': _percent(completed_count, started_count),
                'average_score': round(float(row.average_score or 0), 1),
                'attempts': int(row.attempts or 0),
            }
        )

    lessons.sort(
        key=lambda item: (
            item['completion_rate'],
            -item['started_count'],
            item['average_score'],
            item['title'],
        )
    )
    return lessons[:limit]


@admin_bp.get('/overview')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def overview(current_user: User):
    if cleanup_expired_teacher_requests():
        db.session.commit()
    return {
        'stats': {
            'users': User.query.count(),
            'students': User.query.filter_by(role=UserRole.STUDENT).count(),
            'teachers': User.query.filter_by(
                role=UserRole.TEACHER,
                teacher_approval_status=TEACHER_APPROVAL_APPROVED,
            ).count(),
            'teacher_requests': User.query.filter_by(
                role=UserRole.TEACHER,
                teacher_approval_status=TEACHER_APPROVAL_PENDING,
            ).count(),
            'modules': Module.query.count(),
            'lessons': Lesson.query.count(),
        }
    }


@admin_bp.get('/telemetry')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def telemetry(current_user: User):
    if cleanup_expired_teacher_requests():
        db.session.commit()

    now = datetime.now(UTC)
    day_ago = now - timedelta(hours=24)
    week_ago = now - timedelta(days=7)

    active_user_sessions = (
        db.session.query(
            User.role.label('role'),
            func.count(func.distinct(User.id)).label('users_count'),
        )
        .join(RefreshToken, RefreshToken.user_id == User.id)
        .filter(RefreshToken.expires_at > now, User.is_active.is_(True))
        .group_by(User.role)
        .all()
    )
    active_session_distribution = _distribution(
        [(row.role, row.users_count) for row in active_user_sessions]
    )
    active_by_role = {item['label']: item['value'] for item in active_session_distribution}

    students_count = User.query.filter_by(role=UserRole.STUDENT).count()
    teachers_count = User.query.filter_by(
        role=UserRole.TEACHER,
        teacher_approval_status=TEACHER_APPROVAL_APPROVED,
    ).count()
    active_students = User.query.filter_by(role=UserRole.STUDENT, is_active=True).count()
    active_teachers = User.query.filter_by(
        role=UserRole.TEACHER,
        teacher_approval_status=TEACHER_APPROVAL_APPROVED,
        is_active=True,
    ).count()
    blocked_users = User.query.filter_by(is_active=False).count()
    pending_teacher_requests = User.query.filter_by(
        role=UserRole.TEACHER,
        teacher_approval_status=TEACHER_APPROVAL_PENDING,
    ).count()

    progress_total = UserProgress.query.count()
    completed_lessons = UserProgress.query.filter_by(status='completed').count()
    progress_status_rows = (
        db.session.query(UserProgress.status, func.count(UserProgress.id))
        .group_by(UserProgress.status)
        .order_by(UserProgress.status.asc())
        .all()
    )
    submission_status_rows = (
        db.session.query(AssignmentSubmission.status, func.count(AssignmentSubmission.id))
        .group_by(AssignmentSubmission.status)
        .order_by(AssignmentSubmission.status.asc())
        .all()
    )

    submissions_total = AssignmentSubmission.query.count()
    checked_submissions = AssignmentSubmission.query.filter_by(status='checked').count()
    pending_review_submissions = AssignmentSubmission.query.filter(
        AssignmentSubmission.status.in_(('submitted', 'pending_review'))
    ).count()
    needs_revision_submissions = AssignmentSubmission.query.filter_by(
        status='needs_revision'
    ).count()
    assignments_total = Assignment.query.count()
    assignments_with_submissions = _scalar_int(
        db.session.query(func.count(func.distinct(AssignmentSubmission.assignment_id)))
    )

    return {
        'generated_at': now.isoformat(),
        'load': {
            'active_users': sum(active_by_role.values()),
            'active_students': active_by_role.get(UserRole.STUDENT.value, 0),
            'active_teachers': active_by_role.get(UserRole.TEACHER.value, 0),
            'active_admins': active_by_role.get(UserRole.ADMIN.value, 0),
            'active_superadmins': active_by_role.get(UserRole.SUPERADMIN.value, 0),
            'active_sessions': _scalar_int(
                db.session.query(func.count(RefreshToken.id))
                .join(User, User.id == RefreshToken.user_id)
                .filter(
                    RefreshToken.expires_at > now,
                    User.is_active.is_(True),
                )
            ),
            'logins_24h': User.query.filter(User.last_login_at >= day_ago).count(),
            'logins_7d': User.query.filter(User.last_login_at >= week_ago).count(),
            'lesson_completions_24h': UserProgress.query.filter(
                UserProgress.status == 'completed',
                UserProgress.completed_at >= day_ago,
            ).count(),
            'practice_submissions_24h': AssignmentSubmission.query.filter(
                AssignmentSubmission.submitted_at >= day_ago
            ).count(),
            'pending_reviews': pending_review_submissions,
            'pending_teacher_requests': pending_teacher_requests,
            'pending_class_join_requests': ClassJoinRequest.query.filter_by(status='pending').count(),
        },
        'audience': {
            'total_users': User.query.count(),
            'students': students_count,
            'teachers': teachers_count,
            'admins': User.query.filter_by(role=UserRole.ADMIN).count(),
            'superadmins': User.query.filter_by(role=UserRole.SUPERADMIN).count(),
            'active_students': active_students,
            'active_teachers': active_teachers,
            'blocked_users': blocked_users,
            'teacher_requests_pending': pending_teacher_requests,
            'role_distribution': _distribution(
                db.session.query(User.role, func.count(User.id))
                .group_by(User.role)
                .order_by(User.role.asc())
                .all()
            ),
            'active_session_distribution': active_session_distribution,
        },
        'content': {
            'modules': Module.query.count(),
            'published_modules': Module.query.filter_by(is_published=True).count(),
            'lessons': Lesson.query.count(),
            'published_lessons': Lesson.query.filter_by(is_published=True).count(),
            'custom_lessons': Lesson.query.join(Module).filter(
                Module.slug.like(f'{CUSTOM_CLASSROOM_MODULE_PREFIX}%')
            ).count(),
            'tasks': Task.query.count(),
            'classrooms': Classroom.query.count(),
            'assignments': assignments_total,
        },
        'learning': {
            'progress_rows': progress_total,
            'completed_lessons': completed_lessons,
            'completion_rate': _percent(completed_lessons, progress_total),
            'average_score': round(
                _scalar_float(db.session.query(func.avg(UserProgress.score))),
                1,
            ),
            'total_attempts': _scalar_int(db.session.query(func.sum(UserProgress.attempts))),
            'hints_used': _scalar_int(db.session.query(func.sum(UserProgress.hints_used))),
            'status_distribution': _distribution(progress_status_rows),
            'lowest_completion_lessons': _lowest_completion_lessons(),
        },
        'practice': {
            'assignments': assignments_total,
            'submissions': submissions_total,
            'assignments_with_submissions': assignments_with_submissions,
            'checked_submissions': checked_submissions,
            'pending_review': pending_review_submissions,
            'needs_revision': needs_revision_submissions,
            'submission_rate': _percent(assignments_with_submissions, assignments_total),
            'average_score': round(
                _scalar_float(db.session.query(func.avg(AssignmentSubmission.score))),
                1,
            ),
            'status_distribution': _distribution(submission_status_rows),
            'assignment_type_distribution': _assignment_type_distribution(),
        },
        'activity': {
            'days': 14,
            'series': _build_activity_series(now, days=14),
        },
    }


@admin_bp.get('/users')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def users(current_user: User):
    items, pagination, filters = _list_users_for_roles(VISIBLE_USER_ROLES)
    return {
        'users': [_serialize_admin_user(user) for user in items],
        'pagination': pagination,
        'filters': filters,
    }


@admin_bp.get('/teacher-requests')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def teacher_requests(current_user: User):
    if cleanup_expired_teacher_requests():
        db.session.commit()
    username_filter = (request.args.get('username') or '').strip().lower()
    status_filter = _normalize_teacher_request_filter(request.args.get('status'))
    page = _safe_int(request.args.get('page'), 1, minimum=1)
    page_size = _safe_int(
        request.args.get('page_size'),
        DEFAULT_DIRECTORY_PAGE_SIZE,
        minimum=1,
        maximum=MAX_DIRECTORY_PAGE_SIZE,
    )

    query = User.query.filter_by(role=UserRole.TEACHER)
    if username_filter:
        query = query.filter(User.username.ilike(f'%{username_filter}%'))
    if status_filter != 'all':
        query = query.filter(User.teacher_approval_status == status_filter)

    query = query.order_by(User.created_at.desc(), User.id.desc())
    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    return {
        'teacher_requests': [_serialize_admin_user(user) for user in items],
        'pagination': _pagination_payload(total, page, page_size),
        'filters': {
            'username': username_filter,
            'status': status_filter,
        },
    }


@admin_bp.patch('/teacher-requests/<int:user_id>/approve')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def approve_teacher_request(current_user: User, user_id: int):
    if cleanup_expired_teacher_requests():
        db.session.commit()
    user = User.query.get_or_404(user_id)
    error = _ensure_teacher_request_target(user)
    if error:
        return error

    previous_status = user.teacher_approval_status or TEACHER_APPROVAL_APPROVED
    if previous_status == TEACHER_APPROVAL_APPROVED:
        return {'message': 'Заявка этого учителя уже подтверждена.'}, 400

    user.teacher_approval_status = TEACHER_APPROVAL_APPROVED
    user.teacher_rejection_expires_at = None
    user.is_active = True
    user.bump_session_version()
    invalidate_session_version_cache(user.id)
    revoke_refresh_tokens_for_user(user.id)
    _log_admin_action(
        current_user,
        action='teacher_request_approved',
        entity_type='teacher_request',
        entity_id=user.id,
        entity_label=user.username,
        details={
            'target_name': user.full_name,
            'target_username': user.username,
            'target_role': user.role.value,
            'previous_status': previous_status,
            'next_status': TEACHER_APPROVAL_APPROVED,
            'status': 'active',
        },
    )
    db.session.commit()
    return {'teacher_request': _serialize_admin_user(user)}


@admin_bp.patch('/teacher-requests/<int:user_id>/reject')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def reject_teacher_request(current_user: User, user_id: int):
    if cleanup_expired_teacher_requests():
        db.session.commit()
    user = User.query.get_or_404(user_id)
    error = _ensure_teacher_request_target(user)
    if error:
        return error

    previous_status = user.teacher_approval_status or TEACHER_APPROVAL_APPROVED
    if previous_status == TEACHER_APPROVAL_APPROVED:
        return {'message': 'Подтверждённого учителя можно заблокировать в разделе пользователей.'}, 400

    user.teacher_approval_status = TEACHER_APPROVAL_REJECTED
    user.teacher_rejection_expires_at = teacher_rejection_expiration()
    user.is_active = False
    user.bump_session_version()
    invalidate_session_version_cache(user.id)
    revoke_refresh_tokens_for_user(user.id)
    _log_admin_action(
        current_user,
        action='teacher_request_rejected',
        entity_type='teacher_request',
        entity_id=user.id,
        entity_label=user.username,
        details={
            'target_name': user.full_name,
            'target_username': user.username,
            'target_role': user.role.value,
            'previous_status': previous_status,
            'next_status': TEACHER_APPROVAL_REJECTED,
            'delete_after': user.teacher_rejection_expires_at.isoformat()
            if user.teacher_rejection_expires_at
            else None,
            'status': 'rejected',
        },
    )
    db.session.commit()
    return {'teacher_request': _serialize_admin_user(user)}


@admin_bp.patch('/users/<int:user_id>/block')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def block_user(current_user: User, user_id: int):
    user = User.query.get_or_404(user_id)
    error = _ensure_managed_user_target(user)
    if error:
        return error
    user.is_active = False
    user.bump_session_version()
    invalidate_session_version_cache(user.id)
    revoke_refresh_tokens_for_user(user.id)
    _log_admin_action(
        current_user,
        action='user_blocked',
        entity_type='user',
        entity_id=user.id,
        entity_label=user.username,
        details={
            'target_name': user.full_name,
            'target_username': user.username,
            'target_role': user.role.value,
            'status': 'blocked',
        },
    )
    db.session.commit()
    return {'user': _serialize_admin_user(user)}


@admin_bp.patch('/users/<int:user_id>/unblock')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def unblock_user(current_user: User, user_id: int):
    user = User.query.get_or_404(user_id)
    error = _ensure_managed_user_target(user)
    if error:
        return error
    user.is_active = True
    _log_admin_action(
        current_user,
        action='user_unblocked',
        entity_type='user',
        entity_id=user.id,
        entity_label=user.username,
        details={
            'target_name': user.full_name,
            'target_username': user.username,
            'target_role': user.role.value,
            'status': 'active',
        },
    )
    db.session.commit()
    return {'user': _serialize_admin_user(user)}


@admin_bp.delete('/users/<int:user_id>')
@auth_required([UserRole.SUPERADMIN])
def delete_user(current_user: User, user_id: int):
    user = User.query.get_or_404(user_id)
    error = _ensure_managed_user_target(user)
    if error:
        return error

    target_details = {
        'target_name': user.full_name,
        'target_username': user.username,
        'target_role': user.role.value,
        'email': user.email,
        'status': 'deleted',
    }
    revoke_refresh_tokens_for_user(user.id)
    invalidate_session_version_cache(user.id)
    cleanup_details = _delete_managed_user_dependencies(user)
    _log_admin_action(
        current_user,
        action='user_deleted',
        entity_type='user',
        entity_id=user.id,
        entity_label=user.username,
        details={**target_details, **cleanup_details},
    )
    db.session.delete(user)
    db.session.commit()
    return {'message': 'Пользователь удалён'}


@admin_bp.get('/admins')
@auth_required([UserRole.SUPERADMIN])
def admins(current_user: User):
    items, pagination, filters = _list_users_for_roles(MANAGED_ADMIN_ROLES)
    return {
        'admins': [_serialize_admin_user(user) for user in items],
        'pagination': pagination,
        'filters': filters,
    }


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
    db.session.flush()
    _log_admin_action(
        current_user,
        action='module_created',
        entity_type='module',
        entity_id=module.id,
        entity_label=module.title,
        details={
            'module_slug': module.slug,
            'age_group': module.age_group,
            'is_published': module.is_published,
        },
    )
    db.session.commit()
    return {'module': module.to_dict()}, 201


@admin_bp.patch('/modules/<int:module_id>')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def update_module(current_user: User, module_id: int):
    module = Module.query.get_or_404(module_id)
    data = request.get_json() or {}
    was_published = bool(module.is_published)
    for field in ['title', 'description', 'age_group', 'icon', 'color']:
        if field in data:
            setattr(module, field, data[field])
    if 'is_published' in data:
        module.is_published = bool(data['is_published'])
    if was_published != bool(module.is_published):
        _log_admin_action(
            current_user,
            action='module_published' if module.is_published else 'module_unpublished',
            entity_type='module',
            entity_id=module.id,
            entity_label=module.title,
            details={
                'module_slug': module.slug,
                'previous_state': 'published' if was_published else 'hidden',
                'next_state': 'published' if module.is_published else 'hidden',
            },
        )
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

    _log_admin_action(
        current_user,
        action='module_deleted',
        entity_type='module',
        entity_id=module.id,
        entity_label=module.title,
        details={
            'module_slug': module.slug,
            'age_group': module.age_group,
        },
    )
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
    module_was_hidden = not module.is_published

    if bool(data.get('publish_module_if_needed')) and module_was_hidden:
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
        quiz = build_lesson_quiz(lesson, data.get('quiz'), title, question_prefix='admin-q')
        if quiz is not None:
            db.session.add(quiz)
    except ValueError as exc:
        db.session.rollback()
        return {'message': str(exc)}, 400

    if module_was_hidden and module.is_published:
        _log_admin_action(
            current_user,
            action='module_published',
            entity_type='module',
            entity_id=module.id,
            entity_label=module.title,
            details={
                'module_slug': module.slug,
                'previous_state': 'hidden',
                'next_state': 'published',
                'reason': 'publish_module_if_needed',
            },
        )

    _log_admin_action(
        current_user,
        action='lesson_created',
        entity_type='lesson',
        entity_id=lesson.id,
        entity_label=lesson.title,
        details={
            'module_id': module.id,
            'module_title': module.title,
            'module_slug': module.slug,
            'publish_module_if_needed': bool(data.get('publish_module_if_needed')),
        },
    )
    db.session.commit()
    return {
        'lesson': lesson.to_dict(include_private=True),
        'roadmap_visible': bool(module.is_published and lesson.is_published),
        'module': module.to_dict(include_lessons=True),
    }, 201


@admin_bp.post('/admins')
@auth_required([UserRole.SUPERADMIN])
def create_admin(current_user: User):
    data = request.get_json() or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    password_error = validate_password(password, minimum_length=ADMIN_PASSWORD_MIN_LENGTH)
    if not email:
        return {'message': 'Укажите email нового администратора.'}, 400
    if password_error:
        return {'message': password_error}, 400

    username = (data.get('username') or email.split('@')[0]).strip().lower()
    if len(username) > USERNAME_MAX_LENGTH:
        return {'message': f'Логин должен содержать не более {USERNAME_MAX_LENGTH} символов.'}, 400
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
    db.session.flush()
    _log_admin_action(
        current_user,
        action='admin_created',
        entity_type='admin',
        entity_id=admin.id,
        entity_label=admin.username,
        details={
            'target_name': admin.full_name,
            'target_username': admin.username,
            'target_role': admin.role.value,
            'email': admin.email,
            'status': 'active',
        },
    )
    db.session.commit()
    return {'user': admin.to_dict()}, 201


@admin_bp.patch('/admins/<int:user_id>/block')
@auth_required([UserRole.SUPERADMIN])
def block_admin(current_user: User, user_id: int):
    user = User.query.get_or_404(user_id)
    error = _ensure_admin_target(user)
    if error:
        return error
    user.is_active = False
    user.bump_session_version()
    invalidate_session_version_cache(user.id)
    revoke_refresh_tokens_for_user(user.id)
    _log_admin_action(
        current_user,
        action='admin_blocked',
        entity_type='admin',
        entity_id=user.id,
        entity_label=user.username,
        details={
            'target_name': user.full_name,
            'target_username': user.username,
            'target_role': user.role.value,
            'status': 'blocked',
        },
    )
    db.session.commit()
    return {'user': user.to_dict()}


@admin_bp.patch('/admins/<int:user_id>/unblock')
@auth_required([UserRole.SUPERADMIN])
def unblock_admin(current_user: User, user_id: int):
    user = User.query.get_or_404(user_id)
    error = _ensure_admin_target(user)
    if error:
        return error
    user.is_active = True
    _log_admin_action(
        current_user,
        action='admin_unblocked',
        entity_type='admin',
        entity_id=user.id,
        entity_label=user.username,
        details={
            'target_name': user.full_name,
            'target_username': user.username,
            'target_role': user.role.value,
            'status': 'active',
        },
    )
    db.session.commit()
    return {'user': user.to_dict()}


@admin_bp.delete('/admins/<int:user_id>')
@auth_required([UserRole.SUPERADMIN])
def delete_admin(current_user: User, user_id: int):
    user = User.query.get_or_404(user_id)
    error = _ensure_admin_target(user)
    if error:
        return error
    revoke_refresh_tokens_for_user(user.id)
    _log_admin_action(
        current_user,
        action='admin_deleted',
        entity_type='admin',
        entity_id=user.id,
        entity_label=user.username,
        details={
            'target_name': user.full_name,
            'target_username': user.username,
            'target_role': user.role.value,
            'email': user.email,
            'status': 'deleted',
        },
    )
    db.session.delete(user)
    db.session.commit()
    return {'message': 'Админ удалён'}


@admin_bp.get('/audit-log-archives')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def list_audit_log_archives(current_user: User):
    from ..services.audit_log_archive import get_archive_dir, list_archive_dates

    archive_dir = get_archive_dir()
    return {
        'dates': list_archive_dates(archive_dir),
        'export_hour_utc': current_app.config.get('AUDIT_LOG_DAILY_EXPORT_HOUR_UTC', 3),
    }


@admin_bp.get('/audit-log-archives/<string:date_key>')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def download_audit_log_archive(current_user: User, date_key: str):
    from ..services.audit_log_archive import get_archive_dir, resolve_archive_file

    path = resolve_archive_file(get_archive_dir(), date_key)
    if not path or not path.is_file():
        return {'message': 'Архив за эту дату не найден.'}, 404
    return send_file(
        str(path),
        mimetype='application/json',
        as_attachment=True,
        download_name=path.name,
    )


@admin_bp.get('/audit-logs')
@auth_required([UserRole.ADMIN, UserRole.SUPERADMIN])
def audit_logs(current_user: User):
    action_filter = (request.args.get('action') or '').strip().lower()
    actor_role_filter = (request.args.get('actor_role') or '').strip().lower()
    target_filter = (request.args.get('target') or '').strip().lower()
    page = _safe_int(request.args.get('page'), 1, minimum=1)
    page_size = _safe_int(
        request.args.get('page_size'),
        DEFAULT_DIRECTORY_PAGE_SIZE,
        minimum=1,
        maximum=MAX_DIRECTORY_PAGE_SIZE,
    )

    query = AdminAuditLog.query
    if action_filter and action_filter != 'all':
        query = query.filter(AdminAuditLog.action == action_filter)
    if actor_role_filter in {UserRole.ADMIN.value, UserRole.SUPERADMIN.value}:
        query = query.filter(AdminAuditLog.actor_role == actor_role_filter)
    if target_filter:
        query = query.filter(AdminAuditLog.entity_label.ilike(f'%{target_filter}%'))

    query = query.order_by(AdminAuditLog.created_at.desc(), AdminAuditLog.id.desc())
    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    return {
        'audit_logs': [item.to_dict() for item in items],
        'pagination': _pagination_payload(total, page, page_size),
        'filters': {
            'action': action_filter or 'all',
            'actor_role': actor_role_filter or 'all',
            'target': target_filter,
        },
    }
