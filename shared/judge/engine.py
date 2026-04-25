from __future__ import annotations

import os
import subprocess
import tempfile
import time
from dataclasses import dataclass
from typing import Callable, Protocol


@dataclass(frozen=True)
class JudgeTestCase:
    label: str
    input: str
    expected: str


@dataclass(frozen=True)
class JudgeExecutionRequest:
    language: str
    code: str
    tests: list[JudgeTestCase]
    time_limit_ms: int
    memory_limit_mb: int
    max_output_chars: int
    tempdir_prefix: str = "judge-"


class JudgeRuntime(Protocol):
    def command_for(self, language: str, script_path: str, memory_limit_mb: int) -> list[str]:
        ...

    def build_env(self) -> dict[str, str]:
        ...

    def preexec_fn(
        self,
        memory_limit_mb: int,
        time_limit_ms: int,
        language: str,
    ) -> Callable[[], None] | None:
        ...


def truncate_output(value: str | None, limit: int) -> str:
    text = (value or "").replace("\r\n", "\n").replace("\r", "\n")
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}\n..."


def normalize_output(value: str | None) -> str:
    normalized = (value or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in normalized.split("\n")]
    while lines and lines[-1] == "":
        lines.pop()
    return "\n".join(lines)


def looks_like_compile_error(stderr: str) -> bool:
    lowered = stderr.lower()
    return "syntaxerror" in lowered or "unexpected token" in lowered


def coerce_test_cases(value) -> list[JudgeTestCase]:
    if not isinstance(value, list):
        return []

    rows: list[JudgeTestCase] = []
    for index, item in enumerate(value, start=1):
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or f"Тест {index}").strip() or f"Тест {index}"
        test_input = str(item.get("input") if item.get("input") is not None else item.get("stdin") or "")
        expected = str(item.get("expected") if item.get("expected") is not None else item.get("stdout") or "")
        if not test_input and not expected:
            continue
        rows.append(JudgeTestCase(label=label, input=test_input, expected=expected))
    return rows


def run_test(
    *,
    command: list[str],
    runtime: JudgeRuntime,
    workdir: str,
    test: JudgeTestCase,
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
            input=test.input,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=time_limit_ms / 1000,
            env=runtime.build_env(),
            preexec_fn=runtime.preexec_fn(memory_limit_mb, time_limit_ms, language),
        )
    except subprocess.TimeoutExpired as exc:
        duration_ms = int((time.perf_counter() - started_at) * 1000)
        return {
            "label": test.label,
            "input": test.input,
            "expected": test.expected,
            "actual": truncate_output(exc.stdout or "", max_output_chars),
            "stderr": "Превышен лимит времени.",
            "passed": False,
            "duration_ms": duration_ms,
            "error_type": "timeout",
        }

    duration_ms = int((time.perf_counter() - started_at) * 1000)
    actual = truncate_output(completed.stdout, max_output_chars)
    stderr = truncate_output(completed.stderr, max_output_chars)
    if completed.returncode != 0:
        return {
            "label": test.label,
            "input": test.input,
            "expected": test.expected,
            "actual": actual,
            "stderr": stderr or f"Процесс завершился с кодом {completed.returncode}.",
            "passed": False,
            "duration_ms": duration_ms,
            "error_type": "compile_error" if looks_like_compile_error(stderr) else "runtime_error",
        }

    passed = normalize_output(actual) == normalize_output(test.expected)
    return {
        "label": test.label,
        "input": test.input,
        "expected": test.expected,
        "actual": actual,
        "stderr": stderr or None,
        "passed": passed,
        "duration_ms": duration_ms,
        "error_type": None,
    }


def execute_stdio_submission(request: JudgeExecutionRequest, runtime: JudgeRuntime) -> dict:
    if not request.tests:
        raise ValueError("Для запуска нужны тесты.")

    extension = "py" if request.language == "python" else "js"
    with tempfile.TemporaryDirectory(prefix=request.tempdir_prefix) as workdir:
        script_path = os.path.join(workdir, f"main.{extension}")
        with open(script_path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(request.code)

        command = runtime.command_for(request.language, script_path, request.memory_limit_mb)
        results = [
            run_test(
                command=command,
                runtime=runtime,
                workdir=workdir,
                test=test_case,
                time_limit_ms=request.time_limit_ms,
                memory_limit_mb=request.memory_limit_mb,
                max_output_chars=request.max_output_chars,
                language=request.language,
            )
            for test_case in request.tests
        ]

    passed_count = len([row for row in results if row["passed"]])
    total_count = len(results)
    score = int((passed_count / max(total_count, 1)) * 100)
    first_failed = next((row for row in results if not row["passed"]), None)
    compile_error = first_failed["stderr"] if first_failed and first_failed.get("error_type") == "compile_error" else None
    runtime_error = first_failed["stderr"] if first_failed and first_failed.get("error_type") in {"runtime_error", "timeout"} else None

    if passed_count == total_count:
        feedback = f"Автопроверка пройдена: {passed_count}/{total_count} тестов."
    elif first_failed and first_failed.get("error_type") == "timeout":
        feedback = f"Лимит времени превышен на кейсе «{first_failed['label']}»."
    elif first_failed and first_failed.get("error_type") == "compile_error":
        feedback = f"Код не запустился из-за синтаксической ошибки на кейсе «{first_failed['label']}»."
    elif first_failed and first_failed.get("error_type") == "runtime_error":
        feedback = f"Код завершился с ошибкой на кейсе «{first_failed['label']}»."
    else:
        feedback = f"Пройдено {passed_count} из {total_count} тестов. Проверь вывод на первом непройденном кейсе."

    return {
        "mode": "stdin_stdout",
        "runner": "stdin_stdout",
        "language": request.language,
        "passed": passed_count == total_count,
        "score": score,
        "feedback": feedback,
        "tests_passed": passed_count,
        "tests_total": total_count,
        "results": results,
        "compile_error": compile_error,
        "runtime_error": runtime_error,
        "time_limit_ms": request.time_limit_ms,
        "memory_limit_mb": request.memory_limit_mb,
    }
