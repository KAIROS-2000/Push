from __future__ import annotations

import json
import math
import os
import shutil
from typing import Callable
from urllib import error as urllib_error
from urllib import request as urllib_request

from flask import current_app

from shared.judge import JudgeExecutionRequest, coerce_test_cases, execute_stdio_submission

from ..models.learning import Task


class CodeJudgeError(Exception):
    """Base error for task evaluation failures."""


class CodeJudgeConfigurationError(CodeJudgeError):
    """Raised when a task is configured incorrectly for auto-checking."""


class CodeJudgeUnavailableError(CodeJudgeError):
    """Raised when the isolated runner is temporarily unavailable."""


def _python_command(script_path: str) -> list[str]:
    binary = current_app.config.get('CODE_JUDGE_PYTHON_BIN', 'python')
    return [binary, '-I', script_path]


def _javascript_command(script_path: str, memory_limit_mb: int) -> list[str]:
    binary = current_app.config.get('CODE_JUDGE_NODE_BIN', 'node')
    heap_limit_mb = max(96, min(memory_limit_mb, 2048))
    return [binary, f'--max-old-space-size={heap_limit_mb}', script_path]


def _resolve_command(command: list[str]) -> list[str]:
    executable = command[0]
    if os.path.isabs(executable) and os.path.exists(executable):
        return command
    if shutil.which(executable):
        return command
    raise CodeJudgeConfigurationError(f'На сервере не найден рантайм "{executable}" для автопроверки.')


def _build_env() -> dict[str, str]:
    allowed_keys = {
        'PATH',
        'SystemRoot',
        'ComSpec',
        'PATHEXT',
        'TEMP',
        'TMP',
        'HOME',
        'USERPROFILE',
        'WINDIR',
    }
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
        # RLIMIT_AS works predictably for Python, but can deadlock Node/V8 at startup.
        if language == 'python' and hasattr(resource, 'RLIMIT_AS'):
            resource.setrlimit(resource.RLIMIT_AS, (memory_limit_bytes, memory_limit_bytes))
        if hasattr(resource, 'RLIMIT_CORE'):
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

    return apply_limits


class FlaskJudgeRuntime:
    def command_for(self, language: str, script_path: str, memory_limit_mb: int) -> list[str]:
        return _resolve_command(
            _python_command(script_path)
            if language == 'python'
            else _javascript_command(script_path, memory_limit_mb)
        )

    def build_env(self) -> dict[str, str]:
        return _build_env()

    def preexec_fn(self, memory_limit_mb: int, time_limit_ms: int, language: str) -> Callable[[], None] | None:
        return _preexec_resource_limits(memory_limit_mb, time_limit_ms, language)


def _judge_stdio_submission_local(task: Task, code: str, validation: dict) -> dict:
    tests = coerce_test_cases(validation['tests'])
    if not tests:
        raise CodeJudgeConfigurationError('Для этой задачи не настроены тесты. Добавьте хотя бы один кейс в конструкторе урока.')

    language = validation['language'] or 'python'
    request = JudgeExecutionRequest(
        language=language,
        code=code,
        tests=tests,
        time_limit_ms=validation['time_limit_ms'] or int(current_app.config.get('CODE_JUDGE_DEFAULT_TIME_LIMIT_MS', 2000)),
        memory_limit_mb=validation['memory_limit_mb'] or int(current_app.config.get('CODE_JUDGE_DEFAULT_MEMORY_LIMIT_MB', 128)),
        max_output_chars=int(current_app.config.get('CODE_JUDGE_MAX_OUTPUT_CHARS', 4000)),
        tempdir_prefix='codejudge-',
    )
    return execute_stdio_submission(request, FlaskJudgeRuntime())


def _runner_url() -> str | None:
    configured = current_app.config.get('CODE_JUDGE_RUNNER_URL')
    return configured.strip() if isinstance(configured, str) and configured.strip() else None


def _runner_timeout_seconds() -> float:
    timeout_ms = int(current_app.config.get('CODE_JUDGE_RUNNER_TIMEOUT_MS', 15000) or 15000)
    return max(timeout_ms / 1000, 1)


def _runner_headers() -> dict[str, str]:
    headers = {'Content-Type': 'application/json'}
    runner_token = current_app.config.get('CODE_JUDGE_RUNNER_TOKEN')
    if isinstance(runner_token, str) and runner_token.strip():
        headers['Authorization'] = f'Bearer {runner_token.strip()}'
    return headers


def _post_to_runner(payload: dict) -> dict:
    runner_url = _runner_url()
    if not runner_url:
        raise CodeJudgeUnavailableError('Изолированный runner не настроен.')

    request_body = json.dumps(payload).encode('utf-8')
    request = urllib_request.Request(
        runner_url,
        data=request_body,
        headers=_runner_headers(),
        method='POST',
    )
    try:
        with urllib_request.urlopen(request, timeout=_runner_timeout_seconds()) as response:
            raw_body = response.read().decode('utf-8')
    except urllib_error.HTTPError as exc:
        raw_body = exc.read().decode('utf-8', errors='replace')
        try:
            data = json.loads(raw_body)
        except json.JSONDecodeError as parse_error:
            raise CodeJudgeUnavailableError('Изолированный runner вернул некорректный ответ.') from parse_error
        message = data.get('message') or data.get('error') or 'Изолированный runner отклонил запрос.'
        if exc.code == 400:
            raise CodeJudgeConfigurationError(str(message))
        raise CodeJudgeUnavailableError(str(message))
    except (urllib_error.URLError, TimeoutError) as exc:
        raise CodeJudgeUnavailableError('Изолированный runner недоступен.') from exc

    try:
        response_payload = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        raise CodeJudgeUnavailableError('Изолированный runner вернул некорректный JSON.') from exc
    if not isinstance(response_payload, dict):
        raise CodeJudgeUnavailableError('Изолированный runner вернул неожиданный формат ответа.')
    return response_payload


def _judge_stdio_submission_remote(task: Task, code: str, validation: dict) -> dict:
    tests = coerce_test_cases(validation['tests'])
    if not tests:
        raise CodeJudgeConfigurationError('Для этой задачи не настроены тесты. Добавьте хотя бы один кейс в конструкторе урока.')
    return _post_to_runner(
        {
            'language': validation['language'] or 'python',
            'code': code,
            'tests': [
                {'label': test.label, 'input': test.input, 'expected': test.expected}
                for test in tests
            ],
            'time_limit_ms': validation['time_limit_ms'] or int(current_app.config.get('CODE_JUDGE_DEFAULT_TIME_LIMIT_MS', 2000)),
            'memory_limit_mb': validation['memory_limit_mb'] or int(current_app.config.get('CODE_JUDGE_DEFAULT_MEMORY_LIMIT_MB', 128)),
            'max_output_chars': int(current_app.config.get('CODE_JUDGE_MAX_OUTPUT_CHARS', 4000)),
        }
    )


def _judge_keywords_submission(task: Task, code: str, validation: dict) -> dict:
    keywords = [keyword.lower() for keyword in validation['keywords']]
    if not keywords:
        raise CodeJudgeConfigurationError('Для текстовой автопроверки не заданы ключевые слова.')

    normalized_answer = (code or '').lower()
    matches = [keyword for keyword in keywords if keyword in normalized_answer]
    missing = [keyword for keyword in keywords if keyword not in matches]
    score = 100 if matches and len(matches) == len(keywords) else int((len(matches) / max(len(keywords), 1)) * 100)
    passed = score >= task.lesson.passing_score
    if passed:
        feedback = f'Автопроверка по ключевым словам пройдена: найдено {len(matches)} из {len(keywords)} ориентиров.'
    else:
        feedback = f'Пока найдено {len(matches)} из {len(keywords)} ориентиров. Попробуй уточнить ответ.'
    return {
        'mode': 'keywords',
        'runner': None,
        'language': validation.get('language'),
        'passed': passed,
        'score': score,
        'feedback': feedback,
        'tests_passed': len(matches),
        'tests_total': len(keywords),
        'results': [],
        'compile_error': None,
        'runtime_error': None,
        'keyword_matches': matches,
        'missing_keywords': missing,
        'time_limit_ms': None,
        'memory_limit_mb': None,
    }


def judge_task_submission(task: Task, code: str) -> dict:
    validation = task.normalized_validation(include_private=True)
    evaluation_mode = validation['evaluation_mode']
    if evaluation_mode == 'stdin_stdout':
        runner_url = _runner_url()
        if runner_url:
            try:
                return _judge_stdio_submission_remote(task, code, validation)
            except CodeJudgeUnavailableError:
                if not current_app.config.get('CODE_JUDGE_ALLOW_LOCAL_FALLBACK', False):
                    raise
        return _judge_stdio_submission_local(task, code, validation)
    if evaluation_mode == 'keywords':
        return _judge_keywords_submission(task, code, validation)
    raise CodeJudgeConfigurationError('Для этой задачи включена ручная проверка, поэтому автотесты не запускаются.')


def summarize_judge_report(report: dict) -> str:
    if not report:
        return ''

    lines = [str(report.get('feedback') or '').strip()]
    if report.get('mode') == 'stdin_stdout':
        lines.append(f'Тестов пройдено: {report.get("tests_passed", 0)}/{report.get("tests_total", 0)}.')
        first_failed = next((row for row in report.get('results', []) if not row.get('passed')), None)
        if first_failed:
            lines.append(f'Проблемный кейс: {first_failed.get("label")}.')
            if first_failed.get('error_type') in {'runtime_error', 'compile_error', 'timeout'}:
                lines.append(first_failed.get('stderr') or 'Код завершился с ошибкой.')
            else:
                lines.append(f'Ожидалось: {first_failed.get("expected", "")}')
                lines.append(f'Получено: {first_failed.get("actual", "")}')
    elif report.get('mode') == 'keywords':
        lines.append(f'Ключевых ориентиров найдено: {report.get("tests_passed", 0)}/{report.get("tests_total", 0)}.')
        missing_keywords = report.get('missing_keywords') or []
        if missing_keywords:
            lines.append(f'Не найдены: {", ".join(missing_keywords[:5])}.')

    return '\n'.join(line for line in lines if line)
