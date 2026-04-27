import sys
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

import redis

from flask import Flask, g, has_request_context, request, send_from_directory
from flask.testing import FlaskClient
from flask_cors import CORS
from sqlalchemy import event
from werkzeug.datastructures import Headers
from werkzeug.middleware.proxy_fix import ProxyFix

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from .api.admin import admin_bp
from .api.auth import auth_bp
from .api.messaging import messaging_bp
from .api.staff_messaging import staff_messaging_bp
from .api.parent_cabinet import parent_bp
from .api.student import student_bp
from .api.teacher import teacher_bp
from .cli import register_commands
from .core.config import Config, resolve_redis_password
from .core.db import db
from .core.security import (
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME,
    SAFE_HTTP_METHODS,
    access_token_from_request,
    decode_token,
    request_origin_allowed,
    request_uses_cookie_auth,
    verify_csrf_token,
)

SPRITE_DIR = Path(__file__).resolve().parent.parent / "sprite"
COMMON_SECRET_KEY_PLACEHOLDERS = (
    "change-me",
    "replace-me",
    "your-secret",
    "dev-secret",
    "super-secret-key",
    "example",
    "todo",
)
PUBLIC_UNSAFE_API_PATHS = {
    "/api/auth/login",
    "/api/auth/register",
}


def _normalized_path(path: str) -> str:
    normalized = (path or "").strip()
    if not normalized:
        return "/"
    normalized = normalized.rstrip("/")
    return normalized or "/"


def _is_public_unsafe_api_path(path: str) -> bool:
    return _normalized_path(path) in PUBLIC_UNSAFE_API_PATHS


def _contains_placeholder_secret_fragment(value: str) -> bool:
    normalized = value.lower()
    return any(fragment in normalized for fragment in COMMON_SECRET_KEY_PLACEHOLDERS)


def _is_trivially_low_entropy_secret(value: str) -> bool:
    if not value:
        return True
    if len(set(value)) == 1:
        return True
    if len(value) < 40 and (value.isdigit() or (value.isalpha() and value.islower())):
        return True
    return False


class _CSRFAwareFlaskClient(FlaskClient):
    def open(self, *args, **kwargs):  # noqa: ANN002, ANN003
        method = str(kwargs.get("method") or "").upper()
        path = kwargs.get("path")
        if path is None and args and isinstance(args[0], str):
            path = args[0]

        if (
            self.application.testing
            and self.application.config.get("AUTO_TEST_CSRF_HEADER", True)
            and method in {"POST", "PUT", "PATCH", "DELETE"}
            and isinstance(path, str)
            and path.startswith("/api/")
            and not _is_public_unsafe_api_path(path)
        ):
            headers = Headers(kwargs.get("headers") or {})
            if CSRF_HEADER_NAME not in headers:
                csrf_cookie = self.get_cookie(CSRF_COOKIE_NAME)
                csrf_token = csrf_cookie.value if csrf_cookie else ""
                if csrf_token:
                    headers[CSRF_HEADER_NAME] = csrf_token
                    kwargs["headers"] = headers

        return super().open(*args, **kwargs)


def _redis_production_config_ok(url: str, password: str | None) -> tuple[bool, str | None]:
    lowered = url.strip().lower()
    if any(
        fragment in lowered
        for fragment in (
            'change-me',
            'replace-me',
            'your-redis',
            'example',
            'placeholder',
            'todo',
        )
    ):
        return False, 'REDIS_URL looks like a placeholder.'
    parsed = urlparse(url)
    if parsed.scheme not in {'redis', 'rediss'}:
        return False, 'REDIS_URL must use redis:// or rediss:// scheme.'
    if parsed.scheme == 'rediss':
        return False, 'REDIS_URL must use redis:// in this deployment (TLS URLs are not enabled for Redis yet).'
    has_auth = bool(parsed.password) or bool(password and password.strip())
    if not has_auth:
        return False, 'REDIS_URL must include credentials or set REDIS_PASSWORD / REDIS_PASSWORD_FILE.'
    return True, None


def _validate_runtime_config(app: Flask) -> None:
    secret_key = (app.config.get("SECRET_KEY") or "").strip()
    if app.config["IS_PRODUCTION"]:
        if len(secret_key) < 32:
            raise RuntimeError("Set a strong SECRET_KEY before running in production mode.")
        if _contains_placeholder_secret_fragment(secret_key):
            raise RuntimeError("Set a strong SECRET_KEY before running in production mode.")
        if _is_trivially_low_entropy_secret(secret_key):
            raise RuntimeError("Set a strong SECRET_KEY before running in production mode.")
    if app.config["IS_PRODUCTION"] and not app.config.get("SESSION_COOKIE_SECURE", True):
        raise RuntimeError("SESSION_COOKIE_SECURE must stay enabled in production mode.")
    if app.config["IS_PRODUCTION"] and not app.config.get("GIGACHAT_VERIFY_SSL", True):
        raise RuntimeError("GIGACHAT_VERIFY_SSL cannot be disabled in production mode.")
    if app.config["IS_PRODUCTION"] and not (app.config.get("CLIENT_URL") or "").strip():
        raise RuntimeError("Set CLIENT_URL in production mode.")
    if app.config["IS_PRODUCTION"] and (app.config.get("CODE_JUDGE_RUNNER_URL") or "").strip():
        runner_token = (app.config.get("CODE_JUDGE_RUNNER_TOKEN") or "").strip()
        runner_token_lower = runner_token.lower()
        if (
            runner_token_lower in {"", "local-dev-judge-token-change-me", "replace-with-random-judge-runner-token"}
            or len(runner_token) < 32
        ):
            raise RuntimeError("Set a strong CODE_JUDGE_RUNNER_TOKEN before enabling the code judge runner in production.")
    if app.config["IS_PRODUCTION"] and app.config.get("SUPERADMIN_BOOTSTRAP"):
        from .core.security import ADMIN_PASSWORD_MIN_LENGTH, validate_password

        superadmin_email = (app.config.get("SUPERADMIN_EMAIL") or "").strip().lower()
        superadmin_password = app.config.get("SUPERADMIN_PASSWORD") or ""
        if not superadmin_email or not superadmin_password:
            raise RuntimeError(
                "SUPERADMIN_BOOTSTRAP requires explicit SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD in production mode."
            )
        password_error = validate_password(
            superadmin_password,
            minimum_length=ADMIN_PASSWORD_MIN_LENGTH,
        )
        if password_error:
            raise RuntimeError(f"SUPERADMIN_PASSWORD is not secure enough: {password_error}")
    if app.config["IS_PRODUCTION"]:
        redis_url = (app.config.get("REDIS_URL") or "").strip()
        if not redis_url:
            raise RuntimeError("Set REDIS_URL before running in production mode.")
        redis_password = (resolve_redis_password() or "").strip()
        if len(redis_password) < 24:
            raise RuntimeError(
                "Set a strong Redis password (REDIS_PASSWORD or REDIS_PASSWORD_FILE, min 24 characters) for production."
            )
        if _contains_placeholder_secret_fragment(redis_password):
            raise RuntimeError("Redis password must not contain placeholder fragments in production mode.")
        if _is_trivially_low_entropy_secret(redis_password):
            raise RuntimeError("Redis password is too weak for production mode.")
        ok, redis_err = _redis_production_config_ok(redis_url, redis_password)
        if not ok:
            raise RuntimeError(redis_err or "Invalid REDIS_URL for production mode.")


_MAINT_FLAG_LOCK = threading.Lock()
_MAINT_FLAG_UNTIL = 0.0
_MAINT_FLAG_VALUE = False


def _maintenance_flag_active(app: Flask) -> bool:
    global _MAINT_FLAG_UNTIL, _MAINT_FLAG_VALUE
    now = time.monotonic()
    with _MAINT_FLAG_LOCK:
        if now < _MAINT_FLAG_UNTIL:
            return _MAINT_FLAG_VALUE
    active = False
    try:
        from .core.config import Config as _Cfg
        from .core.redis_client import get_redis, redis_key

        client = get_redis(_Cfg.REDIS_DB_LEADERBOARD)
        if client is not None:
            raw = client.get(redis_key("flags", "maintenance"))
            active = str(raw or "").strip().lower() in {"1", "true", "yes", "on"}
    except (OSError, TypeError, ValueError, redis.RedisError):
        active = False
    with _MAINT_FLAG_LOCK:
        _MAINT_FLAG_VALUE = active
        _MAINT_FLAG_UNTIL = now + 5.0
    return active


def _register_request_metrics(app: Flask) -> None:
    if not app.config.get("METRICS_DEBUG", False):
        return

    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):  # noqa: ARG001
        if has_request_context():
            g._db_query_count = getattr(g, "_db_query_count", 0) + 1

    with app.app_context():
        engine = db.engine
        if not getattr(engine, "_codequest_metrics_registered", False):
            event.listen(engine, "before_cursor_execute", before_cursor_execute)
            engine._codequest_metrics_registered = True

    @app.before_request
    def start_request_timer():
        g._request_started_at = time.perf_counter()
        g._db_query_count = 0

    @app.after_request
    def attach_request_metrics(response):
        started_at = getattr(g, "_request_started_at", None)
        duration_ms = int((time.perf_counter() - started_at) * 1000) if started_at else 0
        query_count = getattr(g, "_db_query_count", 0)
        response.headers.setdefault("X-Request-Duration-Ms", str(duration_ms))
        response.headers.setdefault("X-DB-Query-Count", str(query_count))
        app.logger.info(
            "request_metrics method=%s path=%s status=%s duration_ms=%s query_count=%s",
            request.method,
            request.path,
            response.status_code,
            duration_ms,
            query_count,
        )
        return response


def create_app() -> Flask:
    started_at = time.perf_counter()
    app = Flask(__name__)
    app.test_client_class = _CSRFAwareFlaskClient
    app.config.from_object(Config)
    _validate_runtime_config(app)
    if app.config.get("TRUST_PROXY", False):
        # Enable this only when running behind a trusted reverse proxy.
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=0)

    allowed_origins = [
        origin.strip()
        for origin in (app.config.get("CLIENT_URL") or "").split(",")
        if origin.strip()
    ]
    if not allowed_origins:
        allowed_origins = ["http://localhost:3000"]
    db.init_app(app)
    CORS(
        app,
        resources={r"/api/*": {"origins": allowed_origins}},
        supports_credentials=True,
    )

    with app.app_context():
        from . import models  # noqa: F401

    register_commands(app)
    _register_request_metrics(app)

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(student_bp, url_prefix="/api")
    app.register_blueprint(parent_bp, url_prefix="/api/parent")
    app.register_blueprint(teacher_bp, url_prefix="/api/teacher")
    app.register_blueprint(messaging_bp, url_prefix="/api/messaging")
    app.register_blueprint(staff_messaging_bp, url_prefix="/api/staff-messaging")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")

    @app.get("/api/health")
    def health():
        payload = {"status": "ok"}
        if (app.config.get("REDIS_URL") or "").strip():
            from .core.redis_client import redis_ping_with_timeout_ms

            payload["redis"] = bool(redis_ping_with_timeout_ms())
        return payload

    @app.before_request
    def enforce_maintenance_mode():
        if request.method in SAFE_HTTP_METHODS:
            return None
        path = request.path or ""
        if path.startswith("/api/health"):
            return None
        if not _maintenance_flag_active(app):
            return None
        try:
            token = access_token_from_request()
            if token:
                payload = decode_token(token)
                role = str(payload.get("role") or "").lower()
                if role in {"admin", "superadmin"}:
                    return None
        except Exception:
            pass
        return {"message": "Платформа в режиме обслуживания. Запись временно недоступна."}, 503

    @app.before_request
    def enforce_origin_for_unsafe_api_requests():
        if request.method in SAFE_HTTP_METHODS:
            return None
        if not request.path.startswith("/api/"):
            return None
        if request_origin_allowed():
            return None
        return {"message": "Недопустимый origin для этого запроса."}, 403

    @app.before_request
    def enforce_csrf_for_cookie_authenticated_unsafe_api_requests():
        if request.method in SAFE_HTTP_METHODS:
            return None
        if not request.path.startswith("/api/"):
            return None
        if _is_public_unsafe_api_path(request.path):
            return None
        if not request_uses_cookie_auth():
            return None
        if verify_csrf_token():
            return None
        return {"message": "CSRF token missing or invalid.", "code": "csrf_invalid"}, 403

    @app.get("/api/mascot/<path:filename>")
    def mascot_sprite(filename: str):
        return send_from_directory(SPRITE_DIR, filename)

    @app.after_request
    def apply_security_headers(response):
        response.headers.setdefault('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        response.headers.setdefault('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
        response.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
        response.headers.setdefault('X-Content-Type-Options', 'nosniff')
        response.headers.setdefault('X-Frame-Options', 'DENY')
        return response

    if app.config.get("METRICS_DEBUG", False):
        app.logger.info("create_app completed in %sms", int((time.perf_counter() - started_at) * 1000))

    if not app.config.get("TESTING") and app.config.get("ENABLE_AUDIT_LOG_DAILY_EXPORT_THREAD"):
        _start_audit_log_export_thread(app)

    from .services.site_activity_log import register_site_activity_logging

    register_site_activity_logging(app)

    return app


def _start_audit_log_export_thread(app: Flask) -> None:
    """In-process daily export. Disable on multi-worker deployments; use `flask export-audit-logs` + cron."""

    def run_loop() -> None:
        while True:
            try:
                hour_utc = int(app.config.get("AUDIT_LOG_DAILY_EXPORT_HOUR_UTC", 3))
                hour_utc = max(0, min(23, hour_utc))
                now = datetime.now(UTC)
                target = now.replace(hour=hour_utc, minute=0, second=0, microsecond=0)
                if target <= now:
                    target += timedelta(days=1)
                sleep_s = (target - now).total_seconds()
                time.sleep(sleep_s)
                with app.app_context():
                    from .services.audit_log_archive import run_audit_log_export

                    result = run_audit_log_export()
                    app.logger.info("audit_log_export %s", result)
            except Exception:  # noqa: BLE001
                app.logger.exception("audit_log_export loop failed")
                time.sleep(60.0)

    threading.Thread(target=run_loop, name="audit-log-export", daemon=True).start()
