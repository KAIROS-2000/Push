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


class CsrfProtectionTests(unittest.TestCase):
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
            'SESSION_COOKIE_SAMESITE': 'Strict',
            'GIGACHAT_VERIFY_SSL': 'true',
            'METRICS_DEBUG': 'false',
        }

        with patch.dict(os.environ, env, clear=False):
            import app.core.config as config_module
            import app as app_module

            importlib.reload(config_module)
            importlib.reload(app_module)

            app = app_module.create_app()
            app.config.update(TESTING=True, AUTO_TEST_CSRF_HEADER=False)
            with app.app_context():
                from app import models  # noqa: F401
                from app.core.db import db
                from app.core.runtime_schema import ensure_runtime_schema

                db.create_all()
                ensure_runtime_schema()
            self._apps.append(app)
            return app

    def create_user(self, app, *, email='student@example.com', password='StrongPass123!'):
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.user import User, UserRole

        with app.app_context():
            user = User(
                full_name='CSRF Student',
                username=email.split('@')[0],
                email=email,
                password_hash=hash_password(password),
                role=UserRole.STUDENT,
                age_group='middle',
            )
            db.session.add(user)
            db.session.commit()

    def login(self, client, email='student@example.com', password='StrongPass123!'):
        return client.post('/api/auth/login', json={'login': email, 'password': password})

    @staticmethod
    def csrf_token(client):
        csrf_cookie = client.get_cookie('csrf_token')
        return csrf_cookie.value if csrf_cookie else ''

    def test_post_without_csrf_header_after_login_is_rejected(self):
        app = self.create_app()
        self.create_user(app)

        with app.test_client() as client:
            login_response = self.login(client)
            self.assertEqual(login_response.status_code, 200)
            self.assertTrue(self.csrf_token(client))

            response = client.post('/api/auth/refresh')
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.get_json().get('code'), 'csrf_invalid')

    def test_post_with_wrong_csrf_header_after_login_is_rejected(self):
        app = self.create_app()
        self.create_user(app)

        with app.test_client() as client:
            login_response = self.login(client)
            self.assertEqual(login_response.status_code, 200)

            response = client.post('/api/auth/refresh', headers={'X-CSRF-Token': 'wrong-token'})
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.get_json().get('code'), 'csrf_invalid')

    def test_post_with_matching_csrf_cookie_and_header_is_allowed(self):
        app = self.create_app()
        self.create_user(app)

        with app.test_client() as client:
            login_response = self.login(client)
            self.assertEqual(login_response.status_code, 200)
            csrf_token = self.csrf_token(client)
            self.assertTrue(csrf_token)

            response = client.post('/api/auth/refresh', headers={'X-CSRF-Token': csrf_token})
            self.assertEqual(response.status_code, 200)
            self.assertIn('csrf_token=', ';'.join(response.headers.getlist('Set-Cookie')))

    def test_bearer_authenticated_unsafe_request_without_csrf_cookie_is_allowed(self):
        app = self.create_app()
        self.create_user(app)

        with app.test_client() as login_client:
            login_response = self.login(login_client)
            self.assertEqual(login_response.status_code, 200)
            access_cookie = login_client.get_cookie('codequest_access_token')
            self.assertIsNotNone(access_cookie)
            access_token = access_cookie.value

        with app.test_client() as bearer_client:
            response = bearer_client.patch(
                '/api/users/me',
                json={'theme': 'dark'},
                headers={'Authorization': f'Bearer {access_token}'},
            )
            self.assertEqual(response.status_code, 200)

    def test_get_requests_are_not_blocked_by_csrf_middleware(self):
        app = self.create_app()
        self.create_user(app)

        with app.test_client() as client:
            login_response = self.login(client)
            self.assertEqual(login_response.status_code, 200)

            response = client.get('/api/auth/me')
            self.assertEqual(response.status_code, 200)

    def test_options_preflight_is_not_blocked_by_csrf(self):
        """OPTIONS / HEAD must bypass CSRF so CORS preflights and health probes work."""
        app = self.create_app()
        self.create_user(app)

        with app.test_client() as client:
            login_response = self.login(client)
            self.assertEqual(login_response.status_code, 200)

            # OPTIONS preflight — Flask replies 200 with Allow-headers but
            # crucially the CSRF middleware must not return 403.
            response = client.options('/api/auth/refresh')
            self.assertNotEqual(response.status_code, 403)

    def test_logout_clears_csrf_cookie(self):
        app = self.create_app()
        self.create_user(app)

        with app.test_client() as client:
            login_response = self.login(client)
            self.assertEqual(login_response.status_code, 200)
            csrf_token = self.csrf_token(client)
            self.assertTrue(csrf_token)

            response = client.post('/api/auth/logout', headers={'X-CSRF-Token': csrf_token})
            self.assertEqual(response.status_code, 200)
            self.assertTrue(any('csrf_token=;' in cookie for cookie in response.headers.getlist('Set-Cookie')))
            self.assertIsNone(client.get_cookie('csrf_token'))

    def test_logout_without_csrf_header_is_rejected(self):
        app = self.create_app()
        self.create_user(app)

        with app.test_client() as client:
            login_response = self.login(client)
            self.assertEqual(login_response.status_code, 200)
            self.assertTrue(self.csrf_token(client))

            response = client.post('/api/auth/logout')
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.get_json().get('code'), 'csrf_invalid')
            self.assertIsNotNone(client.get_cookie('csrf_token'))


if __name__ == '__main__':
    unittest.main()
