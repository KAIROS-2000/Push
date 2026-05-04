"""Regression tests for P0 security fixes.

Each test pins a specific anti-cheat / authorization invariant introduced when
closing the audit's CRITICAL findings (C-01..C-07, S-06, S-11, S-13, S-18).
"""
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


_PROD_REDIS_ENV = {
    'REDIS_URL': 'redis://127.0.0.1:6379/0',
    'REDIS_PASSWORD': 'UnitTestRedisPassword0123456789ABC!',
}


class P0FixesBase(unittest.TestCase):
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

    def create_app(self, **env_overrides):
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
            'SESSION_COOKIE_SAMESITE': 'Strict',
            'GIGACHAT_VERIFY_SSL': 'true',
            'CODE_JUDGE_RUNNER_URL': '',
            'CODE_JUDGE_RUNNER_TOKEN': '',
            'METRICS_DEBUG': 'false',
            'TRUST_PROXY': 'false',
        }
        env.update(env_overrides)

        with patch.dict(os.environ, env, clear=False):
            import app.core.config as config_module
            import app as app_module

            importlib.reload(config_module)
            importlib.reload(app_module)

            app = app_module.create_app()
            app.config.update(TESTING=True)
            with app.app_context():
                from app.core.db import db
                from app.core.runtime_schema import ensure_runtime_schema

                db.create_all()
                ensure_runtime_schema()
            self._apps.append(app)
            return app

    # ---- fixture builders ---------------------------------------------------

    def _make_module_with_lesson(
        self,
        app,
        *,
        slug_suffix: str,
        with_task: bool = False,
        with_quiz: bool = False,
        passing_score: int = 70,
    ):
        """Builds an isolated module + first lesson so tests are not affected by seed ordering."""
        from app.core.db import db
        from app.models.learning import Lesson, Module, Quiz, Task

        with app.app_context():
            module = Module(
                slug=f'p0-fix-mod-{slug_suffix}',
                title=f'P0 Fix Module {slug_suffix}',
                description='isolated test fixture',
                age_group='middle',
                icon='code',
                color='#4A90D9',
                order_index=900 + (hash(slug_suffix) & 0xff),
                is_published=True,
            )
            db.session.add(module)
            db.session.flush()
            lesson = Lesson(
                module_id=module.id,
                slug=f'p0-fix-lesson-{slug_suffix}',
                title='Test lesson',
                summary='isolated',
                order_index=1,
                passing_score=passing_score,
                theory_blocks=[],
                interactive_steps=[],
                is_published=True,
            )
            db.session.add(lesson)
            db.session.flush()
            task_id = None
            quiz_id = None
            if with_task:
                task = Task(
                    lesson_id=lesson.id,
                    task_type='text',
                    title='Practice',
                    prompt='Solve this',
                    starter_code='',
                    validation={
                        'evaluation_mode': 'manual',
                        'language': None,
                        'keywords': [],
                        'tests': [],
                    },
                    hints=[],
                    xp_reward=10,
                )
                db.session.add(task)
                db.session.flush()
                task_id = task.id
            if with_quiz:
                quiz = Quiz(
                    lesson_id=lesson.id,
                    title='Test quiz',
                    passing_score=passing_score,
                    questions=[
                        {
                            'id': 'q1',
                            'type': 'single',
                            'prompt': 'Pick',
                            'options': [{'id': 'a', 'text': 'A'}, {'id': 'b', 'text': 'B'}],
                            'correct': 'a',
                        }
                    ],
                    xp_reward=20,
                )
                db.session.add(quiz)
                db.session.flush()
                quiz_id = quiz.id
            db.session.commit()
            return {
                'module_id': module.id,
                'lesson_id': lesson.id,
                'task_id': task_id,
                'quiz_id': quiz_id,
            }

    def create_user(self, app, *, role, email, password='StrongPass123!', age_group='middle'):
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.user import User, UserRole

        # ADMIN/SUPERADMIN/PARENT do not have a learner age_group; flatten for those roles.
        if role in (UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.PARENT, UserRole.TEACHER):
            stored_age_group = None
        else:
            stored_age_group = age_group

        with app.app_context():
            user = User(
                full_name=f'{role.value.title()} User',
                email=email,
                password_hash=hash_password(password),
                role=role,
                age_group=stored_age_group,
            )
            db.session.add(user)
            db.session.commit()
            return user.id

    def create_student(self, app, *, email='student@example.com', password='StrongPass123!', age_group='middle'):
        from app.models.user import UserRole

        return self.create_user(app, role=UserRole.STUDENT, email=email, password=password, age_group=age_group)

    def login(self, client, email='student@example.com', password='StrongPass123!'):
        return client.post('/api/auth/login', json={'login': email, 'password': password})


# =====================================================================================
# C-01: anti-cheat for completion_percent
# =====================================================================================


class CompletionPercentAntiCheatTests(P0FixesBase):
    def test_complete_lesson_ignores_client_completion_percent_when_practice_not_solved(self):
        app = self.create_app()
        ids = self._make_module_with_lesson(app, slug_suffix='cheat', with_task=True)
        self.create_student(app)

        with app.test_client() as client:
            self.login(client)
            response = client.patch(
                f"/api/lessons/{ids['lesson_id']}/complete",
                json={'completion_percent': 100, 'answer': 'fake'},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        # progress.score is 0 because no submit_task happened — server must NOT trust the client value.
        self.assertEqual(payload['progress']['score'], 0)
        self.assertNotEqual(payload['progress']['status'], 'completed')

    def test_complete_lesson_for_theory_only_lesson_marks_completed(self):
        """Lessons with no tasks/quizzes legitimately complete on patch — there's nothing to fake."""
        app = self.create_app()
        ids = self._make_module_with_lesson(app, slug_suffix='theory', with_task=False, with_quiz=False)
        self.create_student(app)

        with app.test_client() as client:
            self.login(client)
            response = client.patch(f"/api/lessons/{ids['lesson_id']}/complete", json={})

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload['progress']['score'], 100)
        self.assertEqual(payload['progress']['status'], 'completed')


# =====================================================================================
# C-02: role-restricted endpoints (lesson flows vs student-only utilities)
# =====================================================================================


class RoleRestrictedSubmissionTests(P0FixesBase):
    def test_admin_submit_task_updates_progress_without_lesson_xp(self):
        """Staff may practice tasks; XP from lesson flows remains student-only."""
        app = self.create_app()
        from app.models.user import UserRole

        ids = self._make_module_with_lesson(app, slug_suffix='admsubmit', with_task=True)
        self.create_user(app, role=UserRole.ADMIN, email='admin@example.com')

        with app.test_client() as client:
            self.login(client, email='admin@example.com')
            response = client.post(
                f"/api/tasks/{ids['task_id']}/submit",
                json={'answer': 'whatever'},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload.get('xp_awarded'), 0)
        self.assertFalse(payload.get('xp_skipped'))
        self.assertIn('progress', payload)

    def test_teacher_submit_quiz_updates_progress_without_lesson_xp(self):
        app = self.create_app()
        from app.models.user import UserRole

        ids = self._make_module_with_lesson(app, slug_suffix='tchquiz', with_quiz=True)
        self.create_user(app, role=UserRole.TEACHER, email='teacher@example.com')

        with app.test_client() as client:
            self.login(client, email='teacher@example.com')
            response = client.post(
                f"/api/quizzes/{ids['quiz_id']}/submit",
                json={'answers': {'q1': 'a'}},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload.get('xp_awarded'), 0)
        self.assertFalse(payload.get('xp_skipped'))
        self.assertIn('progress', payload)

    def test_parent_can_complete_theory_lesson(self):
        app = self.create_app()
        from app.models.user import UserRole

        ids = self._make_module_with_lesson(app, slug_suffix='parent', with_task=False)
        self.create_user(app, role=UserRole.PARENT, email='parent@example.com')

        with app.test_client() as client:
            self.login(client, email='parent@example.com')
            response = client.patch(f"/api/lessons/{ids['lesson_id']}/complete", json={})

        self.assertEqual(response.status_code, 200)

    def test_parent_can_start_lesson(self):
        app = self.create_app()
        from app.models.user import UserRole

        ids = self._make_module_with_lesson(app, slug_suffix='parentstart', with_task=False)
        self.create_user(app, role=UserRole.PARENT, email='parent@example.com')

        with app.test_client() as client:
            self.login(client, email='parent@example.com')
            response = client.post(f"/api/lessons/{ids['lesson_id']}/start")

        self.assertEqual(response.status_code, 200)


# =====================================================================================
# C-03: password-change re-auth + session bump
# =====================================================================================


class PasswordChangeReauthTests(P0FixesBase):
    def test_password_change_requires_current_password(self):
        app = self.create_app()
        self.create_student(app)

        with app.test_client() as client:
            self.login(client)
            response = client.patch(
                '/api/users/me',
                json={'password': 'BrandNewStrongPass123!'},
            )

        self.assertEqual(response.status_code, 400)
        self.assertIn('текущий', response.get_json()['message'].lower())

    def test_password_change_rejects_wrong_current_password(self):
        app = self.create_app()
        self.create_student(app)

        with app.test_client() as client:
            self.login(client)
            response = client.patch(
                '/api/users/me',
                json={
                    'current_password': 'WrongOldPass123!',
                    'password': 'BrandNewStrongPass123!',
                },
            )

        self.assertEqual(response.status_code, 401)

    def test_password_change_invalidates_existing_access_cookie(self):
        """After successful password change, the access-cookie issued before change is rejected."""
        app = self.create_app()
        self.create_student(app)

        with app.test_client() as client:
            self.login(client)
            initial = client.get('/api/auth/me')
            self.assertEqual(initial.status_code, 200)

            change = client.patch(
                '/api/users/me',
                json={
                    'current_password': 'StrongPass123!',
                    'password': 'BrandNewStrongPass123!',
                },
            )
            self.assertEqual(change.status_code, 200)

            after = client.get('/api/auth/me')
            self.assertEqual(after.status_code, 401)
            self.assertEqual(after.get_json().get('code'), 'session_revoked')

    def test_password_change_rejects_same_password(self):
        app = self.create_app()
        self.create_student(app)

        with app.test_client() as client:
            self.login(client)
            response = client.patch(
                '/api/users/me',
                json={
                    'current_password': 'StrongPass123!',
                    'password': 'StrongPass123!',
                },
            )

        self.assertEqual(response.status_code, 400)


# =====================================================================================
# S-06: admin self-block / self-delete protection
# =====================================================================================


class AdminSelfBlockTests(P0FixesBase):
    def test_admin_cannot_block_self(self):
        app = self.create_app()
        from app.models.user import UserRole

        admin_id = self.create_user(app, role=UserRole.ADMIN, email='admin@example.com')

        with app.test_client() as client:
            self.login(client, email='admin@example.com')
            response = client.patch(f'/api/admin/users/{admin_id}/block')

        self.assertEqual(response.status_code, 400)

    def test_superadmin_cannot_delete_self(self):
        app = self.create_app()
        from app.models.user import UserRole

        super_id = self.create_user(app, role=UserRole.SUPERADMIN, email='super@example.com')

        with app.test_client() as client:
            self.login(client, email='super@example.com')
            response = client.delete(f'/api/admin/users/{super_id}')

        self.assertEqual(response.status_code, 400)


# =====================================================================================
# C-06: class-join brute-force throttle
# =====================================================================================


class ClassJoinThrottleTests(P0FixesBase):
    def test_repeated_invalid_codes_eventually_throttle(self):
        app = self.create_app(
            CLASS_JOIN_RATE_LIMIT_WINDOW_SECONDS='600',
            CLASS_JOIN_RATE_LIMIT_MAX_FAILURES='3',
            CLASS_JOIN_RATE_LIMIT_BLOCK_SECONDS='600',
        )
        self.create_student(app)

        statuses: list[int] = []
        with app.test_client() as client:
            self.login(client)
            for _ in range(6):
                statuses.append(client.post('/api/classes/join', json={'code': 'NOSUCH-CODE'}).status_code)

        self.assertIn(429, statuses, f'expected 429 in statuses, got {statuses}')


# =====================================================================================
# C-07: media-route extension whitelist
# =====================================================================================


class MediaWhitelistTests(P0FixesBase):
    def test_mascot_route_rejects_html_extension(self):
        app = self.create_app()
        with app.test_client() as client:
            response = client.get('/api/mascot/payload.html')

        self.assertEqual(response.status_code, 404)

    def test_avatars_route_rejects_svg_extension(self):
        """SVG is excluded from the whitelist — it can carry inline scripts."""
        app = self.create_app()
        with app.test_client() as client:
            response = client.get('/api/media/avatars/exploit.svg')

        self.assertEqual(response.status_code, 404)

    def test_avatars_route_rejects_no_extension(self):
        app = self.create_app()
        with app.test_client() as client:
            response = client.get('/api/media/avatars/no-extension')

        self.assertEqual(response.status_code, 404)


# =====================================================================================
# S-11: PostgreSQL placeholder rejection in production
# =====================================================================================


class PostgresPasswordPlaceholderRejectionTests(P0FixesBase):
    def test_production_rejects_postgres_password_with_dev_fragment(self):
        with self.assertRaisesRegex(RuntimeError, 'PostgreSQL password'):
            self.create_app(
                APP_ENV='production',
                SESSION_COOKIE_SECURE='true',
                CLIENT_URL='https://frontend.example',
                SECRET_KEY='a1' * 32,
                GIGACHAT_VERIFY_SSL='true',
                DATABASE_URL='postgresql+psycopg://codequest:DevPostgresLocalPassphrase000000001@db:5432/codequest',
                **_PROD_REDIS_ENV,
            )


if __name__ == '__main__':
    unittest.main()
