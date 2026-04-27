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


class SecurityRegressionTests(unittest.TestCase):
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
            'GIGACHAT_VERIFY_SSL': 'true',
            'CODE_JUDGE_RUNNER_URL': '',
            'CODE_JUDGE_RUNNER_TOKEN': '',
            'METRICS_DEBUG': 'false',
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
                from app import models  # noqa: F401
                from app.core.db import db
                from app.core.runtime_schema import ensure_runtime_schema
                from app.seed.bootstrap import seed_all

                db.create_all()
                ensure_runtime_schema()
                seed_all(enable_demo_data=False)
            self._apps.append(app)
            return app

    def create_user(self, app, *, email='student@example.com', password='StrongPass123!', age_group='middle'):
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.user import User, UserRole

        with app.app_context():
            user = User(
                full_name='Test Student',
                username=email.split('@')[0],
                email=email,
                password_hash=hash_password(password),
                role=UserRole.STUDENT,
                age_group=age_group,
            )
            db.session.add(user)
            db.session.commit()
            return user.id

    def login(self, client, email='student@example.com', password='StrongPass123!'):
        return client.post('/api/auth/login', json={'login': email, 'password': password})

    def test_login_uses_httponly_cookies_and_hides_tokens(self):
        app = self.create_app()
        self.create_user(app)

        with app.test_client() as client:
            response = self.login(client)
            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            self.assertNotIn('access_token', payload)
            self.assertNotIn('refresh_token', payload)
            cookies = response.headers.getlist('Set-Cookie')
            access_cookie = next(cookie for cookie in cookies if 'codequest_access_token=' in cookie)
            refresh_cookie = next(cookie for cookie in cookies if 'codequest_refresh_token=' in cookie)
            expires_cookie = next(cookie for cookie in cookies if 'codequest_access_expires_at=' in cookie)
            self.assertIn('HttpOnly;', access_cookie)
            self.assertIn('HttpOnly;', refresh_cookie)
            self.assertNotIn('HttpOnly;', expires_cookie)
            self.assertTrue(all('SameSite=Lax' in cookie for cookie in cookies))

            me_response = client.get('/api/auth/me')
            self.assertEqual(me_response.status_code, 200)
            self.assertEqual(me_response.get_json()['user']['email'], 'student@example.com')

    def test_lesson_payload_hides_quiz_answers_and_private_validation(self):
        app = self.create_app()
        from app.models.learning import Lesson

        with app.app_context():
            lesson = Lesson.query.filter(Lesson.quizzes.any()).first()
            self.assertIsNotNone(lesson)
            age_group = lesson.module.age_group if lesson else 'middle'

        self.create_user(app, age_group=age_group)

        with app.test_client() as client:
            self.login(client)
            response = client.get(f'/api/lessons/{lesson.id}')
            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            for quiz in payload['lesson']['quizzes']:
                for question in quiz['questions']:
                    self.assertNotIn('correct', question)
            for task in payload['lesson']['tasks']:
                self.assertNotIn('tests', task.get('validation', {}))
                self.assertNotIn('missing_keywords', task.get('validation', {}))

    def test_login_rate_limit_blocks_repeated_failures(self):
        app = self.create_app(
            LOGIN_RATE_LIMIT_MAX_FAILURES='2',
            LOGIN_RATE_LIMIT_BLOCK_SECONDS='60',
            LOGIN_RATE_LIMIT_WINDOW_SECONDS='300',
        )
        self.create_user(app)

        with app.test_client() as client:
            first = client.post('/api/auth/login', json={'login': 'student@example.com', 'password': 'wrong'})
            second = client.post('/api/auth/login', json={'login': 'student@example.com', 'password': 'wrong'})
            third = client.post('/api/auth/login', json={'login': 'student@example.com', 'password': 'wrong'})
            self.assertEqual(first.status_code, 401)
            self.assertEqual(second.status_code, 401)
            self.assertEqual(third.status_code, 429)

    def test_parent_link_redeem_is_rate_limited(self):
        app = self.create_app(
            PARENT_LINK_REDEEM_MAX_FAILURES='2',
            PARENT_LINK_REDEEM_BLOCK_SECONDS='60',
            PARENT_LINK_REDEEM_WINDOW_SECONDS='300',
        )
        self.create_user(app)
        with app.app_context():
            from app.core.db import db
            from app.core.security import hash_password
            from app.models.user import User, UserRole

            parent = User(
                full_name='Parent',
                username='par1',
                email='par1@example.com',
                phone='+79990001122',
                password_hash=hash_password('ParentPass123!'),
                role=UserRole.PARENT,
            )
            db.session.add(parent)
            db.session.commit()
        with app.test_client() as client:
            client.post(
                '/api/auth/login', json={'login': 'par1@example.com', 'password': 'ParentPass123!'}
            )
            first = client.post(
                '/api/parent/children/link', json={'code': 'INVALIDINVAL'}
            )
            second = client.post(
                '/api/parent/children/link', json={'code': 'INVALIDINVAL'}
            )
            third = client.post(
                '/api/parent/children/link', json={'code': 'INVALIDINVAL'}
            )
            self.assertIn(first.status_code, (400, 404))
            self.assertIn(second.status_code, (400, 404))
            self.assertEqual(third.status_code, 429)

    def test_lesson_open_does_not_persist_progress_row(self):
        app = self.create_app()
        from app.models.learning import Lesson, UserProgress

        with app.app_context():
            lesson = Lesson.query.filter(Lesson.quizzes.any()).first()
            self.assertIsNotNone(lesson)
            age_group = lesson.module.age_group

        user_id = self.create_user(app, age_group=age_group)

        with app.test_client() as client:
            self.login(client)
            response = client.get(f'/api/lessons/{lesson.id}')
            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            self.assertEqual(payload['progress']['status'], 'not_started')

        with app.app_context():
            progress = UserProgress.query.filter_by(user_id=user_id, lesson_id=lesson.id).first()
            self.assertIsNone(progress)

    def test_password_change_revokes_existing_refresh_tokens(self):
        app = self.create_app()
        user_id = self.create_user(app)

        from app.models.user import RefreshToken

        with app.test_client() as client:
            login_response = self.login(client)
            self.assertEqual(login_response.status_code, 200)

            with app.app_context():
                self.assertGreater(RefreshToken.query.filter_by(user_id=user_id).count(), 0)

            patch_response = client.patch('/api/users/me', json={'password': 'NewStrongPass123!'})
            self.assertEqual(patch_response.status_code, 200)

            with app.app_context():
                self.assertEqual(RefreshToken.query.filter_by(user_id=user_id).count(), 0)

            refresh_response = client.post('/api/auth/refresh')
            self.assertEqual(refresh_response.status_code, 401)

    def test_cross_origin_unsafe_request_is_rejected(self):
        app = self.create_app()
        self.create_user(app)

        with app.test_client() as client:
            response = client.post(
                '/api/auth/login',
                json={'login': 'student@example.com', 'password': 'StrongPass123!'},
                headers={'Origin': 'https://evil.example'},
            )
            self.assertEqual(response.status_code, 403)

    def test_register_rejects_invalid_phone(self):
        app = self.create_app()
        with app.test_client() as client:
            response = client.post(
                '/api/auth/register',
                json={
                    'email': 'reg1@example.com',
                    'username': 'st_rg1',
                    'password': 'StrongPass123!',
                    'phone': '123',
                    'role': 'student',
                    'age_group': 'middle',
                },
            )
            self.assertEqual(response.status_code, 400)
            self.assertIn('телефон', response.get_json().get('message', '').lower())

    def test_register_succeeds_with_russian_phone(self):
        app = self.create_app()
        with app.test_client() as client:
            response = client.post(
                '/api/auth/register',
                json={
                    'email': 'reg2@example.com',
                    'username': 'st_rg2',
                    'password': 'StrongPass123!',
                    'phone': '+7 (912) 345-67-89',
                    'role': 'student',
                    'age_group': 'middle',
                },
            )
            self.assertEqual(response.status_code, 201, response.get_json())
            self.assertEqual(response.get_json()['user']['phone'], '79123456789')

    def test_register_rejects_missing_phone(self):
        app = self.create_app()
        with app.test_client() as client:
            response = client.post(
                '/api/auth/register',
                json={
                    'email': 'reg3@example.com',
                    'username': 'st_rg3',
                    'password': 'StrongPass123!',
                    'role': 'student',
                    'age_group': 'middle',
                },
            )
            self.assertEqual(response.status_code, 400)
            self.assertIn('телефон', response.get_json().get('message', '').lower())

    def test_production_bootstrap_requires_explicit_secure_superadmin(self):
        with self.assertRaises(RuntimeError):
            self.create_app(
                APP_ENV='production',
                SESSION_COOKIE_SECURE='true',
                SUPERADMIN_BOOTSTRAP='true',
                SUPERADMIN_EMAIL='',
                SUPERADMIN_PASSWORD='',
                GIGACHAT_VERIFY_SSL='true',
                **_PROD_REDIS_ENV,
            )

    def test_production_forces_local_fallback_off_and_sets_security_headers(self):
        app = self.create_app(
            APP_ENV='production',
            SESSION_COOKIE_SECURE='true',
            SUPERADMIN_BOOTSTRAP='false',
            GIGACHAT_VERIFY_SSL='true',
            CODE_JUDGE_ALLOW_LOCAL_FALLBACK='true',
            **_PROD_REDIS_ENV,
        )
        self.assertFalse(app.config['CODE_JUDGE_ALLOW_LOCAL_FALLBACK'])

        with app.test_client() as client:
            response = client.get('/api/health')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers.get('X-Content-Type-Options'), 'nosniff')
            self.assertEqual(response.headers.get('X-Frame-Options'), 'DENY')
            self.assertEqual(response.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin')
            self.assertIn("default-src 'none'", response.headers.get('Content-Security-Policy', ''))


if __name__ == '__main__':
    unittest.main()
