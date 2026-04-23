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


def assert_has_keys(testcase: unittest.TestCase, payload: dict, keys: set[str], path: str) -> None:
    missing = keys - set(payload)
    testcase.assertFalse(missing, f'{path} missing keys: {sorted(missing)}')


class ApiContractTests(unittest.TestCase):
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
            'CODE_JUDGE_RUNNER_URL': 'http://judge-runner:8090/execute',
            'CODE_JUDGE_RUNNER_TOKEN': 'unit-test-runner-token',
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
                from app.core.migrations import upgrade_database

                upgrade_database()
            self._apps.append(app)
            return app

    def seed_fixture(self, app):
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.learning import Classroom, Lesson, Module, Quiz, Task
        from app.models.user import User, UserRole

        with app.app_context():
            student = User(
                full_name='Student Example',
                username='student',
                email='student@example.com',
                password_hash=hash_password('StudentPass123!'),
                role=UserRole.STUDENT,
                age_group='middle',
            )
            teacher = User(
                full_name='Teacher Example',
                username='teacher',
                email='teacher@example.com',
                password_hash=hash_password('TeacherPass123!'),
                role=UserRole.TEACHER,
            )
            admin = User(
                full_name='Admin Example',
                username='admin',
                email='admin@example.com',
                password_hash=hash_password('AdminPass123!'),
                role=UserRole.ADMIN,
            )
            db.session.add_all([student, teacher, admin])
            db.session.flush()
            module = Module(
                slug='middle-contracts',
                title='Contracts',
                description='Contract fixture',
                age_group='middle',
                icon='code',
                color='#4A90D9',
                order_index=1,
                is_published=True,
            )
            db.session.add(module)
            db.session.flush()
            lesson = Lesson(
                module_id=module.id,
                slug='contract-lesson',
                title='Contract lesson',
                summary='Contract summary',
                order_index=1,
                passing_score=70,
                theory_blocks=[],
                interactive_steps=[],
            )
            db.session.add(lesson)
            db.session.flush()
            task = Task(
                lesson_id=lesson.id,
                task_type='text',
                title='Text task',
                prompt='Explain',
                starter_code='',
                validation={'evaluation_mode': 'keywords', 'keywords': ['ok']},
                hints=[],
                xp_reward=10,
            )
            quiz = Quiz(
                lesson_id=lesson.id,
                title='Quiz',
                questions=[{'id': 'q1', 'type': 'single', 'prompt': 'Pick', 'options': ['ok'], 'correct': [0]}],
                passing_score=70,
                xp_reward=10,
            )
            classroom = Classroom(name='Class A', description='Test class', code='CLASSA', teacher_id=teacher.id)
            db.session.add_all([task, quiz, classroom])
            db.session.commit()
            return {
                'lesson_id': lesson.id,
                'task_id': task.id,
                'quiz_id': quiz.id,
                'classroom_id': classroom.id,
            }

    def login(self, client, login: str, password: str):
        response = client.post('/api/auth/login', json={'login': login, 'password': password})
        self.assertEqual(response.status_code, 200)
        return response

    def test_auth_and_lesson_contracts_match_frontend_assumptions(self):
        app = self.create_app()
        ids = self.seed_fixture(app)

        with app.test_client() as client:
            self.login(client, 'student@example.com', 'StudentPass123!')
            me_payload = client.get('/api/auth/me').get_json()
            lesson_payload = client.get(f"/api/lessons/{ids['lesson_id']}").get_json()

        assert_has_keys(self, me_payload, {'user'}, '/api/auth/me')
        assert_has_keys(
            self,
            me_payload['user'],
            {'id', 'full_name', 'username', 'email', 'role', 'age_group', 'xp', 'level', 'rank_title', 'xp_to_next', 'streak', 'theme', 'is_active'},
            '/api/auth/me.user',
        )
        assert_has_keys(
            self,
            lesson_payload,
            {'lesson', 'progress', 'is_finished', 'viewer_role'},
            '/api/lessons/<id>',
        )
        task = lesson_payload['lesson']['tasks'][0]
        assert_has_keys(self, task, {'id', 'task_type', 'title', 'prompt', 'starter_code', 'validation', 'hints', 'xp_reward'}, 'lesson.task')
        assert_has_keys(self, task['validation'], {'evaluation_mode', 'runner', 'language', 'keywords', 'tests_count', 'time_limit_ms', 'memory_limit_mb'}, 'lesson.task.validation')

    def test_submit_and_admin_list_contracts_match_frontend_assumptions(self):
        app = self.create_app()
        ids = self.seed_fixture(app)

        with app.test_client() as client:
            self.login(client, 'student@example.com', 'StudentPass123!')
            task_payload = client.post(f"/api/tasks/{ids['task_id']}/submit", json={'answer': 'ok'}).get_json()
            quiz_payload = client.post(f"/api/quizzes/{ids['quiz_id']}/submit", json={'answers': {'q1': 0}}).get_json()

        assert_has_keys(self, task_payload, {'passed', 'score', 'xp_awarded', 'feedback', 'judge_report', 'requires_teacher_review', 'progress', 'user'}, '/api/tasks/<id>/submit')
        assert_has_keys(self, quiz_payload, {'passed', 'score', 'correct_answers', 'total_questions', 'xp_awarded', 'progress', 'user', 'review_questions'}, '/api/quizzes/<id>/submit')

        with app.test_client() as client:
            self.login(client, 'admin@example.com', 'AdminPass123!')
            users_payload = client.get('/api/admin/users').get_json()

        assert_has_keys(self, users_payload, {'users', 'pagination', 'filters'}, '/api/admin/users')
        assert_has_keys(self, users_payload['pagination'], {'page', 'page_size', 'total', 'total_pages'}, '/api/admin/users.pagination')

    def test_leaderboard_supports_class_scope_and_global_cache(self):
        app = self.create_app()
        ids = self.seed_fixture(app)

        with app.app_context():
            from app.core.db import db
            from app.core.security import hash_password
            from app.models.learning import ClassMembership
            from app.models.user import User, UserRole

            student = User.query.filter_by(username='student').first()
            self.assertIsNotNone(student)
            student.xp = 100

            classmate = User(
                full_name='Classmate Example',
                username='classmate',
                email='classmate@example.com',
                password_hash=hash_password('StudentPass123!'),
                role=UserRole.STUDENT,
                age_group='middle',
                xp=500,
            )
            outsider = User(
                full_name='Outsider Example',
                username='outsider',
                email='outsider@example.com',
                password_hash=hash_password('StudentPass123!'),
                role=UserRole.STUDENT,
                age_group='middle',
                xp=1000,
            )
            db.session.add_all([classmate, outsider])
            db.session.flush()
            db.session.add_all(
                [
                    ClassMembership(classroom_id=ids['classroom_id'], student_id=student.id),
                    ClassMembership(classroom_id=ids['classroom_id'], student_id=classmate.id),
                ]
            )
            db.session.commit()

        with app.test_client() as client:
            self.login(client, 'student@example.com', 'StudentPass123!')
            class_payload = client.get(
                f"/api/leaderboard?scope=class&classroom_id={ids['classroom_id']}"
            ).get_json()
            global_payload = client.get('/api/leaderboard').get_json()

            with app.app_context():
                from app.core.db import db
                from app.models.user import User

                User.query.filter_by(username='student').first().xp = 2000
                db.session.commit()

            cached_global_payload = client.get('/api/leaderboard').get_json()

        assert_has_keys(
            self,
            class_payload,
            {'leaderboard', 'me', 'classes', 'scope', 'classroom', 'refresh_seconds'},
            '/api/leaderboard?scope=class',
        )
        self.assertEqual(class_payload['scope'], 'class')
        self.assertEqual(class_payload['classroom']['id'], ids['classroom_id'])
        self.assertEqual([row['username'] for row in class_payload['leaderboard']], ['classmate', 'student'])
        self.assertEqual(global_payload['leaderboard'], cached_global_payload['leaderboard'])

    def test_teacher_detail_contract_matches_frontend_assumptions(self):
        app = self.create_app()
        ids = self.seed_fixture(app)

        with app.test_client() as client:
            self.login(client, 'teacher@example.com', 'TeacherPass123!')
            payload = client.get(f"/api/teacher/classes/{ids['classroom_id']}").get_json()

        assert_has_keys(self, payload, {'classroom', 'students', 'assignments'}, '/api/teacher/classes/<id>')
        assert_has_keys(self, payload['classroom'], {'id', 'name', 'description', 'code', 'teacher_id', 'students_count', 'assignments_count'}, 'teacher.classroom')


if __name__ == '__main__':
    unittest.main()
