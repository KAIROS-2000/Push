from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


class CodeJudgeSecurityTests(unittest.TestCase):
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
            'CODE_JUDGE_RUNNER_URL': 'http://judge-runner:8090/execute',
            'CODE_JUDGE_RUNNER_TOKEN': 'unit-test-runner-token',
            'CODE_JUDGE_ALLOW_LOCAL_FALLBACK': 'false',
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

                db.create_all()
            self._apps.append(app)
            return app

    def test_backend_sends_runner_bearer_token(self):
        app = self.create_app()

        with app.app_context():
            from app.core.code_judge import _runner_headers

            headers = _runner_headers()

        self.assertEqual(headers['Content-Type'], 'application/json')
        self.assertEqual(headers['Authorization'], 'Bearer unit-test-runner-token')

    def test_production_runner_requires_strong_token(self):
        with self.assertRaisesRegex(RuntimeError, 'CODE_JUDGE_RUNNER_TOKEN'):
            self.create_app(
                APP_ENV='production',
                SESSION_COOKIE_SECURE='true',
                CLIENT_URL='https://frontend.example',
                CODE_JUDGE_RUNNER_URL='http://judge-runner:8090/execute',
                CODE_JUDGE_RUNNER_TOKEN='',
            )

    def test_production_runner_rejects_common_placeholder_tokens(self):
        for placeholder_token in (
            'local-dev-judge-token-change-me',
            'replace-with-random-judge-runner-token',
        ):
            with self.subTest(token=placeholder_token):
                with self.assertRaisesRegex(RuntimeError, 'CODE_JUDGE_RUNNER_TOKEN'):
                    self.create_app(
                        APP_ENV='production',
                        SESSION_COOKIE_SECURE='true',
                        CLIENT_URL='https://frontend.example',
                        CODE_JUDGE_RUNNER_URL='http://judge-runner:8090/execute',
                        CODE_JUDGE_RUNNER_TOKEN=placeholder_token,
                    )

    def test_production_runner_rejects_short_tokens(self):
        with self.assertRaisesRegex(RuntimeError, 'CODE_JUDGE_RUNNER_TOKEN'):
            self.create_app(
                APP_ENV='production',
                SESSION_COOKIE_SECURE='true',
                CLIENT_URL='https://frontend.example',
                CODE_JUDGE_RUNNER_URL='http://judge-runner:8090/execute',
                CODE_JUDGE_RUNNER_TOKEN='x' * 23,
            )

    def test_production_runner_accepts_strong_token(self):
        app = self.create_app(
            APP_ENV='production',
            SESSION_COOKIE_SECURE='true',
            CLIENT_URL='https://frontend.example',
            CODE_JUDGE_RUNNER_URL='http://judge-runner:8090/execute',
            CODE_JUDGE_RUNNER_TOKEN='r' * 32,
            SUPERADMIN_BOOTSTRAP='false',
            GIGACHAT_VERIFY_SSL='true',
        )
        self.assertTrue(app.config['IS_PRODUCTION'])

    def test_runner_rejects_missing_or_wrong_token(self):
        with patch.dict(
            os.environ,
            {
                'JUDGE_RUNNER_AUTH_TOKEN': 'expected-token',
                'JUDGE_RUNNER_ALLOW_UNAUTHENTICATED': 'false',
            },
            clear=False,
        ):
            import judge_runner.app as runner_app

            importlib.reload(runner_app)

        class Headers(dict):
            def get(self, key, default=None):  # noqa: ANN001
                return super().get(key, default)

        self.assertFalse(runner_app.request_authorized(Headers()))
        self.assertFalse(runner_app.request_authorized(Headers({'Authorization': 'Bearer wrong-token'})))
        self.assertTrue(runner_app.request_authorized(Headers({'Authorization': 'Bearer expected-token'})))

    def test_shared_engine_enforces_timeout(self):
        from shared.judge import JudgeExecutionRequest, JudgeTestCase, execute_stdio_submission

        class PythonRuntime:
            def command_for(self, language: str, script_path: str, memory_limit_mb: int) -> list[str]:  # noqa: ARG002
                return [sys.executable, '-I', script_path]

            def build_env(self) -> dict[str, str]:
                return {'PATH': os.environ.get('PATH', ''), 'PYTHONIOENCODING': 'utf-8'}

            def preexec_fn(self, memory_limit_mb: int, time_limit_ms: int, language: str):  # noqa: ARG002
                return None

        report = execute_stdio_submission(
            JudgeExecutionRequest(
                language='python',
                code='while True:\n    pass\n',
                tests=[JudgeTestCase(label='timeout', input='', expected='')],
                time_limit_ms=500,
                memory_limit_mb=64,
                max_output_chars=256,
            ),
            PythonRuntime(),
        )

        self.assertFalse(report['passed'])
        self.assertEqual(report['results'][0]['error_type'], 'timeout')


if __name__ == '__main__':
    unittest.main()
