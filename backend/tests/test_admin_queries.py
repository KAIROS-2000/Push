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


class AdminLessonCreationTests(unittest.TestCase):
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

    def create_admin_fixture(self, app):
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.learning import Lesson, Module
        from app.models.user import User, UserRole

        with app.app_context():
            admin = User(
                full_name='Admin Example',
                username='admin',
                email='admin@example.com',
                password_hash=hash_password('AdminPass123!'),
                role=UserRole.ADMIN,
                age_group='adult',
            )
            db.session.add(admin)
            db.session.flush()

            module = Module(
                slug='middle-roadmap',
                title='Middle roadmap',
                description='Test roadmap module',
                age_group='middle',
                icon='sparkles',
                color='#4A90D9',
                order_index=1,
                is_published=False,
            )
            db.session.add(module)
            db.session.flush()

            first_lesson = Lesson(
                module_id=module.id,
                slug='lesson-1',
                title='Первый урок',
                summary='Первый урок модуля',
                content_format='mixed',
                theory_blocks=[],
                interactive_steps=[],
                order_index=1,
                duration_minutes=30,
                passing_score=70,
                is_published=True,
            )
            second_lesson = Lesson(
                module_id=module.id,
                slug='lesson-2',
                title='Второй урок',
                summary='Второй урок модуля',
                content_format='mixed',
                theory_blocks=[],
                interactive_steps=[],
                order_index=2,
                duration_minutes=35,
                passing_score=70,
                is_published=True,
            )
            db.session.add_all([first_lesson, second_lesson])
            db.session.commit()

            return module.id

    def login_admin(self, client):
        return client.post('/api/auth/login', json={'login': 'admin@example.com', 'password': 'AdminPass123!'})

    def test_admin_can_insert_lesson_and_publish_module(self):
        app = self.create_app()
        module_id = self.create_admin_fixture(app)

        with app.test_client() as client:
            login_response = self.login_admin(client)
            self.assertEqual(login_response.status_code, 200)

            response = client.post(
                f'/api/admin/modules/{module_id}/lessons',
                json={
                    'title': 'Новый урок между существующими',
                    'summary': 'Проверяем вставку в середину модуля.',
                    'theory_text': 'Основная теория урока.',
                    'key_points': ['Идея 1', 'Идея 2'],
                    'interactive_steps': ['Шаг 1', 'Шаг 2'],
                    'duration_minutes': 40,
                    'passing_score': 75,
                    'insert_position': 2,
                    'publish_module_if_needed': True,
                    'task': {'enabled': False},
                    'quiz': {'enabled': False, 'questions': []},
                },
            )
            self.assertEqual(response.status_code, 201)
            payload = response.get_json()
            self.assertTrue(payload['roadmap_visible'])
            self.assertTrue(payload['module']['is_published'])
            self.assertEqual(
                [item['title'] for item in payload['module']['lessons']],
                ['Первый урок', 'Новый урок между существующими', 'Второй урок'],
            )

        with app.app_context():
            from app.models.learning import Lesson, Module

            module = Module.query.get(module_id)
            ordered_titles = [
                lesson.title
                for lesson in Lesson.query.filter_by(module_id=module_id).order_by(Lesson.order_index.asc()).all()
            ]
            self.assertTrue(module.is_published)
            self.assertEqual(ordered_titles, ['Первый урок', 'Новый урок между существующими', 'Второй урок'])

    def test_admin_quiz_questions_are_normalized(self):
        app = self.create_app()
        module_id = self.create_admin_fixture(app)

        with app.test_client() as client:
            login_response = self.login_admin(client)
            self.assertEqual(login_response.status_code, 200)

            response = client.post(
                f'/api/admin/modules/{module_id}/lessons',
                json={
                    'title': 'Урок с квизом',
                    'summary': 'Проверяем нормализацию квиза.',
                    'theory_text': 'Немного теории.',
                    'key_points': ['Пункт 1', 'Пункт 2'],
                    'interactive_steps': ['Старт', 'Финиш'],
                    'duration_minutes': 30,
                    'passing_score': 70,
                    'insert_position': 3,
                    'publish_module_if_needed': False,
                    'task': {'enabled': False},
                    'quiz': {
                        'enabled': True,
                        'title': 'Квиз по теме',
                        'passing_score': 80,
                        'questions': [
                            {
                                'type': 'multiple',
                                'prompt': 'Выберите правильные варианты',
                                'options': ['A', 'B', 'C'],
                                'correct': [2, 0, 2, 'bad'],
                            },
                            {
                                'type': 'text',
                                'prompt': 'Назовите сущность',
                                'correct': ['алгоритм', 'Алгоритм'],
                            },
                        ],
                    },
                },
            )
            self.assertEqual(response.status_code, 201)
            payload = response.get_json()
            self.assertFalse(payload['roadmap_visible'])
            self.assertEqual(len(payload['lesson']['quizzes']), 1)
            questions = payload['lesson']['quizzes'][0]['questions']
            self.assertEqual(questions[0]['id'], 'admin-q1')
            self.assertEqual(questions[0]['correct'], [0, 2])
            self.assertEqual(questions[1]['id'], 'admin-q2')
            self.assertEqual(questions[1]['correct'], ['алгоритм', 'Алгоритм'])

    def test_admin_cannot_create_lesson_with_manual_review(self):
        app = self.create_app()
        module_id = self.create_admin_fixture(app)

        with app.test_client() as client:
            login_response = self.login_admin(client)
            self.assertEqual(login_response.status_code, 200)

            response = client.post(
                f'/api/admin/modules/{module_id}/lessons',
                json={
                    'title': 'Урок с ручной проверкой',
                    'summary': 'Такой урок должен быть отклонён.',
                    'theory_text': 'Немного теории.',
                    'key_points': ['Пункт 1', 'Пункт 2'],
                    'interactive_steps': ['Шаг 1', 'Шаг 2'],
                    'duration_minutes': 30,
                    'passing_score': 70,
                    'insert_position': 3,
                    'publish_module_if_needed': False,
                    'task': {
                        'enabled': True,
                        'task_type': 'text',
                        'title': 'Открытый ответ',
                        'prompt': 'Опиши решение своими словами.',
                        'evaluation_mode': 'manual',
                        'keywords': '',
                        'hints': [],
                        'tests': [],
                    },
                    'quiz': {'enabled': False, 'questions': []},
                },
            )

            self.assertEqual(response.status_code, 400)
            self.assertIn('не могут создавать уроки с ручной проверкой', response.get_json()['message'])


if __name__ == '__main__':
    unittest.main()
