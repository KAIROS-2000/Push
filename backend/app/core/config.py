import os


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


class Config:
    APP_ENV = os.getenv('APP_ENV', 'production').strip().lower()
    IS_PRODUCTION = APP_ENV == 'production'
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret-key')
    SQLALCHEMY_DATABASE_URI = os.getenv(
        'DATABASE_URL',
        'postgresql+psycopg://codequest:codequest@db:5432/codequest',
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    ACCESS_TOKEN_MINUTES = int(os.getenv('ACCESS_TOKEN_MINUTES', '30'))
    REFRESH_TOKEN_DAYS = int(os.getenv('REFRESH_TOKEN_DAYS', '14'))
    CLIENT_URL = os.getenv('CLIENT_URL', 'http://localhost:3000')
    SUPERADMIN_EMAIL = os.getenv('SUPERADMIN_EMAIL', 'superadmin@codequest.local')
    SUPERADMIN_PASSWORD = os.getenv('SUPERADMIN_PASSWORD', 'ChangeMe123!')
    SUPERADMIN_NAME = os.getenv('SUPERADMIN_NAME', 'Главный администратор')
    ENABLE_DEMO_DATA = _as_bool(
        os.getenv('ENABLE_DEMO_DATA'),
        default=not IS_PRODUCTION,
    )
    DEMO_STUDENT_EMAIL = os.getenv('DEMO_STUDENT_EMAIL', '')
    DEMO_STUDENT_PASSWORD = os.getenv('DEMO_STUDENT_PASSWORD', '')
    DEMO_TEACHER_EMAIL = os.getenv('DEMO_TEACHER_EMAIL', '')
    DEMO_TEACHER_PASSWORD = os.getenv('DEMO_TEACHER_PASSWORD', '')
    DEMO_ADMIN_EMAIL = os.getenv('DEMO_ADMIN_EMAIL', '')
    DEMO_ADMIN_PASSWORD = os.getenv('DEMO_ADMIN_PASSWORD', '')
    DEMO_CLASS_CODE = os.getenv('DEMO_CLASS_CODE', '')
    DEMO_PARENT_CODE = os.getenv('DEMO_PARENT_CODE', '')
    CODE_JUDGE_PYTHON_BIN = os.getenv('CODE_JUDGE_PYTHON_BIN', 'python')
    CODE_JUDGE_NODE_BIN = os.getenv('CODE_JUDGE_NODE_BIN', 'node')
    CODE_JUDGE_DEFAULT_TIME_LIMIT_MS = int(os.getenv('CODE_JUDGE_DEFAULT_TIME_LIMIT_MS', '2000'))
    CODE_JUDGE_DEFAULT_MEMORY_LIMIT_MB = int(os.getenv('CODE_JUDGE_DEFAULT_MEMORY_LIMIT_MB', '128'))
    CODE_JUDGE_MAX_OUTPUT_CHARS = int(os.getenv('CODE_JUDGE_MAX_OUTPUT_CHARS', '4000'))
    CODE_JUDGE_RUNNER_URL = (os.getenv('CODE_JUDGE_RUNNER_URL') or '').strip() or None
    CODE_JUDGE_RUNNER_TIMEOUT_MS = int(os.getenv('CODE_JUDGE_RUNNER_TIMEOUT_MS', '15000'))
    CODE_JUDGE_ALLOW_LOCAL_FALLBACK = _as_bool(os.getenv('CODE_JUDGE_ALLOW_LOCAL_FALLBACK'), default=True)

    GIGACHAT_AUTH_KEY = (os.getenv('GIGACHAT_AUTH_KEY') or '').strip() or None
    GIGACHAT_SCOPE = os.getenv('GIGACHAT_SCOPE', 'GIGACHAT_API_PERS').strip() or 'GIGACHAT_API_PERS'
    GIGACHAT_MODEL = os.getenv('GIGACHAT_MODEL', 'GigaChat').strip() or 'GigaChat'
    GIGACHAT_AUTH_URL = os.getenv('GIGACHAT_AUTH_URL', 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth').strip()
    GIGACHAT_API_URL = os.getenv('GIGACHAT_API_URL', 'https://gigachat.devices.sberbank.ru/api/v1').strip().rstrip('/')
    GIGACHAT_TIMEOUT_MS = int(os.getenv('GIGACHAT_TIMEOUT_MS', '30000'))
    GIGACHAT_VERIFY_SSL = _as_bool(os.getenv('GIGACHAT_VERIFY_SSL'), default=True)
    GIGACHAT_CA_BUNDLE = (os.getenv('GIGACHAT_CA_BUNDLE') or '').strip() or None
