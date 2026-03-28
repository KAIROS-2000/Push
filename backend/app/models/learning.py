from __future__ import annotations

import json
import re
from datetime import UTC, datetime, timedelta

from sqlalchemy.dialects.postgresql import JSONB

from ..core.db import db

JSONType = JSONB().with_variant(db.JSON(), 'sqlite')
CUSTOM_CLASSROOM_MODULE_PREFIX = 'teacher-class-'
DEFAULT_ASSIGNMENT_TYPE = 'lesson_practice'
DEFAULT_SUBMISSION_FORMAT = 'text'
DEFAULT_TASK_EVALUATION_MODE = 'manual'
DEFAULT_CODE_LANGUAGE = 'python'
VALID_ASSIGNMENT_TYPES = {'lesson_practice', 'mini_project', 'quiz', 'reflection'}
VALID_SUBMISSION_FORMATS = {'text', 'code', 'link', 'mixed'}
VALID_TASK_EVALUATION_MODES = {'manual', 'keywords', 'stdin_stdout'}
VALID_CODE_LANGUAGES = {'python', 'javascript'}
ASSIGNMENT_TYPE_LABELS = {
    'lesson_practice': 'Практика по уроку',
    'mini_project': 'Мини-проект',
    'quiz': 'Квиз / тест',
    'reflection': 'Рефлексия',
}
ASSIGNMENT_META_PREFIX = '[cq-assignment-meta]'
CODE_INTENT_ACTION_TOKENS = {
    'напиши',
    'написать',
    'создай',
    'создать',
    'реализуй',
    'реализовать',
    'сделай',
    'сделать',
    'добавь',
    'добавить',
    'используй',
    'использовать',
    'объяви',
    'объявить',
    'выведи',
    'вывести',
    'проверь',
    'проверить',
    'write',
    'create',
    'implement',
    'declare',
    'print',
    'use',
    'check',
}
CODE_INTENT_MARKER_TOKENS = {
    'if',
    'else',
    'let',
    'const',
    'function',
    'stdin',
    'stdout',
    'javascript',
    'python',
}
CODE_INTENT_MARKER_SNIPPETS = (
    'console.log',
    'input(',
    'print(',
    'addeventlistener',
    '=>',
)


def age_group_supports_code(age_group: str | None) -> bool:
    return (age_group or '').strip().lower() != 'junior'


def _contains_token(text: str, token: str) -> bool:
    pattern = rf'(^|[^a-zA-Zа-яА-ЯёЁ0-9_]){re.escape(token)}($|[^a-zA-Zа-яА-ЯёЁ0-9_])'
    return bool(re.search(pattern, text))


def has_explicit_code_task_intent(
    *,
    title: str | None = None,
    prompt: str | None = None,
    keywords: list[str] | None = None,
    starter_code: str | None = None,
) -> bool:
    if str(starter_code or '').strip():
        return True

    fragments: list[str] = []
    for value in [title, prompt]:
        text = str(value or '').strip()
        if text:
            fragments.append(text)
    for keyword in keywords or []:
        text = str(keyword or '').strip()
        if text:
            fragments.append(text)
    if not fragments:
        return False

    normalized = ' '.join(fragments).lower()
    has_action = any(_contains_token(normalized, token) for token in CODE_INTENT_ACTION_TOKENS)
    has_marker = any(snippet in normalized for snippet in CODE_INTENT_MARKER_SNIPPETS) or any(
        _contains_token(normalized, token) for token in CODE_INTENT_MARKER_TOKENS
    )
    return has_action and has_marker


def normalize_task_type(value: str | None, *, age_group: str | None = None) -> str:
    normalized = (value or '').strip().lower()
    return 'code' if normalized == 'code' and age_group_supports_code(age_group) else 'text'


def normalize_assignment_type(value: str | None) -> str:
    normalized = (value or DEFAULT_ASSIGNMENT_TYPE).strip().lower()
    return normalized if normalized in VALID_ASSIGNMENT_TYPES else DEFAULT_ASSIGNMENT_TYPE


def normalize_submission_format(value: str | None) -> str:
    normalized = (value or DEFAULT_SUBMISSION_FORMAT).strip().lower()
    return normalized if normalized in VALID_SUBMISSION_FORMATS else DEFAULT_SUBMISSION_FORMAT


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
    if not isinstance(value, list):
        return []
    rows: list[str] = []
    for item in value:
        text = str(item or '').strip()
        if text:
            rows.append(text)
    return rows


def _test_case_list(value) -> list[dict]:
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
        rows.append({
            'label': label,
            'input': test_input,
            'expected': expected,
        })
    return rows


def normalize_code_language(value: str | None, default: str | None = None) -> str:
    normalized = (value or default or DEFAULT_CODE_LANGUAGE).strip().lower()
    return normalized if normalized in VALID_CODE_LANGUAGES else (default or DEFAULT_CODE_LANGUAGE)


def normalize_task_evaluation_mode(
    value: str | None,
    *,
    is_custom_lesson: bool = False,
    task_type: str | None = None,
    has_keywords: bool = False,
    has_tests: bool = False,
    allow_code_runner: bool = True,
) -> str:
    normalized = (value or '').strip().lower()
    is_code_task = (task_type or '').strip().lower() == 'code'
    if is_code_task:
        return 'stdin_stdout'
    if normalized == 'stdin_stdout' and not allow_code_runner:
        normalized = ''
    if normalized in VALID_TASK_EVALUATION_MODES:
        return normalized
    if has_tests and allow_code_runner:
        return 'stdin_stdout'
    if has_keywords and not is_custom_lesson:
        return 'keywords'
    return DEFAULT_TASK_EVALUATION_MODE if is_custom_lesson else ('keywords' if has_keywords else DEFAULT_TASK_EVALUATION_MODE)


def normalize_task_validation(
    validation: dict | None,
    *,
    is_custom_lesson: bool = False,
    task_type: str | None = None,
    age_group: str | None = None,
) -> dict:
    raw = validation if isinstance(validation, dict) else {}
    keywords = _string_list(raw.get('keywords'))
    tests = _test_case_list(raw.get('tests'))
    code_allowed = age_group_supports_code(age_group)
    effective_task_type = normalize_task_type(task_type, age_group=age_group)
    is_code_task = effective_task_type == 'code'
    if not code_allowed:
        tests = []
    default_language = 'javascript' if (age_group or '').strip().lower() == 'senior' else DEFAULT_CODE_LANGUAGE
    evaluation_mode = normalize_task_evaluation_mode(
        raw.get('evaluation_mode') or raw.get('mode'),
        is_custom_lesson=is_custom_lesson,
        task_type=effective_task_type,
        has_keywords=bool(keywords),
        has_tests=bool(tests),
        allow_code_runner=code_allowed,
    )
    if is_code_task:
        keywords = []
    runner = 'stdin_stdout' if evaluation_mode == 'stdin_stdout' else None
    language = normalize_code_language(raw.get('language'), default=default_language)
    return {
        'evaluation_mode': evaluation_mode,
        'runner': runner,
        'language': language if effective_task_type == 'code' or evaluation_mode == 'stdin_stdout' else None,
        'keywords': keywords,
        'tests': tests,
        'time_limit_ms': _safe_int(raw.get('time_limit_ms'), 2000, minimum=500, maximum=10000),
        'memory_limit_mb': _safe_int(raw.get('memory_limit_mb'), 128, minimum=32, maximum=1024),
    }


def public_task_validation(
    validation: dict | None,
    *,
    is_custom_lesson: bool = False,
    task_type: str | None = None,
    age_group: str | None = None,
) -> dict:
    normalized = normalize_task_validation(
        validation,
        is_custom_lesson=is_custom_lesson,
        task_type=task_type,
        age_group=age_group,
    )
    return {
        'evaluation_mode': normalized['evaluation_mode'],
        'runner': normalized['runner'],
        'language': normalized['language'],
        'keywords': normalized['keywords'],
        'tests_count': len(normalized['tests']),
        'time_limit_ms': normalized['time_limit_ms'] if normalized['runner'] == 'stdin_stdout' else None,
        'memory_limit_mb': normalized['memory_limit_mb'] if normalized['runner'] == 'stdin_stdout' else None,
    }


def encode_assignment_description(
    description: str | None,
    assignment_type: str | None = None,
    submission_format: str | None = None,
) -> str:
    payload = json.dumps(
        {
            'assignment_type': normalize_assignment_type(assignment_type),
            'submission_format': normalize_submission_format(submission_format),
        },
        ensure_ascii=False,
    )
    body = (description or '').strip()
    return f'{ASSIGNMENT_META_PREFIX}{payload}\n{body}' if body else f'{ASSIGNMENT_META_PREFIX}{payload}'


def decode_assignment_description(raw_description: str | None) -> tuple[dict, str]:
    text = raw_description or ''
    if not text.startswith(ASSIGNMENT_META_PREFIX):
        default_type = DEFAULT_ASSIGNMENT_TYPE
        return (
            {
                'assignment_type': default_type,
                'assignment_type_label': ASSIGNMENT_TYPE_LABELS[default_type],
                'submission_format': DEFAULT_SUBMISSION_FORMAT,
            },
            text,
        )

    first_line, _, body = text.partition('\n')
    meta_raw = first_line[len(ASSIGNMENT_META_PREFIX):].strip()
    meta: dict = {}
    if meta_raw:
        try:
            meta = json.loads(meta_raw)
        except json.JSONDecodeError:
            meta = {}

    assignment_type = normalize_assignment_type(meta.get('assignment_type') if isinstance(meta, dict) else None)
    submission_format = normalize_submission_format(meta.get('submission_format') if isinstance(meta, dict) else None)
    return (
        {
            'assignment_type': assignment_type,
            'assignment_type_label': ASSIGNMENT_TYPE_LABELS[assignment_type],
            'submission_format': submission_format,
        },
        body.strip(),
    )


def build_custom_classroom_module_slug(classroom_id: int, age_group: str) -> str:
    normalized_group = (age_group or 'middle').strip().lower() or 'middle'
    return f'{CUSTOM_CLASSROOM_MODULE_PREFIX}{classroom_id}-{normalized_group}'


def custom_classroom_module_slug_prefix(classroom_id: int) -> str:
    return f'{CUSTOM_CLASSROOM_MODULE_PREFIX}{classroom_id}-'


def parse_custom_classroom_id_from_module_slug(slug: str | None) -> int | None:
    if not slug or not slug.startswith(CUSTOM_CLASSROOM_MODULE_PREFIX):
        return None
    tail = slug[len(CUSTOM_CLASSROOM_MODULE_PREFIX):]
    classroom_id, _, _ = tail.partition('-')
    return int(classroom_id) if classroom_id.isdigit() else None


class Module(db.Model):
    __tablename__ = 'modules'

    id = db.Column(db.Integer, primary_key=True)
    slug = db.Column(db.String(120), unique=True, nullable=False)
    title = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text, nullable=False)
    age_group = db.Column(db.String(20), nullable=False)
    icon = db.Column(db.String(32), nullable=False, default='sparkles')
    color = db.Column(db.String(20), nullable=False, default='#4A90D9')
    order_index = db.Column(db.Integer, nullable=False)
    is_published = db.Column(db.Boolean, nullable=False, default=True)

    lessons = db.relationship('Lesson', back_populates='module', order_by='Lesson.order_index', cascade='all, delete-orphan')

    @property
    def custom_classroom_id(self) -> int | None:
        return parse_custom_classroom_id_from_module_slug(self.slug)

    @property
    def is_custom_classroom_module(self) -> bool:
        return self.custom_classroom_id is not None

    def to_dict(self, include_lessons: bool = False) -> dict:
        payload = {
            'id': self.id,
            'slug': self.slug,
            'title': self.title,
            'description': self.description,
            'age_group': self.age_group,
            'icon': self.icon,
            'color': self.color,
            'order_index': self.order_index,
            'is_published': self.is_published,
            'is_custom_classroom_module': self.is_custom_classroom_module,
            'custom_classroom_id': self.custom_classroom_id,
        }
        if include_lessons:
            payload['lessons'] = [lesson.to_summary_dict() for lesson in self.lessons]
        return payload


class Lesson(db.Model):
    __tablename__ = 'lessons'

    id = db.Column(db.Integer, primary_key=True)
    module_id = db.Column(db.Integer, db.ForeignKey('modules.id'), nullable=False)
    slug = db.Column(db.String(120), unique=True, nullable=False)
    title = db.Column(db.String(140), nullable=False)
    summary = db.Column(db.Text, nullable=False)
    content_format = db.Column(db.String(32), nullable=False, default='mixed')
    theory_blocks = db.Column(JSONType, nullable=False, default=list)
    interactive_steps = db.Column(JSONType, nullable=False, default=list)
    order_index = db.Column(db.Integer, nullable=False)
    duration_minutes = db.Column(db.Integer, nullable=False, default=10)
    passing_score = db.Column(db.Integer, nullable=False, default=70)
    is_published = db.Column(db.Boolean, nullable=False, default=True)

    module = db.relationship('Module', back_populates='lessons')
    tasks = db.relationship('Task', back_populates='lesson', cascade='all, delete-orphan')
    quizzes = db.relationship('Quiz', back_populates='lesson', cascade='all, delete-orphan')
    progress = db.relationship('UserProgress', back_populates='lesson', cascade='all, delete-orphan')

    def to_summary_dict(self) -> dict:
        return {
            'id': self.id,
            'slug': self.slug,
            'title': self.title,
            'summary': self.summary,
            'duration_minutes': self.duration_minutes,
            'passing_score': self.passing_score,
            'order_index': self.order_index,
            'module_title': self.module.title,
            'is_custom': self.module.is_custom_classroom_module,
            'custom_classroom_id': self.module.custom_classroom_id,
        }

    def to_dict(self) -> dict:
        return {
            **self.to_summary_dict(),
            'module': self.module.to_dict(include_lessons=True),
            'content_format': self.content_format,
            'theory_blocks': self.theory_blocks,
            'interactive_steps': self.interactive_steps,
            'tasks': [task.to_dict() for task in self.tasks],
            'quizzes': [quiz.to_dict() for quiz in self.quizzes],
        }


class Task(db.Model):
    __tablename__ = 'tasks'

    id = db.Column(db.Integer, primary_key=True)
    lesson_id = db.Column(db.Integer, db.ForeignKey('lessons.id'), nullable=False)
    task_type = db.Column(db.String(32), nullable=False)
    title = db.Column(db.String(120), nullable=False)
    prompt = db.Column(db.Text, nullable=False)
    starter_code = db.Column(db.Text, nullable=True)
    validation = db.Column(JSONType, nullable=False, default=dict)
    hints = db.Column(JSONType, nullable=False, default=list)
    xp_reward = db.Column(db.Integer, nullable=False, default=30)

    lesson = db.relationship('Lesson', back_populates='tasks')

    def normalized_validation(self, include_private: bool = False) -> dict:
        payload = normalize_task_validation(
            self.validation,
            is_custom_lesson=bool(self.lesson and self.lesson.module.is_custom_classroom_module),
            task_type=self.task_type,
            age_group=self.lesson.module.age_group if self.lesson else None,
        )
        if include_private:
            return payload
        return public_task_validation(
            self.validation,
            is_custom_lesson=bool(self.lesson and self.lesson.module.is_custom_classroom_module),
            task_type=self.task_type,
            age_group=self.lesson.module.age_group if self.lesson else None,
        )

    def requires_teacher_review(self) -> bool:
        return bool(self.lesson and self.lesson.module.is_custom_classroom_module and self.normalized_validation(include_private=True)['evaluation_mode'] == 'manual')

    def to_dict(self) -> dict:
        age_group = self.lesson.module.age_group if self.lesson else None
        effective_task_type = normalize_task_type(self.task_type, age_group=age_group)
        return {
            'id': self.id,
            'task_type': effective_task_type,
            'title': self.title,
            'prompt': self.prompt,
            'starter_code': self.starter_code if effective_task_type == 'code' else '',
            'validation': self.normalized_validation(),
            'hints': self.hints,
            'xp_reward': self.xp_reward,
        }


def lesson_requires_teacher_review(lesson: Lesson) -> bool:
    if not lesson.module.is_custom_classroom_module:
        return False
    if not lesson.tasks:
        return True
    return any(task.requires_teacher_review() for task in lesson.tasks)


class Quiz(db.Model):
    __tablename__ = 'quizzes'

    id = db.Column(db.Integer, primary_key=True)
    lesson_id = db.Column(db.Integer, db.ForeignKey('lessons.id'), nullable=False)
    title = db.Column(db.String(120), nullable=False)
    passing_score = db.Column(db.Integer, nullable=False, default=70)
    questions = db.Column(JSONType, nullable=False, default=list)
    xp_reward = db.Column(db.Integer, nullable=False, default=50)

    lesson = db.relationship('Lesson', back_populates='quizzes')

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'title': self.title,
            'passing_score': self.passing_score,
            'questions': self.questions,
            'xp_reward': self.xp_reward,
        }


class Classroom(db.Model):
    __tablename__ = 'classrooms'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text, nullable=True)
    code = db.Column(db.String(12), unique=True, nullable=False)
    teacher_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)

    teacher = db.relationship('User', back_populates='classes_created')
    assignments = db.relationship('Assignment', back_populates='classroom', cascade='all, delete-orphan')
    members = db.relationship('ClassMembership', back_populates='classroom', cascade='all, delete-orphan')

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'code': self.code,
            'teacher_id': self.teacher_id,
            'students_count': len(self.members),
            'assignments_count': len(self.assignments),
        }


class ClassMembership(db.Model):
    __tablename__ = 'class_memberships'

    id = db.Column(db.Integer, primary_key=True)
    classroom_id = db.Column(db.Integer, db.ForeignKey('classrooms.id'), nullable=False)
    student_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    joined_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)

    classroom = db.relationship('Classroom', back_populates='members')
    student = db.relationship('User', back_populates='memberships')


class Assignment(db.Model):
    __tablename__ = 'assignments'

    id = db.Column(db.Integer, primary_key=True)
    classroom_id = db.Column(db.Integer, db.ForeignKey('classrooms.id'), nullable=False)
    lesson_id = db.Column(db.Integer, db.ForeignKey('lessons.id'), nullable=True)
    title = db.Column(db.String(160), nullable=False)
    description = db.Column(db.Text, nullable=False)
    difficulty = db.Column(db.String(20), nullable=False, default='medium')
    due_date = db.Column(db.String(40), nullable=True)
    xp_reward = db.Column(db.Integer, nullable=False, default=80)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)

    classroom = db.relationship('Classroom', back_populates='assignments')
    lesson = db.relationship('Lesson')
    submissions = db.relationship('AssignmentSubmission', back_populates='assignment', cascade='all, delete-orphan')

    def to_dict(self) -> dict:
        metadata, description = decode_assignment_description(self.description)
        return {
            'id': self.id,
            'classroom_id': self.classroom_id,
            'lesson_id': self.lesson_id,
            'title': self.title,
            'description': description,
            'difficulty': self.difficulty,
            'due_date': self.due_date,
            'xp_reward': self.xp_reward,
            'assignment_type': metadata['assignment_type'],
            'assignment_type_label': metadata['assignment_type_label'],
            'submission_format': metadata['submission_format'],
            'lesson': self.lesson.to_summary_dict() if self.lesson else None,
            'lesson_url': f'/lessons/{self.lesson_id}' if self.lesson_id else None,
        }


class AssignmentSubmission(db.Model):
    __tablename__ = 'assignment_submissions'

    id = db.Column(db.Integer, primary_key=True)
    assignment_id = db.Column(db.Integer, db.ForeignKey('assignments.id'), nullable=False)
    student_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    answer = db.Column(db.Text, nullable=True)
    score = db.Column(db.Integer, nullable=False, default=0)
    status = db.Column(db.String(20), nullable=False, default='submitted')
    feedback = db.Column(db.Text, nullable=True)
    submitted_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)

    assignment = db.relationship('Assignment', back_populates='submissions')
    student = db.relationship('User')

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'assignment_id': self.assignment_id,
            'student_id': self.student_id,
            'student_username': self.student.username if self.student else None,
            'answer': self.answer,
            'score': self.score,
            'status': self.status,
            'feedback': self.feedback,
            'submitted_at': self.submitted_at.isoformat(),
        }


class UserProgress(db.Model):
    __tablename__ = 'user_progress'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    lesson_id = db.Column(db.Integer, db.ForeignKey('lessons.id'), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='not_started')
    score = db.Column(db.Integer, nullable=False, default=0)
    attempts = db.Column(db.Integer, nullable=False, default=0)
    hints_used = db.Column(db.Integer, nullable=False, default=0)
    started_at = db.Column(db.DateTime(timezone=True), nullable=True)
    completed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    user = db.relationship('User', back_populates='progress')
    lesson = db.relationship('Lesson', back_populates='progress')

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'user_id': self.user_id,
            'lesson_id': self.lesson_id,
            'status': self.status,
            'score': self.score,
            'attempts': self.attempts,
            'hints_used': self.hints_used,
            'started_at': self.started_at.isoformat() if self.started_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
        }


class Achievement(db.Model):
    __tablename__ = 'achievements'

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(60), unique=True, nullable=False)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text, nullable=False)
    category = db.Column(db.String(40), nullable=False)
    icon = db.Column(db.String(40), nullable=False)
    xp_reward = db.Column(db.Integer, nullable=False, default=50)

    users = db.relationship('UserAchievement', back_populates='achievement', cascade='all, delete-orphan')

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'code': self.code,
            'name': self.name,
            'description': self.description,
            'category': self.category,
            'icon': self.icon,
            'xp_reward': self.xp_reward,
        }


class UserAchievement(db.Model):
    __tablename__ = 'user_achievements'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    achievement_id = db.Column(db.Integer, db.ForeignKey('achievements.id'), nullable=False)
    earned_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)

    user = db.relationship('User', back_populates='achievements')
    achievement = db.relationship('Achievement', back_populates='users')


class ParentInvite(db.Model):
    __tablename__ = 'parent_invites'

    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    code = db.Column(db.String(32), unique=True, nullable=False, index=True)
    label = db.Column(db.String(80), nullable=False, default='Семейный доступ')
    active = db.Column(db.Boolean, nullable=False, default=True)
    weekly_limit_minutes = db.Column(db.Integer, nullable=True)
    modules_whitelist = db.Column(JSONType, nullable=False, default=list)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)

    student = db.relationship('User')

    @property
    def is_expired(self) -> bool:
        return bool(self.expires_at and self.expires_at < datetime.now(UTC))

    @classmethod
    def next_month_expiry(cls) -> datetime:
        return datetime.now(UTC) + timedelta(days=30)

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'student_id': self.student_id,
            'code': self.code,
            'label': self.label,
            'active': self.active,
            'weekly_limit_minutes': self.weekly_limit_minutes,
            'modules_whitelist': self.modules_whitelist,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
            'created_at': self.created_at.isoformat(),
        }
