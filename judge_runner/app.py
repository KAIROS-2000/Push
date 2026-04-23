from __future__ import annotations

import json
import hmac
import math
import os
import shutil
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from shared.judge import JudgeExecutionRequest, coerce_test_cases, execute_stdio_submission


HOST = os.getenv('JUDGE_RUNNER_HOST', '0.0.0.0')
PORT = int(os.getenv('JUDGE_RUNNER_PORT', '8090'))
MAX_REQUEST_BYTES = int(os.getenv('JUDGE_RUNNER_MAX_REQUEST_BYTES', '1048576'))
DEFAULT_TIME_LIMIT_MS = int(os.getenv('JUDGE_RUNNER_DEFAULT_TIME_LIMIT_MS', '2000'))
DEFAULT_MEMORY_LIMIT_MB = int(os.getenv('JUDGE_RUNNER_DEFAULT_MEMORY_LIMIT_MB', '128'))
MAX_OUTPUT_CHARS = int(os.getenv('JUDGE_RUNNER_MAX_OUTPUT_CHARS', '4000'))
MAX_CONCURRENCY = max(1, int(os.getenv('JUDGE_RUNNER_MAX_CONCURRENCY', '4')))
PYTHON_BIN = os.getenv('JUDGE_RUNNER_PYTHON_BIN', 'python')
NODE_BIN = os.getenv('JUDGE_RUNNER_NODE_BIN', 'node')
AUTH_TOKEN = (os.getenv('JUDGE_RUNNER_AUTH_TOKEN') or '').strip()
ALLOW_UNAUTHENTICATED = (os.getenv('JUDGE_RUNNER_ALLOW_UNAUTHENTICATED') or '').strip().lower() in {'1', 'true', 'yes', 'on'}
SUPPORTED_LANGUAGES = {'python', 'javascript'}
RUNNER_SEMAPHORE = threading.BoundedSemaphore(MAX_CONCURRENCY)


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


def _bearer_token(value: str | None) -> str:
    header = (value or '').strip()
    if not header.lower().startswith('bearer '):
        return ''
    return header[7:].strip()


def request_authorized(headers) -> bool:
    if ALLOW_UNAUTHENTICATED:
        return True
    if not AUTH_TOKEN:
        return False
    return hmac.compare_digest(_bearer_token(headers.get('Authorization')), AUTH_TOKEN)


def _resolve_executable(executable: str) -> str:
    resolved = shutil.which(executable)
    if resolved:
        return resolved
    raise FileNotFoundError(f'На runner не найден рантайм "{executable}".')


def _build_env() -> dict[str, str]:
    allowed_keys = {'PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR'}
    env = {key: value for key, value in os.environ.items() if key in allowed_keys}
    env['PYTHONIOENCODING'] = 'utf-8'
    env['PYTHONDONTWRITEBYTECODE'] = '1'
    env['PYTHONNOUSERSITE'] = '1'
    env['NODE_NO_WARNINGS'] = '1'
    return env


def _preexec_resource_limits(memory_limit_mb: int, time_limit_ms: int, language: str) -> Callable[[], None] | None:
    if os.name != 'posix':
        return None
    try:
        import resource
    except ImportError:
        return None

    memory_limit_bytes = memory_limit_mb * 1024 * 1024
    cpu_seconds = max(1, math.ceil(time_limit_ms / 1000))

    def apply_limits() -> None:
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 1))
        # RLIMIT_AS is stable for Python, but Node/V8 can stall during bootstrap under it.
        if language == 'python' and hasattr(resource, 'RLIMIT_AS'):
            resource.setrlimit(resource.RLIMIT_AS, (memory_limit_bytes, memory_limit_bytes))
        if hasattr(resource, 'RLIMIT_CORE'):
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

    return apply_limits


class RunnerRuntime:
    def command_for(self, language: str, script_path: str, memory_limit_mb: int) -> list[str]:
        if language == 'python':
            return [_resolve_executable(PYTHON_BIN), '-I', script_path]
        heap_limit_mb = max(96, min(memory_limit_mb, 2048))
        return [_resolve_executable(NODE_BIN), f'--max-old-space-size={heap_limit_mb}', script_path]

    def build_env(self) -> dict[str, str]:
        return _build_env()

    def preexec_fn(self, memory_limit_mb: int, time_limit_ms: int, language: str) -> Callable[[], None] | None:
        return _preexec_resource_limits(memory_limit_mb, time_limit_ms, language)


def execute_submission_payload(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ValueError('Ожидается JSON-объект.')

    language = str(payload.get('language') or 'python').strip().lower()
    if language not in SUPPORTED_LANGUAGES:
        raise ValueError('Поддерживаются только Python и JavaScript.')

    code = str(payload.get('code') or '')
    if not code.strip():
        raise ValueError('Код не передан.')

    tests = coerce_test_cases(payload.get('tests'))
    if not tests:
        raise ValueError('Для запуска нужны тесты.')

    request = JudgeExecutionRequest(
        language=language,
        code=code,
        tests=tests,
        time_limit_ms=_safe_int(payload.get('time_limit_ms'), DEFAULT_TIME_LIMIT_MS, minimum=500, maximum=10000),
        memory_limit_mb=_safe_int(payload.get('memory_limit_mb'), DEFAULT_MEMORY_LIMIT_MB, minimum=32, maximum=1024),
        max_output_chars=_safe_int(payload.get('max_output_chars'), MAX_OUTPUT_CHARS, minimum=256, maximum=20000),
        tempdir_prefix='judge-',
    )
    return execute_stdio_submission(request, RunnerRuntime())


class Handler(BaseHTTPRequestHandler):
    server_version = 'CodeJudgeRunner/1.1'

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == '/health':
            self._send_json(HTTPStatus.OK, {'status': 'ok', 'max_concurrency': MAX_CONCURRENCY})
            return
        self._send_json(HTTPStatus.NOT_FOUND, {'message': 'Not found'})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != '/execute':
            self._send_json(HTTPStatus.NOT_FOUND, {'message': 'Not found'})
            return
        if not request_authorized(self.headers):
            self._send_json(HTTPStatus.FORBIDDEN, {'message': 'Runner authentication required.'})
            return

        content_length = _safe_int(self.headers.get('Content-Length'), 0, minimum=0)
        if content_length <= 0:
            self._send_json(HTTPStatus.BAD_REQUEST, {'message': 'Пустой запрос.'})
            return
        if content_length > MAX_REQUEST_BYTES:
            self._send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {'message': 'Слишком большой запрос.'})
            return

        raw_body = self.rfile.read(content_length)
        try:
            payload = json.loads(raw_body.decode('utf-8'))
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {'message': 'Некорректный JSON.'})
            return

        if not RUNNER_SEMAPHORE.acquire(blocking=False):
            self._send_json(
                HTTPStatus.TOO_MANY_REQUESTS,
                {'message': 'Runner перегружен. Повторите попытку через несколько секунд.'},
            )
            return

        started_at = time.perf_counter()
        language = str(payload.get('language') or 'python').strip().lower()
        tests_total = len(payload.get('tests') or []) if isinstance(payload.get('tests'), list) else 0
        try:
            report = execute_submission_payload(payload)
        except ValueError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {'message': str(exc)})
            return
        except FileNotFoundError as exc:
            self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {'message': str(exc)})
            return
        except Exception:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {'message': 'Runner не смог выполнить код.'})
            return
        finally:
            duration_ms = int((time.perf_counter() - started_at) * 1000)
            print(
                f'judge_execution language={language} tests_total={tests_total} duration_ms={duration_ms}',
                flush=True,
            )
            RUNNER_SEMAPHORE.release()

        self._send_json(HTTPStatus.OK, report)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


if __name__ == '__main__':
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(
        f'Judge runner listening on http://{HOST}:{PORT} (max_concurrency={MAX_CONCURRENCY})',
        flush=True,
    )
    server.serve_forever()
