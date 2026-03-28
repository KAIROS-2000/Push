from __future__ import annotations

from datetime import UTC, datetime, timedelta
from functools import wraps
from uuid import uuid4

import jwt
from flask import current_app, request
from werkzeug.security import check_password_hash, generate_password_hash

from ..core.db import db
from ..models.user import RefreshToken, User, UserRole

_LOGIN_ATTEMPTS: dict[str, list[datetime]] = {}


def hash_password(password: str) -> str:
    return generate_password_hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return check_password_hash(password_hash, password)


def password_has_whitespace(password: str) -> bool:
    return any(char.isspace() for char in password)


def validate_password(password: str, minimum_length: int = 6) -> str | None:
    if len(password) < minimum_length:
        return f'Пароль должен содержать не менее {minimum_length} символов.'
    if password_has_whitespace(password):
        return 'Пароль не должен содержать пробелы.'
    return None


def password_strength(password: str) -> str:
    score = 0
    score += len(password) >= 6
    score += any(char.isdigit() for char in password)
    score += any(char.isupper() for char in password)
    score += any(char in '!@#$%^&*()-_=+[]{}' for char in password)
    return ['weak', 'weak', 'medium', 'strong', 'strong'][score]


def register_failed_attempt(ip: str) -> bool:
    now = datetime.now(UTC)
    attempts = [item for item in _LOGIN_ATTEMPTS.get(ip, []) if (now - item).seconds < 60]
    attempts.append(now)
    _LOGIN_ATTEMPTS[ip] = attempts
    return len(attempts) <= 5


def create_token_pair(user: User) -> dict:
    now = datetime.now(UTC)
    access_payload = {
        'sub': str(user.id),
        'role': user.role.value,
        'type': 'access',
        'iat': int(now.timestamp()),
        'exp': int((now + timedelta(minutes=current_app.config['ACCESS_TOKEN_MINUTES'])).timestamp()),
    }
    refresh_id = str(uuid4())
    refresh_payload = {
        'sub': str(user.id),
        'role': user.role.value,
        'type': 'refresh',
        'jti': refresh_id,
        'iat': int(now.timestamp()),
        'exp': int((now + timedelta(days=current_app.config['REFRESH_TOKEN_DAYS'])).timestamp()),
    }
    access_token = jwt.encode(access_payload, current_app.config['SECRET_KEY'], algorithm='HS256')
    refresh_token = jwt.encode(refresh_payload, current_app.config['SECRET_KEY'], algorithm='HS256')

    db.session.add(
        RefreshToken(
            user_id=user.id,
            token_id=refresh_id,
            expires_at=now + timedelta(days=current_app.config['REFRESH_TOKEN_DAYS']),
        )
    )
    db.session.commit()
    return {'access_token': access_token, 'refresh_token': refresh_token}


def decode_token(token: str) -> dict:
    return jwt.decode(token, current_app.config['SECRET_KEY'], algorithms=['HS256'])


def revoke_refresh_token(refresh_token: str) -> None:
    try:
        payload = decode_token(refresh_token)
    except Exception:
        return
    token = RefreshToken.query.filter_by(token_id=payload.get('jti')).first()
    if token:
        db.session.delete(token)
        db.session.commit()


def auth_required(roles: list[UserRole] | None = None):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            auth_header = request.headers.get('Authorization', '')
            if not auth_header.startswith('Bearer '):
                return {'message': 'Missing bearer token'}, 401
            try:
                payload = decode_token(auth_header.removeprefix('Bearer ').strip())
                if payload.get('type') != 'access':
                    raise ValueError('Not access token')
                user = User.query.get(int(payload['sub']))
            except Exception:
                return {'message': 'Invalid token'}, 401

            if not user or not user.is_active:
                return {'message': 'User not found or blocked'}, 403
            if roles and user.role not in roles:
                return {'message': 'Forbidden'}, 403
            return func(user, *args, **kwargs)

        return wrapper

    return decorator
