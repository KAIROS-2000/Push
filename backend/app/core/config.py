import os
from pathlib import Path

from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_DIR.parent

load_dotenv(PROJECT_ROOT / '.env', override=False)
load_dotenv(BACKEND_DIR / '.env', override=False)


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


def _env(name: str) -> str | None:
    value = os.getenv(name)
    if value is None:
        return None
    value = value.strip()
    return value or None


def resolve_redis_password() -> str | None:
    file_path = _env('REDIS_PASSWORD_FILE')
    if file_path:
        p = Path(file_path)
        if p.is_file():
            raw = p.read_text(encoding='utf-8').replace("\r", "").strip()
            return raw or None
    pw = _env("REDIS_PASSWORD")
    return pw.replace("\r", "") if pw else None


class Config:
    APP_ENV = (_env('APP_ENV') or 'production').lower()
    IS_PRODUCTION = APP_ENV == 'production'
    SECRET_KEY = _env('SECRET_KEY') or 'dev-secret-key'
    SQLALCHEMY_DATABASE_URI = _env('DATABASE_URL') or 'postgresql+psycopg://codequest:codequest@db:5432/codequest'
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    ACCESS_TOKEN_MINUTES = int(_env('ACCESS_TOKEN_MINUTES') or '30')
    REFRESH_TOKEN_DAYS = int(_env('REFRESH_TOKEN_DAYS') or '14')
    CLIENT_URL = _env('CLIENT_URL') or (None if IS_PRODUCTION else 'http://localhost:3000')
    SESSION_COOKIE_SECURE = _as_bool(os.getenv('SESSION_COOKIE_SECURE'), default=IS_PRODUCTION)
    SESSION_COOKIE_SAMESITE = _env('SESSION_COOKIE_SAMESITE') or 'Lax'
    TRUST_PROXY = _as_bool(os.getenv('TRUST_PROXY'), default=False)
    SUPERADMIN_BOOTSTRAP = _as_bool(os.getenv('SUPERADMIN_BOOTSTRAP'), default=not IS_PRODUCTION)
    SUPERADMIN_EMAIL = (_env('SUPERADMIN_EMAIL') or ('' if IS_PRODUCTION else 'superadmin@codequest.local')).lower()
    SUPERADMIN_PASSWORD = _env('SUPERADMIN_PASSWORD') or ('' if IS_PRODUCTION else 'LocalOnlySuperAdmin123!')
    SUPERADMIN_NAME = _env('SUPERADMIN_NAME') or 'Главный администратор'
    ENABLE_DEMO_DATA = _as_bool(
        os.getenv('ENABLE_DEMO_DATA'),
        default=not IS_PRODUCTION,
    )
    DEMO_STUDENT_EMAIL = _env('DEMO_STUDENT_EMAIL') or ''
    DEMO_STUDENT_PASSWORD = _env('DEMO_STUDENT_PASSWORD') or ''
    DEMO_TEACHER_EMAIL = _env('DEMO_TEACHER_EMAIL') or ''
    DEMO_TEACHER_PASSWORD = _env('DEMO_TEACHER_PASSWORD') or ''
    DEMO_ADMIN_EMAIL = _env('DEMO_ADMIN_EMAIL') or ''
    DEMO_ADMIN_PASSWORD = _env('DEMO_ADMIN_PASSWORD') or ''
    DEMO_CLASS_CODE = _env('DEMO_CLASS_CODE') or ''
    DEMO_PARENT_CODE = _env('DEMO_PARENT_CODE') or ''
    CODE_JUDGE_PYTHON_BIN = _env('CODE_JUDGE_PYTHON_BIN') or 'python'
    CODE_JUDGE_NODE_BIN = _env('CODE_JUDGE_NODE_BIN') or 'node'
    CODE_JUDGE_DEFAULT_TIME_LIMIT_MS = int(_env('CODE_JUDGE_DEFAULT_TIME_LIMIT_MS') or '2000')
    CODE_JUDGE_DEFAULT_MEMORY_LIMIT_MB = int(_env('CODE_JUDGE_DEFAULT_MEMORY_LIMIT_MB') or '128')
    CODE_JUDGE_MAX_OUTPUT_CHARS = int(_env('CODE_JUDGE_MAX_OUTPUT_CHARS') or '4000')
    CODE_JUDGE_RUNNER_URL = _env('CODE_JUDGE_RUNNER_URL')
    CODE_JUDGE_RUNNER_TOKEN = _env('CODE_JUDGE_RUNNER_TOKEN')
    CODE_JUDGE_RUNNER_TIMEOUT_MS = int(_env('CODE_JUDGE_RUNNER_TIMEOUT_MS') or '15000')
    CODE_JUDGE_ALLOW_LOCAL_FALLBACK = (
        False
        if IS_PRODUCTION
        else _as_bool(os.getenv('CODE_JUDGE_ALLOW_LOCAL_FALLBACK'), default=False)
    )
    METRICS_DEBUG = _as_bool(os.getenv('METRICS_DEBUG'), default=not IS_PRODUCTION)

    GIGACHAT_AUTH_KEY = _env('GIGACHAT_AUTH_KEY')
    GIGACHAT_SCOPE = _env('GIGACHAT_SCOPE') or 'GIGACHAT_API_PERS'
    GIGACHAT_MODEL = _env('GIGACHAT_MODEL') or 'GigaChat'
    GIGACHAT_AUTH_URL = _env('GIGACHAT_AUTH_URL') or 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth'
    GIGACHAT_API_URL = (_env('GIGACHAT_API_URL') or 'https://gigachat.devices.sberbank.ru/api/v1').rstrip('/')
    GIGACHAT_TIMEOUT_MS = int(_env('GIGACHAT_TIMEOUT_MS') or '30000')
    GIGACHAT_VERIFY_SSL = _as_bool(os.getenv('GIGACHAT_VERIFY_SSL'), default=True)
    GIGACHAT_CA_BUNDLE = _env('GIGACHAT_CA_BUNDLE')
    LOGIN_RATE_LIMIT_WINDOW_SECONDS = int(_env('LOGIN_RATE_LIMIT_WINDOW_SECONDS') or '900')
    LOGIN_RATE_LIMIT_MAX_FAILURES = int(_env('LOGIN_RATE_LIMIT_MAX_FAILURES') or '8')
    LOGIN_RATE_LIMIT_BLOCK_SECONDS = int(_env('LOGIN_RATE_LIMIT_BLOCK_SECONDS') or '900')
    PARENT_ACCESS_RATE_LIMIT_WINDOW_SECONDS = int(_env('PARENT_ACCESS_RATE_LIMIT_WINDOW_SECONDS') or '600')
    PARENT_ACCESS_RATE_LIMIT_MAX_FAILURES = int(_env('PARENT_ACCESS_RATE_LIMIT_MAX_FAILURES') or '20')
    PARENT_ACCESS_RATE_LIMIT_BLOCK_SECONDS = int(_env('PARENT_ACCESS_RATE_LIMIT_BLOCK_SECONDS') or '900')
    REGISTER_RATE_LIMIT_WINDOW_SECONDS = int(_env('REGISTER_RATE_LIMIT_WINDOW_SECONDS') or '3600')
    REGISTER_RATE_LIMIT_MAX_FAILURES = int(_env('REGISTER_RATE_LIMIT_MAX_FAILURES') or '25')
    REGISTER_RATE_LIMIT_BLOCK_SECONDS = int(_env('REGISTER_RATE_LIMIT_BLOCK_SECONDS') or '3600')
    REFRESH_RATE_LIMIT_WINDOW_SECONDS = int(_env('REFRESH_RATE_LIMIT_WINDOW_SECONDS') or '60')
    REFRESH_RATE_LIMIT_MAX_FAILURES = int(_env('REFRESH_RATE_LIMIT_MAX_FAILURES') or '45')
    REFRESH_RATE_LIMIT_BLOCK_SECONDS = int(_env('REFRESH_RATE_LIMIT_BLOCK_SECONDS') or '300')

    REDIS_URL = _env('REDIS_URL')
    REDIS_PASSWORD_FILE = _env('REDIS_PASSWORD_FILE')
    REDIS_SOCKET_TIMEOUT_MS = int(_env('REDIS_SOCKET_TIMEOUT_MS') or '200')
    REDIS_CONNECT_TIMEOUT_MS = int(_env('REDIS_CONNECT_TIMEOUT_MS') or '200')
    REDIS_HEALTH_PING_MS = int(_env('REDIS_HEALTH_PING_MS') or '100')
    REDIS_DB_LEADERBOARD = int(_env('REDIS_DB_LEADERBOARD') or '0')
    REDIS_DB_SESSION_VERSION = int(_env('REDIS_DB_SESSION_VERSION') or '1')
    REDIS_DB_THROTTLE = int(_env('REDIS_DB_THROTTLE') or '2')
    REDIS_DB_CELERY_BROKER = int(_env('REDIS_DB_CELERY_BROKER') or '3')
    REDIS_DB_CELERY_RESULT = int(_env('REDIS_DB_CELERY_RESULT') or '4')

    _throttle_backend = (_env('THROTTLE_BACKEND') or 'dual').strip().lower()
    THROTTLE_BACKEND = _throttle_backend if _throttle_backend in {'redis', 'db', 'dual'} else 'dual'

    _session_ver_cache = (_env('SESSION_VERSION_CACHE') or '').strip().lower()
    if _session_ver_cache in {'redis', 'off'}:
        SESSION_VERSION_CACHE = _session_ver_cache
    else:
        SESSION_VERSION_CACHE = 'redis' if IS_PRODUCTION else 'off'
