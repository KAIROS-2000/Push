from __future__ import annotations

import hmac
import secrets
from datetime import UTC, datetime, timedelta
from functools import wraps
from typing import Callable
from urllib.parse import urlparse
from uuid import uuid4

import jwt
import redis
from flask import Response, current_app, request
from werkzeug.security import check_password_hash, generate_password_hash

from ..core.config import Config
from ..core.db import db
from ..core import throttle_redis
from ..core.redis_client import get_redis, redis_available
from ..models.user import (
    TEACHER_APPROVAL_APPROVED,
    TEACHER_APPROVAL_PENDING,
    RefreshToken,
    SecurityThrottle,
    User,
    UserRole,
)

ACCESS_COOKIE_NAME = 'codequest_access_token'
REFRESH_COOKIE_NAME = 'codequest_refresh_token'
ACCESS_EXPIRES_AT_COOKIE_NAME = 'codequest_access_expires_at'
CSRF_COOKIE_NAME = 'csrf_token'
CSRF_HEADER_NAME = 'X-CSRF-Token'
DEFAULT_PASSWORD_MIN_LENGTH = 10
ADMIN_PASSWORD_MIN_LENGTH = 12
LOGIN_THROTTLE_SCOPE = 'login'
PARENT_ACCESS_THROTTLE_SCOPE = 'parent_access'
REGISTER_THROTTLE_SCOPE = 'register'
REFRESH_THROTTLE_SCOPE = 'refresh'
SESSION_VERSION_CACHE_TTL_SECONDS = 30
COMMON_WEAK_PASSWORDS = {
    '123456',
    '12345678',
    '123456789',
    '1234567890',
    'password',
    'password123',
    'qwerty123',
    'qwertyui',
    'letmein',
    'admin123',
    'changeme',
}
SAFE_HTTP_METHODS = {'GET', 'HEAD', 'OPTIONS'}


def hash_password(password: str) -> str:
    return generate_password_hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return check_password_hash(password_hash, password)


def password_has_whitespace(password: str) -> bool:
    return any(char.isspace() for char in password)


def validate_password(password: str, minimum_length: int = DEFAULT_PASSWORD_MIN_LENGTH) -> str | None:
    if len(password) < minimum_length:
        return f'Пароль должен содержать не менее {minimum_length} символов.'
    if password_has_whitespace(password):
        return 'Пароль не должен содержать пробелы.'
    if password.strip().lower() in COMMON_WEAK_PASSWORDS:
        return 'Этот пароль слишком простой. Используйте более уникальную комбинацию.'
    if not any(char.islower() for char in password):
        return 'Пароль должен содержать хотя бы одну строчную букву.'
    if not any(char.isupper() for char in password):
        return 'Пароль должен содержать хотя бы одну заглавную букву.'
    if not any(char.isdigit() for char in password):
        return 'Пароль должен содержать хотя бы одну цифру.'
    if not any(not char.isalnum() for char in password):
        return 'Пароль должен содержать хотя бы один специальный символ.'
    return None


def password_strength(password: str) -> str:
    score = 0
    score += len(password) >= DEFAULT_PASSWORD_MIN_LENGTH
    score += any(char.islower() for char in password)
    score += any(char.isupper() for char in password)
    score += any(char.isdigit() for char in password)
    score += any(not char.isalnum() for char in password)
    return ['weak', 'weak', 'medium', 'medium', 'strong', 'strong'][score]


def _request_ip() -> str:
    return (request.remote_addr or 'unknown').strip()[:64] or 'unknown'


def _ensure_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _throttle_settings(scope: str) -> tuple[int, int, int]:
    if scope == LOGIN_THROTTLE_SCOPE:
        return (
            int(current_app.config.get('LOGIN_RATE_LIMIT_WINDOW_SECONDS', 900)),
            int(current_app.config.get('LOGIN_RATE_LIMIT_MAX_FAILURES', 8)),
            int(current_app.config.get('LOGIN_RATE_LIMIT_BLOCK_SECONDS', 900)),
        )
    if scope == PARENT_ACCESS_THROTTLE_SCOPE:
        return (
            int(current_app.config.get('PARENT_ACCESS_RATE_LIMIT_WINDOW_SECONDS', 600)),
            int(current_app.config.get('PARENT_ACCESS_RATE_LIMIT_MAX_FAILURES', 20)),
            int(current_app.config.get('PARENT_ACCESS_RATE_LIMIT_BLOCK_SECONDS', 900)),
        )
    if scope == REGISTER_THROTTLE_SCOPE:
        return (
            int(current_app.config.get('REGISTER_RATE_LIMIT_WINDOW_SECONDS', 3600)),
            int(current_app.config.get('REGISTER_RATE_LIMIT_MAX_FAILURES', 25)),
            int(current_app.config.get('REGISTER_RATE_LIMIT_BLOCK_SECONDS', 3600)),
        )
    if scope == REFRESH_THROTTLE_SCOPE:
        return (
            int(current_app.config.get('REFRESH_RATE_LIMIT_WINDOW_SECONDS', 60)),
            int(current_app.config.get('REFRESH_RATE_LIMIT_MAX_FAILURES', 45)),
            int(current_app.config.get('REFRESH_RATE_LIMIT_BLOCK_SECONDS', 300)),
        )
    return (900, 10, 900)


def _throttle_record(scope: str, subject: str, ip_address: str) -> SecurityThrottle | None:
    return SecurityThrottle.query.filter_by(
        scope=scope,
        subject=subject,
        ip_address=ip_address,
    ).first()


def _reset_expired_window(record: SecurityThrottle, now: datetime, window_seconds: int) -> bool:
    changed = False
    blocked_until = _ensure_utc(record.blocked_until)
    if blocked_until and blocked_until <= now:
        record.blocked_until = None
        changed = True
    window_started_at = _ensure_utc(record.window_started_at) or now
    if (now - window_started_at).total_seconds() > window_seconds:
        record.failed_count = 0
        record.window_started_at = now
        record.blocked_until = None
        changed = True
    return changed


def _throttle_allowed_db(scope: str, subject: str, normalized_ip: str) -> bool:
    now = datetime.now(UTC)
    record = _throttle_record(scope, subject, normalized_ip)
    if record is None:
        return True

    window_seconds, _, _ = _throttle_settings(scope)
    changed = _reset_expired_window(record, now, window_seconds)
    blocked_until = _ensure_utc(record.blocked_until)
    if blocked_until and blocked_until > now:
        if changed:
            db.session.flush()
        return False
    if changed:
        db.session.flush()
    return True


def throttle_allowed(scope: str, subject: str, ip_address: str | None = None) -> bool:
    normalized_ip = (ip_address or '').strip()[:64] or _request_ip()
    backend = str(current_app.config.get('THROTTLE_BACKEND') or 'dual').lower()

    redis_leg = True
    if backend in {'redis', 'dual'} and redis_available():
        redis_leg = throttle_redis.throttle_check_allowed(scope, subject, normalized_ip)
    elif backend == 'redis' and not redis_available():
        redis_leg = True

    db_leg = True
    if backend in {'db', 'dual'}:
        db_leg = _throttle_allowed_db(scope, subject, normalized_ip)

    if backend == 'redis':
        return redis_leg
    if backend == 'db':
        return db_leg
    if not redis_available():
        return db_leg
    return redis_leg and db_leg


def _register_throttle_failure_db(scope: str, subject: str, normalized_ip: str) -> bool:
    now = datetime.now(UTC)
    window_seconds, max_failures, block_seconds = _throttle_settings(scope)
    record = _throttle_record(scope, subject, normalized_ip)
    if record is None:
        record = SecurityThrottle(
            scope=scope,
            subject=subject,
            ip_address=normalized_ip,
            failed_count=0,
            window_started_at=now,
        )
        db.session.add(record)
    else:
        _reset_expired_window(record, now, window_seconds)

    if record.failed_count == 0:
        record.window_started_at = now
    record.failed_count += 1
    if record.failed_count >= max_failures:
        record.blocked_until = now + timedelta(seconds=block_seconds)
    db.session.flush()
    blocked_until = _ensure_utc(record.blocked_until)
    return blocked_until is None or blocked_until <= now


def register_throttle_failure(scope: str, subject: str, ip_address: str | None = None) -> bool:
    normalized_ip = (ip_address or '').strip()[:64] or _request_ip()
    backend = str(current_app.config.get('THROTTLE_BACKEND') or 'dual').lower()

    redis_still = True
    if backend in {'redis', 'dual'} and redis_available():
        redis_still = throttle_redis.throttle_register_failure(scope, subject, normalized_ip)

    db_still = True
    if backend in {'db', 'dual'}:
        db_still = _register_throttle_failure_db(scope, subject, normalized_ip)

    if backend == 'redis':
        return redis_still
    if backend == 'db':
        return db_still
    if not redis_available():
        return db_still
    return redis_still and db_still


def clear_throttle_failures(scope: str, subject: str, ip_address: str | None = None) -> None:
    normalized_ip = (ip_address or '').strip()[:64] or _request_ip()
    backend = str(current_app.config.get('THROTTLE_BACKEND') or 'dual').lower()
    if backend in {'redis', 'dual'}:
        throttle_redis.throttle_clear(scope, subject, normalized_ip)
    if backend in {'db', 'dual'}:
        record = _throttle_record(scope, subject, normalized_ip)
        if record is not None:
            db.session.delete(record)
            db.session.flush()


def login_attempt_allowed(login_identifier: str, ip_address: str | None = None) -> bool:
    return throttle_allowed(LOGIN_THROTTLE_SCOPE, login_identifier or 'unknown', ip_address)


def register_login_failure(login_identifier: str, ip_address: str | None = None) -> bool:
    return register_throttle_failure(LOGIN_THROTTLE_SCOPE, login_identifier or 'unknown', ip_address)


def clear_login_failures(login_identifier: str, ip_address: str | None = None) -> None:
    clear_throttle_failures(LOGIN_THROTTLE_SCOPE, login_identifier or 'unknown', ip_address)


def parent_access_allowed(ip_address: str | None = None) -> bool:
    return throttle_allowed(PARENT_ACCESS_THROTTLE_SCOPE, 'invite_lookup', ip_address)


def register_parent_access_failure(ip_address: str | None = None) -> bool:
    return register_throttle_failure(PARENT_ACCESS_THROTTLE_SCOPE, 'invite_lookup', ip_address)


def clear_parent_access_failures(ip_address: str | None = None) -> None:
    clear_throttle_failures(PARENT_ACCESS_THROTTLE_SCOPE, 'invite_lookup', ip_address)


def register_attempt_allowed(email: str, ip_address: str | None = None) -> bool:
    subject = (email or '').strip().lower() or 'unknown'
    return throttle_allowed(REGISTER_THROTTLE_SCOPE, subject, ip_address)


def register_register_failure(email: str, ip_address: str | None = None) -> bool:
    subject = (email or '').strip().lower() or 'unknown'
    return register_throttle_failure(REGISTER_THROTTLE_SCOPE, subject, ip_address)


def clear_register_throttle(email: str, ip_address: str | None = None) -> None:
    subject = (email or '').strip().lower() or 'unknown'
    clear_throttle_failures(REGISTER_THROTTLE_SCOPE, subject, ip_address)


def refresh_attempt_allowed(ip_address: str | None = None) -> bool:
    return throttle_allowed(REFRESH_THROTTLE_SCOPE, 'token_refresh', ip_address)


def register_refresh_failure(ip_address: str | None = None) -> bool:
    return register_throttle_failure(REFRESH_THROTTLE_SCOPE, 'token_refresh', ip_address)


def clear_refresh_throttle(ip_address: str | None = None) -> None:
    clear_throttle_failures(REFRESH_THROTTLE_SCOPE, 'token_refresh', ip_address)


def _session_version_redis_key(user_id: int) -> str:
    from .redis_client import redis_key

    return redis_key('session_ver', str(int(user_id)))


def get_cached_session_version(user_id: int) -> int | None:
    if current_app.config.get('SESSION_VERSION_CACHE') != 'redis':
        return None
    client = get_redis(Config.REDIS_DB_SESSION_VERSION)
    if client is None:
        return None
    try:
        raw = client.get(_session_version_redis_key(user_id))
        if raw is None:
            return None
        return int(raw)
    except (TypeError, ValueError, redis.ConnectionError, redis.TimeoutError, redis.ResponseError, OSError):
        return None


def set_cached_session_version(user_id: int, version: int) -> None:
    if current_app.config.get('SESSION_VERSION_CACHE') != 'redis':
        return
    client = get_redis(Config.REDIS_DB_SESSION_VERSION)
    if client is None:
        return
    try:
        client.setex(_session_version_redis_key(user_id), SESSION_VERSION_CACHE_TTL_SECONDS, str(int(version)))
    except (redis.ConnectionError, redis.TimeoutError, redis.ResponseError, OSError):
        pass


def invalidate_session_version_cache(user_id: int) -> None:
    client = get_redis(Config.REDIS_DB_SESSION_VERSION)
    if client is None:
        return
    try:
        client.delete(_session_version_redis_key(user_id))
    except (redis.ConnectionError, redis.TimeoutError, redis.ResponseError, OSError):
        pass


def create_access_token(user: User) -> str:
    now = datetime.now(UTC)
    session_version = int(user.session_version or 0)
    access_payload = {
        'sub': str(user.id),
        'role': user.role.value,
        'session_version': session_version,
        'type': 'access',
        'iat': int(now.timestamp()),
        'exp': int((now + timedelta(minutes=current_app.config['ACCESS_TOKEN_MINUTES'])).timestamp()),
    }
    return jwt.encode(access_payload, current_app.config['SECRET_KEY'], algorithm='HS256')


def create_token_pair(user: User) -> dict:
    now = datetime.now(UTC)
    session_version = int(user.session_version or 0)
    refresh_id = str(uuid4())
    refresh_payload = {
        'sub': str(user.id),
        'role': user.role.value,
        'session_version': session_version,
        'type': 'refresh',
        'jti': refresh_id,
        'iat': int(now.timestamp()),
        'exp': int((now + timedelta(days=current_app.config['REFRESH_TOKEN_DAYS'])).timestamp()),
    }
    access_token = create_access_token(user)
    refresh_token = jwt.encode(refresh_payload, current_app.config['SECRET_KEY'], algorithm='HS256')

    db.session.add(
        RefreshToken(
            user_id=user.id,
            token_id=refresh_id,
            expires_at=now + timedelta(days=current_app.config['REFRESH_TOKEN_DAYS']),
        )
    )
    db.session.flush()
    return {'access_token': access_token, 'refresh_token': refresh_token}


def decode_token(token: str) -> dict:
    return jwt.decode(token, current_app.config['SECRET_KEY'], algorithms=['HS256'])


def _decode_token_without_verification(token: str) -> dict:
    return jwt.decode(
        token,
        options={'verify_signature': False, 'verify_exp': False},
        algorithms=['HS256'],
    )


def _token_max_age(token: str, fallback_seconds: int) -> int:
    try:
        payload = _decode_token_without_verification(token)
    except Exception:
        return fallback_seconds
    exp = payload.get('exp')
    if not isinstance(exp, int):
        return fallback_seconds
    return max(exp - int(datetime.now(UTC).timestamp()), 0)


def _token_expiration(token: str) -> int | None:
    try:
        payload = _decode_token_without_verification(token)
    except Exception:
        return None
    exp = payload.get('exp')
    return exp if isinstance(exp, int) else None


def _payload_session_version(payload: dict) -> int | None:
    raw_value = payload.get('session_version', 0)
    try:
        return int(raw_value)
    except (TypeError, ValueError):
        return None


def token_matches_user_session(payload: dict, user: User) -> bool:
    session_version = _payload_session_version(payload)
    if session_version is None:
        return False
    if current_app.config.get('SESSION_VERSION_CACHE') == 'redis':
        cached = get_cached_session_version(user.id)
        if cached is not None:
            return session_version == cached
    db_version = int(user.session_version or 0)
    ok = session_version == db_version
    if ok and current_app.config.get('SESSION_VERSION_CACHE') == 'redis':
        set_cached_session_version(user.id, db_version)
    return ok


def teacher_approval_auth_error(user: User) -> tuple[dict, int] | None:
    if user.role != UserRole.TEACHER:
        return None
    status = user.teacher_approval_status or TEACHER_APPROVAL_APPROVED
    if status == TEACHER_APPROVAL_APPROVED:
        return None
    if status == TEACHER_APPROVAL_PENDING:
        return {
            'message': 'Заявка учителя ещё ожидает подтверждения администратора.',
            'code': 'teacher_approval_pending',
        }, 401
    return {
        'message': 'Заявка учителя отклонена. Обратитесь к администратору.',
        'code': 'teacher_approval_rejected',
    }, 401


def _cookie_security_settings() -> tuple[bool, str]:
    secure = bool(current_app.config.get('SESSION_COOKIE_SECURE', current_app.config.get('IS_PRODUCTION', False)))
    same_site = current_app.config.get('SESSION_COOKIE_SAMESITE', 'Lax')
    return secure, same_site


def issue_csrf_cookie(response: Response) -> Response:
    secure, _ = _cookie_security_settings()
    response.set_cookie(
        CSRF_COOKIE_NAME,
        secrets.token_urlsafe(32),
        httponly=False,
        secure=secure,
        samesite='Lax',
        path='/',
    )
    return response


def clear_csrf_cookie(response: Response) -> Response:
    secure, _ = _cookie_security_settings()
    response.delete_cookie(CSRF_COOKIE_NAME, path='/', secure=secure, samesite='Lax')
    return response


def request_uses_cookie_auth() -> bool:
    access_token = (request.cookies.get(ACCESS_COOKIE_NAME) or '').strip()
    refresh_token = (request.cookies.get(REFRESH_COOKIE_NAME) or '').strip()
    return bool(access_token or refresh_token)


def verify_csrf_token() -> bool:
    csrf_cookie = (request.cookies.get(CSRF_COOKIE_NAME) or '').strip()
    csrf_header = (request.headers.get(CSRF_HEADER_NAME) or '').strip()
    if not csrf_cookie or not csrf_header:
        return False
    return hmac.compare_digest(csrf_cookie, csrf_header)


def set_access_cookie(response: Response, access_token: str) -> Response:
    secure, same_site = _cookie_security_settings()
    access_cookie_max_age = _token_max_age(access_token, int(current_app.config['ACCESS_TOKEN_MINUTES']) * 60)
    access_expires_at = _token_expiration(access_token)
    response.set_cookie(
        ACCESS_COOKIE_NAME,
        access_token,
        max_age=access_cookie_max_age,
        httponly=True,
        secure=secure,
        samesite=same_site,
        path='/',
    )
    response.set_cookie(
        ACCESS_EXPIRES_AT_COOKIE_NAME,
        str(access_expires_at or ''),
        max_age=access_cookie_max_age,
        secure=secure,
        samesite=same_site,
        path='/',
    )
    return issue_csrf_cookie(response)


def set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> Response:
    secure, same_site = _cookie_security_settings()
    refresh_cookie_max_age = _token_max_age(refresh_token, int(current_app.config['REFRESH_TOKEN_DAYS']) * 24 * 60 * 60)
    response = set_access_cookie(response, access_token)
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        refresh_token,
        max_age=refresh_cookie_max_age,
        httponly=True,
        secure=secure,
        samesite=same_site,
        path='/',
    )
    return response


def clear_auth_cookies(response: Response) -> Response:
    secure, same_site = _cookie_security_settings()
    response.delete_cookie(ACCESS_COOKIE_NAME, path='/', secure=secure, httponly=True, samesite=same_site)
    response.delete_cookie(REFRESH_COOKIE_NAME, path='/', secure=secure, httponly=True, samesite=same_site)
    response.delete_cookie(ACCESS_EXPIRES_AT_COOKIE_NAME, path='/', secure=secure, samesite=same_site)
    return clear_csrf_cookie(response)


def access_token_from_request() -> str:
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        return auth_header.removeprefix('Bearer ').strip()
    return (request.cookies.get(ACCESS_COOKIE_NAME) or '').strip()


def refresh_token_from_request() -> str:
    return (request.cookies.get(REFRESH_COOKIE_NAME) or '').strip()


def revoke_refresh_token(refresh_token: str | None) -> None:
    token_value = (refresh_token or '').strip()
    if not token_value:
        return
    try:
        payload = decode_token(token_value)
    except Exception:
        return
    token = RefreshToken.query.filter_by(token_id=payload.get('jti')).first()
    if token:
        db.session.delete(token)
        db.session.flush()


def revoke_refresh_tokens_for_user(user_id: int, *, exclude_token_id: str | None = None) -> int:
    query = RefreshToken.query.filter_by(user_id=user_id)
    if exclude_token_id:
        query = query.filter(RefreshToken.token_id != exclude_token_id)

    tokens = query.all()
    for token in tokens:
        db.session.delete(token)
    if tokens:
        db.session.flush()
    return len(tokens)


def request_origin_allowed() -> bool:
    origin = (request.headers.get('Origin') or '').strip()
    if not origin:
        return True

    allowed_origins = {
        item.strip()
        for item in (current_app.config.get('CLIENT_URL') or '').split(',')
        if item.strip()
    }
    if not allowed_origins:
        return True

    normalized_origin = urlparse(origin)
    origin_value = f'{normalized_origin.scheme}://{normalized_origin.netloc}'
    return origin_value in allowed_origins


def auth_required(roles: list[UserRole] | None = None) -> Callable:
    def decorator(func: Callable):
        @wraps(func)
        def wrapper(*args, **kwargs):
            token = access_token_from_request()
            if not token:
                return {'message': 'Missing session token'}, 401
            try:
                payload = decode_token(token)
                if payload.get('type') != 'access':
                    raise ValueError('Not access token')
                if current_app.config.get('SESSION_VERSION_CACHE') == 'redis' and redis_available():
                    try:
                        sub_id = int(payload['sub'])
                    except (TypeError, ValueError):
                        sub_id = None
                    if sub_id is not None:
                        cached = get_cached_session_version(sub_id)
                        token_ver = _payload_session_version(payload)
                        if cached is not None and token_ver is not None and cached != token_ver:
                            return {'message': 'Сессия была отозвана. Войдите снова.', 'code': 'session_revoked'}, 401
                user = db.session.get(User, int(payload['sub']))
            except Exception:
                return {'message': 'Недействительный токен сессии.', 'code': 'invalid_token'}, 401

            if not user:
                return {'message': 'Сессия больше недействительна.', 'code': 'session_revoked'}, 401
            teacher_approval_error = teacher_approval_auth_error(user)
            if teacher_approval_error:
                return teacher_approval_error
            if not user.is_active:
                return {'message': 'Пользователь заблокирован.', 'code': 'user_blocked'}, 401
            if not token_matches_user_session(payload, user):
                return {'message': 'Сессия была отозвана. Войдите снова.', 'code': 'session_revoked'}, 401
            if roles and user.role not in roles:
                return {'message': 'Forbidden'}, 403
            return func(user, *args, **kwargs)

        return wrapper

    return decorator
