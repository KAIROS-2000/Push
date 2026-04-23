from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


class TeacherReadPathTests(unittest.TestCase):
    def setUp(self) -> None:
        self._apps = []
        self._tempdirs: list[tempfile.TemporaryDirectory[str]] = []

    def tearDown(self) -> None:
        for app in self._apps:
            with app.app_context():
                from app.core.db import db

                db.session.remove()
                db.engine.dispose()
        for tempdir in self._tempdirs:
            tempdir.cleanup()

    def create_app(self):
        tempdir = tempfile.TemporaryDirectory()
        self._tempdirs.append(tempdir)
        database_path = Path(tempdir.name) / 'test.db'
        env = {
            'APP_ENV': 'development',
            'SECRET_KEY': 'UnitTestSecretKey123!UnitTestSecretKey123!',
            'DATABASE_URL': f'sqlite:///{database_path.as_posix()}',
            'CLIENT_URL': 'http://localhost:3000',
            'ENABLE_DEMO_DATA': 'false',
            'SUPERADMIN_BOOTSTRAP': 'false',
            'SESSION_COOKIE_SECURE': 'false',
            'GIGACHAT_VERIFY_SSL': 'true',
            'METRICS_DEBUG': 'false',
        }

        with patch.dict(os.environ, env, clear=False):
            import app.core.config as config_module
            import app as app_module

            importlib.reload(config_module)
            importlib.reload(app_module)

            app = app_module.create_app()
            app.config.update(TESTING=True)
            with app.app_context():
                from app import models  # noqa: F401
                from app.core.db import db

                db.create_all()
            self._apps.append(app)
            return app

    def create_teacher_fixture(self, app):
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.learning import Assignment, Classroom
        from app.models.user import User, UserRole

        with app.app_context():
            teacher = User(
                full_name='Teacher Example',
                username='teacher',
                email='teacher@example.com',
                password_hash=hash_password('TeacherPass123!'),
                role=UserRole.TEACHER,
                age_group=None,
            )
            student = User(
                full_name='Student Example',
                username='student',
                email='student@example.com',
                password_hash=hash_password('StudentPass123!'),
                role=UserRole.STUDENT,
                age_group='middle',
            )
            db.session.add_all([teacher, student])
            db.session.flush()

            classroom = Classroom(
                name='Math',
                description='Test class',
                code='CLASS1',
                teacher_id=teacher.id,
            )
            db.session.add(classroom)
            db.session.flush()

            assignment = Assignment(
                classroom_id=classroom.id,
                lesson_id=None,
                title='Read-only assignment',
                description='Simple description',
                difficulty='medium',
                due_date=None,
                xp_reward=0,
            )
            db.session.add(assignment)
            db.session.commit()
            return teacher.id, classroom.id, assignment.id

    def create_teacher_assignment_fixture(self, app):
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.learning import Classroom, Lesson, Module
        from app.models.user import User, UserRole

        with app.app_context():
            teacher = User(
                full_name='Teacher Example',
                username='teacher',
                email='teacher@example.com',
                password_hash=hash_password('TeacherPass123!'),
                role=UserRole.TEACHER,
                age_group=None,
            )
            db.session.add(teacher)
            db.session.flush()

            classroom = Classroom(
                name='Math',
                description='Test class',
                code='CLASS1',
                teacher_id=teacher.id,
            )
            db.session.add(classroom)
            db.session.flush()

            module = Module(
                slug='published-module',
                title='Published module',
                description='Module for assignment tests',
                age_group='middle',
                icon='sparkles',
                color='#4A90D9',
                order_index=1,
                is_published=True,
            )
            db.session.add(module)
            db.session.flush()

            lesson = Lesson(
                module_id=module.id,
                slug='published-lesson',
                title='Published lesson',
                summary='Lesson summary',
                content_format='mixed',
                theory_blocks=[],
                interactive_steps=[],
                order_index=1,
                duration_minutes=30,
                passing_score=70,
                is_published=True,
            )
            db.session.add(lesson)
            db.session.commit()

            return classroom.id, lesson.id

    def login_teacher(self, client):
        return client.post('/api/auth/login', json={'login': 'teacher@example.com', 'password': 'TeacherPass123!'})

    def test_teacher_cannot_create_class_without_name(self):
        app = self.create_app()
        self.create_teacher_fixture(app)

        from app.models.learning import Classroom

        with app.test_client() as client:
            login_response = self.login_teacher(client)
            self.assertEqual(login_response.status_code, 200)

            response = client.post(
                '/api/teacher/classes',
                json={'name': '   ', 'description': 'Описание без названия'},
            )
            self.assertEqual(response.status_code, 400)
            payload = response.get_json()
            self.assertEqual(payload['fields'], ['name'])
            self.assertIn('название класса', payload['message'])

        with app.app_context():
            self.assertEqual(Classroom.query.count(), 1)

    def test_teacher_read_endpoints_do_not_backfill_submissions(self):
        app = self.create_app()
        teacher_id, classroom_id, assignment_id = self.create_teacher_fixture(app)

        from app.models.learning import AssignmentSubmission

        with app.test_client() as client:
            login_response = self.login_teacher(client)
            self.assertEqual(login_response.status_code, 200)

            overview = client.get('/api/teacher/overview')
            self.assertEqual(overview.status_code, 200)

            assignments = client.get(f'/api/teacher/classes/{classroom_id}/assignments')
            self.assertEqual(assignments.status_code, 200)

            submissions = client.get(f'/api/teacher/assignments/{assignment_id}/submissions')
            self.assertEqual(submissions.status_code, 200)
            self.assertEqual(submissions.get_json()['submissions'], [])

        with app.app_context():
            self.assertEqual(AssignmentSubmission.query.count(), 0)

    def test_teacher_cannot_create_assignment_without_lesson(self):
        app = self.create_app()
        classroom_id, lesson_id = self.create_teacher_assignment_fixture(app)

        from app.models.learning import Assignment

        with app.test_client() as client:
            login_response = self.login_teacher(client)
            self.assertEqual(login_response.status_code, 200)

            response = client.post(
                f'/api/teacher/classes/{classroom_id}/assignments',
                json={
                    'title': 'Практика по теме',
                    'description': 'Закрепите материал урока.',
                    'due_date': '2026-04-20',
                    'difficulty': 'medium',
                    'assignment_type': 'lesson_practice',
                    'submission_format': 'mixed',
                    'learning_goal': 'Повторить ключевую тему.',
                    'work_steps': 'Открой урок\nВыполни задание',
                    'success_criteria': 'Есть готовое решение',
                    'resources': 'Конспект урока',
                },
            )
            self.assertEqual(response.status_code, 400)
            payload = response.get_json()
            self.assertIn('lesson_id', payload['fields'])
            self.assertIn('урок', payload['message'])

        with app.app_context():
            self.assertEqual(Assignment.query.count(), 0)

    def test_teacher_cannot_create_assignment_with_empty_required_fields(self):
        app = self.create_app()
        classroom_id, lesson_id = self.create_teacher_assignment_fixture(app)

        from app.models.learning import Assignment

        with app.test_client() as client:
            login_response = self.login_teacher(client)
            self.assertEqual(login_response.status_code, 200)

            response = client.post(
                f'/api/teacher/classes/{classroom_id}/assignments',
                json={
                    'title': '   ',
                    'lesson_id': lesson_id,
                    'description': '   ',
                    'due_date': '',
                    'difficulty': 'medium',
                    'assignment_type': 'lesson_practice',
                    'submission_format': 'mixed',
                    'learning_goal': '   ',
                    'work_steps': '',
                    'success_criteria': ' ',
                    'resources': '',
                },
            )
            self.assertEqual(response.status_code, 400)
            payload = response.get_json()
            self.assertCountEqual(
                payload['fields'],
                [
                    'title',
                    'due_date',
                    'learning_goal',
                    'resources',
                    'work_steps',
                    'success_criteria',
                    'description',
                ],
            )

        with app.app_context():
            self.assertEqual(Assignment.query.count(), 0)

    def test_teacher_cannot_create_lesson_with_empty_required_fields(self):
        app = self.create_app()
        _, classroom_id, _ = self.create_teacher_fixture(app)

        from app.models.learning import Lesson

        with app.test_client() as client:
            login_response = self.login_teacher(client)
            self.assertEqual(login_response.status_code, 200)

            response = client.post(
                f'/api/teacher/classes/{classroom_id}/lessons',
                json={
                    'title': '   ',
                    'summary': '',
                    'duration_minutes': '',
                    'passing_score': ' ',
                    'theory_text': '   ',
                    'key_points': 'Только один тезис',
                    'interactive_steps': 'Один шаг',
                    'practice_enabled': False,
                },
            )
            self.assertEqual(response.status_code, 400)
            payload = response.get_json()
            self.assertCountEqual(
                payload['fields'],
                [
                    'title',
                    'summary',
                    'duration_minutes',
                    'passing_score',
                    'theory_text',
                    'key_points',
                    'interactive_steps',
                ],
            )

        with app.app_context():
            self.assertEqual(Lesson.query.count(), 0)

    def test_teacher_cannot_create_lesson_with_incomplete_practice(self):
        app = self.create_app()
        _, classroom_id, _ = self.create_teacher_fixture(app)

        from app.models.learning import Lesson, Task

        with app.test_client() as client:
            login_response = self.login_teacher(client)
            self.assertEqual(login_response.status_code, 200)

            response = client.post(
                f'/api/teacher/classes/{classroom_id}/lessons',
                json={
                    'title': 'Кодовая практика',
                    'summary': 'Учимся читать входные данные и выводить результат.',
                    'age_group': 'middle',
                    'duration_minutes': 45,
                    'passing_score': 70,
                    'theory_text': 'Разберите ввод, обработку и вывод результата.',
                    'key_points': 'Ввод\nВывод',
                    'interactive_steps': 'Прочитать условие\nПроверить пример',
                    'practice_enabled': True,
                    'task_type': 'code',
                    'task_title': '   ',
                    'task_prompt': '',
                    'starter_code': '   ',
                    'evaluation_mode': 'stdin_stdout',
                    'programming_language': 'python',
                    'judge_tests': [{'input': '7', 'expected': ''}],
                },
            )
            self.assertEqual(response.status_code, 400)
            payload = response.get_json()
            self.assertCountEqual(
                payload['fields'],
                ['task_title', 'task_prompt', 'starter_code', 'judge_tests'],
            )

        with app.app_context():
            self.assertEqual(Lesson.query.count(), 0)
            self.assertEqual(Task.query.count(), 0)

    def test_teacher_rejects_partial_lesson_judge_tests(self):
        app = self.create_app()
        _, classroom_id, _ = self.create_teacher_fixture(app)

        from app.models.learning import Lesson, Task

        with app.test_client() as client:
            login_response = self.login_teacher(client)
            self.assertEqual(login_response.status_code, 200)

            response = client.post(
                f'/api/teacher/classes/{classroom_id}/lessons',
                json={
                    'title': 'Кодовая практика',
                    'summary': 'Учимся читать входные данные и выводить результат.',
                    'age_group': 'middle',
                    'duration_minutes': 45,
                    'passing_score': 70,
                    'theory_text': 'Разберите ввод, обработку и вывод результата.',
                    'key_points': 'Ввод\nВывод',
                    'interactive_steps': 'Прочитать условие\nПроверить пример',
                    'practice_enabled': True,
                    'task_type': 'code',
                    'task_title': 'Напиши решение',
                    'task_prompt': 'Считай число и выведи его.',
                    'starter_code': 'print(input())',
                    'evaluation_mode': 'stdin_stdout',
                    'programming_language': 'python',
                    'judge_tests': [
                        {'input': '7', 'expected': '7'},
                        {'input': '8', 'expected': ''},
                    ],
                },
            )
            self.assertEqual(response.status_code, 400)
            payload = response.get_json()
            self.assertEqual(payload['fields'], ['judge_tests'])

        with app.app_context():
            self.assertEqual(Lesson.query.count(), 0)
            self.assertEqual(Task.query.count(), 0)

    def test_teacher_can_create_lesson_with_quiz_and_read_player_payload(self):
        app = self.create_app()
        _, classroom_id, _ = self.create_teacher_fixture(app)

        with app.test_client() as client:
            login_response = self.login_teacher(client)
            self.assertEqual(login_response.status_code, 200)

            response = client.post(
                f'/api/teacher/classes/{classroom_id}/lessons',
                json={
                    'title': 'Авторский урок по алгоритмам',
                    'summary': 'Разбираем последовательность действий и проверяем понимание.',
                    'age_group': 'middle',
                    'duration_minutes': 50,
                    'passing_score': 80,
                    'theory_text': 'Алгоритм помогает выполнять задачу шаг за шагом.',
                    'key_points': 'Алгоритм\nПоследовательность действий',
                    'interactive_steps': 'Прочитать задачу\nРазбить решение на шаги',
                    'quiz': {
                        'enabled': True,
                        'title': 'Финальный квиз',
                        'passing_score': 75,
                        'questions': [
                            {
                                'type': 'single',
                                'prompt': 'Что описывает алгоритм?',
                                'options': ['Последовательность действий', 'Цвет интерфейса'],
                                'correct': [0],
                            },
                            {
                                'type': 'text',
                                'prompt': 'Как называется понятный порядок шагов?',
                                'correct': ['алгоритм'],
                            },
                        ],
                    },
                },
            )
            self.assertEqual(response.status_code, 201)
            payload = response.get_json()
            lesson_id = payload['lesson']['id']
            self.assertEqual(payload['catalog_item']['id'], lesson_id)
            self.assertEqual(payload['catalog_item']['source'], 'teacher')
            self.assertEqual(len(payload['lesson']['quizzes']), 1)
            self.assertEqual(payload['lesson']['quizzes'][0]['title'], 'Финальный квиз')
            self.assertEqual(len(payload['lesson']['quizzes'][0]['questions']), 2)

            catalog_response = client.get(f'/api/teacher/lesson-catalog?classroom_id={classroom_id}')
            self.assertEqual(catalog_response.status_code, 200)
            catalog_payload = catalog_response.get_json()
            self.assertTrue(any(item['id'] == lesson_id for item in catalog_payload['lessons']))

            lesson_response = client.get(f'/api/lessons/{lesson_id}')
            self.assertEqual(lesson_response.status_code, 200)
            lesson_payload = lesson_response.get_json()
            self.assertEqual(len(lesson_payload['lesson']['quizzes']), 1)
            for question in lesson_payload['lesson']['quizzes'][0]['questions']:
                self.assertNotIn('correct', question)

        with app.app_context():
            from app.models.learning import Lesson, Quiz

            lesson = Lesson.query.get(lesson_id)
            self.assertIsNotNone(lesson)
            self.assertEqual(lesson.module.custom_classroom_id, classroom_id)
            self.assertEqual(Quiz.query.count(), 1)

    def test_teacher_rejects_junior_code_practice(self):
        app = self.create_app()
        _, classroom_id, _ = self.create_teacher_fixture(app)

        with app.test_client() as client:
            login_response = self.login_teacher(client)
            self.assertEqual(login_response.status_code, 200)

            response = client.post(
                f'/api/teacher/classes/{classroom_id}/lessons',
                json={
                    'title': 'Junior код',
                    'summary': 'Проверяем ограничение для junior.',
                    'age_group': 'junior',
                    'duration_minutes': 40,
                    'passing_score': 70,
                    'theory_text': 'Короткая теория.',
                    'key_points': 'Условие\nРезультат',
                    'interactive_steps': 'Прочитать\nОтветить',
                    'task_type': 'code',
                    'task_title': 'Напиши решение',
                    'task_prompt': 'Считай число и выведи его.',
                    'starter_code': 'print(input())',
                    'evaluation_mode': 'stdin_stdout',
                    'programming_language': 'python',
                    'judge_tests': [
                        {'label': 'Тест 1', 'input': '7', 'expected': '7'},
                    ],
                },
            )
            self.assertEqual(response.status_code, 400)
            self.assertIn('Junior-уроков кодовая практика недоступна', response.get_json()['message'])

    def test_teacher_rejects_invalid_quiz_payload(self):
        app = self.create_app()
        _, classroom_id, _ = self.create_teacher_fixture(app)

        with app.test_client() as client:
            login_response = self.login_teacher(client)
            self.assertEqual(login_response.status_code, 200)

            response = client.post(
                f'/api/teacher/classes/{classroom_id}/lessons',
                json={
                    'title': 'Урок с ошибочным квизом',
                    'summary': 'Проверяем server-side валидацию квиза.',
                    'age_group': 'middle',
                    'duration_minutes': 45,
                    'passing_score': 70,
                    'theory_text': 'Немного теории.',
                    'key_points': 'Факт 1\nФакт 2',
                    'interactive_steps': 'Шаг 1\nШаг 2',
                    'quiz': {
                        'enabled': True,
                        'title': 'Пустой квиз',
                        'passing_score': 60,
                        'questions': [
                            {
                                'type': 'single',
                                'prompt': 'Выберите правильный ответ',
                                'options': ['Только один вариант'],
                                'correct': [0],
                            }
                        ],
                    },
                },
            )
            self.assertEqual(response.status_code, 400)
            self.assertIn('корректный вопрос', response.get_json()['message'])

        with app.app_context():
            from app.models.learning import Lesson, Quiz

            self.assertEqual(Lesson.query.count(), 0)
            self.assertEqual(Quiz.query.count(), 0)


if __name__ == '__main__':
    unittest.main()
