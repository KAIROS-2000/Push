from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import request

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

_PROD_REDIS_ENV = {
    'REDIS_URL': 'redis://127.0.0.1:6379/0',
    'REDIS_PASSWORD': 'UnitTestRedisPassword0123456789ABC!',
}


class RuntimeConfigValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tempdirs: list[tempfile.TemporaryDirectory[str]] = []
        self._apps = []

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
            self._apps.append(app)
            return app

    def test_production_rejects_short_secret_key(self):
        with self.assertRaisesRegex(RuntimeError, 'SECRET_KEY'):
            self.create_app(
                APP_ENV='production',
                SESSION_COOKIE_SECURE='true',
                CLIENT_URL='https://frontend.example',
                SECRET_KEY='wemogw!325gzz',
                **_PROD_REDIS_ENV,
            )

    def test_production_accepts_strong_hex_secret_key(self):
        app = self.create_app(
            APP_ENV='production',
            SESSION_COOKIE_SECURE='true',
            CLIENT_URL='https://frontend.example',
            SECRET_KEY='a1' * 32,
            GIGACHAT_VERIFY_SSL='true',
            **_PROD_REDIS_ENV,
        )
        self.assertTrue(app.config['IS_PRODUCTION'])

    def test_production_rejects_lax_session_cookie_samesite(self):
        with self.assertRaisesRegex(RuntimeError, 'SESSION_COOKIE_SAMESITE'):
            self.create_app(
                APP_ENV='production',
                SESSION_COOKIE_SECURE='true',
                SESSION_COOKIE_SAMESITE='Lax',
                CLIENT_URL='https://frontend.example',
                SECRET_KEY='a1' * 32,
                GIGACHAT_VERIFY_SSL='true',
                **_PROD_REDIS_ENV,
            )

    def test_production_rejects_jwt_keyring_without_current_key(self):
        with self.assertRaisesRegex(RuntimeError, 'JWT_SIGNING_KEY_ID'):
            self.create_app(
                APP_ENV='production',
                SESSION_COOKIE_SECURE='true',
                CLIENT_URL='https://frontend.example',
                SECRET_KEY='a1' * 32,
                JWT_SIGNING_KEY_ID='current',
                JWT_SIGNING_KEYS='previous=' + ('b2' * 32),
                GIGACHAT_VERIFY_SSL='true',
                **_PROD_REDIS_ENV,
            )

    def test_production_accepts_jwt_keyring_rotation(self):
        app = self.create_app(
            APP_ENV='production',
            SESSION_COOKIE_SECURE='true',
            CLIENT_URL='https://frontend.example',
            SECRET_KEY='a1' * 32,
            JWT_SIGNING_KEY_ID='current',
            JWT_SIGNING_KEYS='current=' + ('c3' * 32) + ',previous=' + ('d4' * 32),
            GIGACHAT_VERIFY_SSL='true',
            **_PROD_REDIS_ENV,
        )
        self.assertTrue(app.config['IS_PRODUCTION'])

    def test_production_rejects_placeholder_secret_key(self):
        with self.assertRaisesRegex(RuntimeError, 'SECRET_KEY'):
            self.create_app(
                APP_ENV='production',
                SESSION_COOKIE_SECURE='true',
                CLIENT_URL='https://frontend.example',
                SECRET_KEY='totally-random-change-me-key-material-1234567890',
                **_PROD_REDIS_ENV,
            )

    def test_production_rejects_long_but_low_entropy_secret_key(self):
        """A 35-char key of only lowercase letters must fail the entropy heuristic."""
        with self.assertRaisesRegex(RuntimeError, 'SECRET_KEY'):
            self.create_app(
                APP_ENV='production',
                SESSION_COOKIE_SECURE='true',
                CLIENT_URL='https://frontend.example',
                SECRET_KEY='abcdefghijklmnopqrstuvwxyzabcdefghi',
                **_PROD_REDIS_ENV,
            )

    def test_production_rejects_same_char_secret_key(self):
        with self.assertRaisesRegex(RuntimeError, 'SECRET_KEY'):
            self.create_app(
                APP_ENV='production',
                SESSION_COOKIE_SECURE='true',
                CLIENT_URL='https://frontend.example',
                SECRET_KEY='a' * 64,
                **_PROD_REDIS_ENV,
            )

    def test_development_allows_weak_secret_key_for_local_ergonomics(self):
        app = self.create_app(
            APP_ENV='development',
            SECRET_KEY='short-and-weak',
        )
        self.assertFalse(app.config['IS_PRODUCTION'])

    def test_production_rejects_disabled_gigachat_ssl_verification(self):
        with self.assertRaisesRegex(RuntimeError, 'GIGACHAT_VERIFY_SSL'):
            self.create_app(
                APP_ENV='production',
                SESSION_COOKIE_SECURE='true',
                CLIENT_URL='https://frontend.example',
                SECRET_KEY='Abcdef1234567890!Abcdef1234567890!Abcdef',
                GIGACHAT_VERIFY_SSL='false',
                **_PROD_REDIS_ENV,
            )

    def test_production_requires_redis_url(self):
        with self.assertRaisesRegex(RuntimeError, 'REDIS_URL'):
            self.create_app(
                APP_ENV='production',
                SESSION_COOKIE_SECURE='true',
                CLIENT_URL='https://frontend.example',
                SECRET_KEY='a1' * 32,
                GIGACHAT_VERIFY_SSL='true',
                REDIS_URL='',
                REDIS_PASSWORD='UnitTestRedisPassword0123456789ABC!',
            )

    def test_production_requires_redis_password_strength(self):
        with self.assertRaisesRegex(RuntimeError, 'Redis password'):
            self.create_app(
                APP_ENV='production',
                SESSION_COOKIE_SECURE='true',
                CLIENT_URL='https://frontend.example',
                SECRET_KEY='a1' * 32,
                GIGACHAT_VERIFY_SSL='true',
                REDIS_URL='redis://127.0.0.1:6379/0',
                REDIS_PASSWORD='short',
            )

    def test_production_rejects_placeholder_redis_url(self):
        with self.assertRaisesRegex(RuntimeError, 'REDIS_URL'):
            self.create_app(
                APP_ENV='production',
                SESSION_COOKIE_SECURE='true',
                CLIENT_URL='https://frontend.example',
                SECRET_KEY='a1' * 32,
                GIGACHAT_VERIFY_SSL='true',
                REDIS_URL='redis://placeholder-host:6379/0',
                REDIS_PASSWORD='UnitTestRedisPassword0123456789ABC!',
            )

    def test_production_rejects_rediss_url(self):
        with self.assertRaisesRegex(RuntimeError, 'redis://'):
            self.create_app(
                APP_ENV='production',
                SESSION_COOKIE_SECURE='true',
                CLIENT_URL='https://frontend.example',
                SECRET_KEY='a1' * 32,
                GIGACHAT_VERIFY_SSL='true',
                REDIS_URL='rediss://127.0.0.1:6379/0',
                REDIS_PASSWORD='UnitTestRedisPassword0123456789ABC!',
            )

    def test_production_rejects_placeholder_redis_password(self):
        with self.assertRaisesRegex(RuntimeError, 'Redis password'):
            self.create_app(
                APP_ENV='production',
                SESSION_COOKIE_SECURE='true',
                CLIENT_URL='https://frontend.example',
                SECRET_KEY='a1' * 32,
                GIGACHAT_VERIFY_SSL='true',
                REDIS_URL='redis://127.0.0.1:6379/0',
                REDIS_PASSWORD='prefix-change-me-suffix-123456789012',
            )

    def test_trust_proxy_applies_forwarded_for_and_proto(self):
        app = self.create_app(TRUST_PROXY='true')

        @app.get('/_test/request-meta')
        def request_meta():
            return {
                'remote_addr': request.remote_addr,
                'scheme': request.scheme,
            }

        with app.test_client() as client:
            response = client.get(
                '/_test/request-meta',
                headers={
                    'X-Forwarded-For': '203.0.113.10',
                    'X-Forwarded-Proto': 'https',
                    'X-Forwarded-Host': 'api.example.com',
                },
            )
            self.assertEqual(response.status_code, 200)
            payload = response.get_json()
            self.assertEqual(payload['remote_addr'], '203.0.113.10')
            self.assertEqual(payload['scheme'], 'https')


if __name__ == '__main__':
    unittest.main()
