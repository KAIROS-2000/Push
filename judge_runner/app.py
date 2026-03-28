from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import tempfile
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable


HOST = os.getenv('JUDGE_RUNNER_HOST', '0.0.0.0')
PORT = int(os.getenv('JUDGE_RUNNER_PORT', '8090'))
MAX_REQUEST_BYTES = int(os.getenv('JUDGE_RUNNER_MAX_REQUEST_BYTES', '1048576'))
DEFAULT_TIME_LIMIT_MS = int(os.getenv('JUDGE_RUNNER_DEFAULT_TIME_LIMIT_MS', '2000'))
DEFAULT_MEMORY_LIMIT_MB = int(os.getenv('JUDGE_RUNNER_DEFAULT_MEMORY_LIMIT_MB', '128'))
MAX_OUTPUT_CHARS = int(os.getenv('JUDGE_RUNNER_MAX_OUTPUT_CHARS', '4000'))
PYTHON_BIN = os.getenv('JUDGE_RUNNER_PYTHON_BIN', 'python')
NODE_BIN = os.getenv('JUDGE_RUNNER_NODE_BIN', 'node')
SUPPORTED_LANGUAGES = {'python', 'javascript'}


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


def _normalize_output(value: str | None) -> str:
    normalized = (value or '').replace('\r\n', '\n').replace('\r', '\n')
    lines = [line.rstrip() for line in normalized.split('\n')]
    while lines and lines[-1] == '':
        lines.pop()
    return '\n'.join(lines)


def _truncate(value: str | None, limit: int) -> str:
    text = (value or '').replace('\r\n', '\n').replace('\r', '\n')
    if len(text) <= limit:
        return text
    return f'{text[:limit].rstrip()}\n...'


def _looks_like_compile_error(stderr: str) -> bool:
    lowered = stderr.lower()
    return 'syntaxerror' in lowered or 'unexpected token' in lowered


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


def _normalized_tests(value) -> list[dict]:
    if not isinstance(value, list):
        return []
    rows: list[dict] = []
    for index, item in enumerate(value, start=1):
        if not isinstance(item, dict):
            continue
        label = str(item.get('label') or f'Тест {index}').strip() or f'Тест {index}'
        test_input = str(item.get('input') or '')
        expected = str(item.get('expected') or '')
        if not test_input and not expected:
            continue
        rows.append({'label': label, 'input': test_input, 'expected': expected})
    return rows


def _command_for(language: str, script_path: str, memory_limit_mb: int) -> list[str]:
    if language == 'python':
        return [_resolve_executable(PYTHON_BIN), '-I', script_path]
    heap_limit_mb = max(96, min(memory_limit_mb, 2048))
    return [_resolve_executable(NODE_BIN), f'--max-old-space-size={heap_limit_mb}', script_path]


def _run_test(
    *,
    command: list[str],
    workdir: str,
    test_input: str,
    expected: str,
    label: str,
    time_limit_ms: int,
    memory_limit_mb: int,
    max_output_chars: int,
    language: str,
) -> dict:
    started_at = time.perf_counter()
    try:
        completed = subprocess.run(
            command,
            cwd=workdir,
            input=test_input,
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            timeout=time_limit_ms / 1000,
            env=_build_env(),
            preexec_fn=_preexec_resource_limits(memory_limit_mb, time_limit_ms, language),
        )
    except subprocess.TimeoutExpired as exc:
        duration_ms = int((time.perf_counter() - started_at) * 1000)
        return {
            'label': label,
            'input': test_input,
            'expected': expected,
            'actual': _truncate(exc.stdout or '', max_output_chars),
            'stderr': 'Превышен лимит времени.',
            'passed': False,
            'duration_ms': duration_ms,
            'error_type': 'timeout',
        }

    duration_ms = int((time.perf_counter() - started_at) * 1000)
    actual = _truncate(completed.stdout, max_output_chars)
    stderr = _truncate(completed.stderr, max_output_chars)
    if completed.returncode != 0:
        return {
            'label': label,
            'input': test_input,
            'expected': expected,
            'actual': actual,
            'stderr': stderr or f'Процесс завершился с кодом {completed.returncode}.',
            'passed': False,
            'duration_ms': duration_ms,
            'error_type': 'compile_error' if _looks_like_compile_error(stderr) else 'runtime_error',
        }

    passed = _normalize_output(actual) == _normalize_output(expected)
    return {
        'label': label,
        'input': test_input,
        'expected': expected,
        'actual': actual,
        'stderr': stderr or None,
        'passed': passed,
        'duration_ms': duration_ms,
        'error_type': None,
    }


def execute_stdio_submission(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ValueError('Ожидается JSON-объект.')
    language = str(payload.get('language') or 'python').strip().lower()
    if language not in SUPPORTED_LANGUAGES:
        raise ValueError('Поддерживаются только Python и JavaScript.')
    code = str(payload.get('code') or '')
    if not code.strip():
        raise ValueError('Код не передан.')
    tests = _normalized_tests(payload.get('tests'))
    if not tests:
        raise ValueError('Для запуска нужны тесты.')

    time_limit_ms = _safe_int(payload.get('time_limit_ms'), DEFAULT_TIME_LIMIT_MS, minimum=500, maximum=10000)
    memory_limit_mb = _safe_int(payload.get('memory_limit_mb'), DEFAULT_MEMORY_LIMIT_MB, minimum=32, maximum=1024)
    max_output_chars = _safe_int(payload.get('max_output_chars'), MAX_OUTPUT_CHARS, minimum=256, maximum=20000)
    extension = 'py' if language == 'python' else 'js'

    with tempfile.TemporaryDirectory(prefix='judge-') as workdir:
        script_path = os.path.join(workdir, f'main.{extension}')
        with open(script_path, 'w', encoding='utf-8', newline='\n') as handle:
            handle.write(code)
        command = _command_for(language, script_path, memory_limit_mb)
        results = [
            _run_test(
                command=command,
                workdir=workdir,
                test_input=str(test.get('input') or ''),
                expected=str(test.get('expected') or ''),
                label=str(test.get('label') or f'Тест {index}'),
                time_limit_ms=time_limit_ms,
                memory_limit_mb=memory_limit_mb,
                max_output_chars=max_output_chars,
                language=language,
            )
            for index, test in enumerate(tests, start=1)
        ]

    passed_count = len([row for row in results if row['passed']])
    total_count = len(results)
    score = int((passed_count / max(total_count, 1)) * 100)
    first_failed = next((row for row in results if not row['passed']), None)
    compile_error = first_failed['stderr'] if first_failed and first_failed.get('error_type') == 'compile_error' else None
    runtime_error = first_failed['stderr'] if first_failed and first_failed.get('error_type') in {'runtime_error', 'timeout'} else None
    if passed_count == total_count:
        feedback = f'Автопроверка пройдена: {passed_count}/{total_count} тестов.'
    elif first_failed and first_failed.get('error_type') == 'timeout':
        feedback = f'Лимит времени превышен на кейсе «{first_failed["label"]}».'
    elif first_failed and first_failed.get('error_type') == 'compile_error':
        feedback = f'Код не запустился из-за синтаксической ошибки на кейсе «{first_failed["label"]}».'
    elif first_failed and first_failed.get('error_type') == 'runtime_error':
        feedback = f'Код завершился с ошибкой на кейсе «{first_failed["label"]}».'
    else:
        feedback = f'Пройдено {passed_count} из {total_count} тестов. Проверь вывод на первом непройденном кейсе.'

    return {
        'mode': 'stdin_stdout',
        'runner': 'stdin_stdout',
        'language': language,
        'passed': passed_count == total_count,
        'score': score,
        'feedback': feedback,
        'tests_passed': passed_count,
        'tests_total': total_count,
        'results': results,
        'compile_error': compile_error,
        'runtime_error': runtime_error,
        'time_limit_ms': time_limit_ms,
        'memory_limit_mb': memory_limit_mb,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = 'CodeJudgeRunner/1.0'

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == '/health':
            self._send_json(HTTPStatus.OK, {'status': 'ok'})
            return
        self._send_json(HTTPStatus.NOT_FOUND, {'message': 'Not found'})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != '/execute':
            self._send_json(HTTPStatus.NOT_FOUND, {'message': 'Not found'})
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

        try:
            report = execute_stdio_submission(payload)
        except ValueError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {'message': str(exc)})
            return
        except FileNotFoundError as exc:
            self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {'message': str(exc)})
            return
        except Exception:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {'message': 'Runner не смог выполнить код.'})
            return

        self._send_json(HTTPStatus.OK, report)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


if __name__ == '__main__':
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f'Judge runner listening on http://{HOST}:{PORT}', flush=True)
    server.serve_forever()
