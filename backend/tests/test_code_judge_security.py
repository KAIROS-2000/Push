from __future__ import annotations

import asyncio
import importlib
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

_PROD_REDIS_ENV = {
    'REDIS_URL': 'redis://127.0.0.1:6379/0',
    'REDIS_PASSWORD': 'UnitTestRedisPassword0123456789ABC!',
}


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
            'SESSION_COOKIE_SAMESITE': 'Strict',
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
                **_PROD_REDIS_ENV,
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
                        **_PROD_REDIS_ENV,
                    )

    def test_production_runner_rejects_short_tokens(self):
        with self.assertRaisesRegex(RuntimeError, 'CODE_JUDGE_RUNNER_TOKEN'):
            self.create_app(
                APP_ENV='production',
                SESSION_COOKIE_SECURE='true',
                CLIENT_URL='https://frontend.example',
                CODE_JUDGE_RUNNER_URL='http://judge-runner:8090/execute',
                CODE_JUDGE_RUNNER_TOKEN='x' * 23,
                **_PROD_REDIS_ENV,
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
            **_PROD_REDIS_ENV,
        )
        self.assertTrue(app.config['IS_PRODUCTION'])

    def test_stdio_judge_requires_isolated_runner_even_if_local_fallback_requested(self):
        app = self.create_app(
            CODE_JUDGE_RUNNER_URL='',
            CODE_JUDGE_ALLOW_LOCAL_FALLBACK='true',
        )

        class TaskStub:
            lesson = object()

            def normalized_validation(self, include_private=False):  # noqa: ANN001, ARG002
                return {
                    'evaluation_mode': 'stdin_stdout',
                    'language': 'python',
                    'tests': [{'label': 'echo', 'input': 'x', 'expected': 'x'}],
                    'keywords': [],
                    'time_limit_ms': 500,
                    'memory_limit_mb': 64,
                }

        with app.app_context():
            from app.core.code_judge import CodeJudgeUnavailableError, judge_task_submission

            with self.assertRaisesRegex(CodeJudgeUnavailableError, 'runner'):
                judge_task_submission(TaskStub(), 'print(input())')

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

    def test_shared_engine_executes_stdio_tests_concurrently_with_isolated_workdirs(self):
        from shared.judge import JudgeExecutionRequest, JudgeTestCase, async_execute_stdio_submission

        class PythonRuntime:
            def command_for(self, language: str, script_path: str, memory_limit_mb: int) -> list[str]:  # noqa: ARG002
                return [sys.executable, '-I', script_path]

            def build_env(self) -> dict[str, str]:
                return {'PATH': os.environ.get('PATH', ''), 'PYTHONIOENCODING': 'utf-8'}

            def preexec_fn(self, memory_limit_mb: int, time_limit_ms: int, language: str):  # noqa: ARG002
                return None

        code = (
            'from pathlib import Path\n'
            'import sys\n'
            'import time\n'
            'value = sys.stdin.read().strip()\n'
            'Path("case.txt").write_text(value, encoding="utf-8")\n'
            'time.sleep(0.5)\n'
            'print(Path("case.txt").read_text(encoding="utf-8"))\n'
        )
        started_at = time.perf_counter()
        report = asyncio.run(
            async_execute_stdio_submission(
                JudgeExecutionRequest(
                    language='python',
                    code=code,
                    tests=[
                        JudgeTestCase(label='case-a', input='a', expected='a'),
                        JudgeTestCase(label='case-b', input='b', expected='b'),
                        JudgeTestCase(label='case-c', input='c', expected='c'),
                        JudgeTestCase(label='case-d', input='d', expected='d'),
                    ],
                    time_limit_ms=2500,
                    memory_limit_mb=64,
                    max_output_chars=256,
                    max_parallel_tests=4,
                ),
                PythonRuntime(),
            )
        )
        duration_seconds = time.perf_counter() - started_at

        self.assertTrue(report['passed'])
        self.assertLess(duration_seconds, 1.7)

    def test_runner_uses_configured_async_test_concurrency(self):
        with patch.dict(
            os.environ,
            {
                'JUDGE_RUNNER_MAX_TEST_CONCURRENCY': '3',
                'JUDGE_RUNNER_ALLOW_UNAUTHENTICATED': 'true',
            },
            clear=False,
        ):
            import judge_runner.app as runner_app

            importlib.reload(runner_app)

        captured = {}

        async def fake_execute(request, runtime):  # noqa: ANN001, ARG001
            captured['max_parallel_tests'] = request.max_parallel_tests
            return {
                'mode': 'stdin_stdout',
                'runner': 'stdin_stdout',
                'language': request.language,
                'passed': True,
                'score': 100,
                'feedback': 'ok',
                'tests_passed': 1,
                'tests_total': 1,
                'results': [],
                'compile_error': None,
                'runtime_error': None,
                'time_limit_ms': request.time_limit_ms,
                'memory_limit_mb': request.memory_limit_mb,
            }

        with patch.object(runner_app, 'async_execute_stdio_submission', side_effect=fake_execute):
            runner_app.execute_submission_payload(
                {
                    'language': 'python',
                    'code': 'print(input())',
                    'tests': [{'label': 'echo', 'input': 'x', 'expected': 'x'}],
                }
            )

        self.assertEqual(captured['max_parallel_tests'], 3)


if __name__ == '__main__':
    unittest.main()
