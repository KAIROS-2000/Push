import sys
import time
from pathlib import Path

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
from .api.student import student_bp
from .api.teacher import teacher_bp
from .cli import register_commands
from .core.config import Config
from .core.db import db
from .core.security import (
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME,
    SAFE_HTTP_METHODS,
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
    app.register_blueprint(teacher_bp, url_prefix="/api/teacher")
    app.register_blueprint(messaging_bp, url_prefix="/api/messaging")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

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

    return app
