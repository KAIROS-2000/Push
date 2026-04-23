from __future__ import annotations

import re

from flask import Blueprint, make_response, request

from ..core.achievements import sync_achievements_for_user
from ..core.db import db
from ..core.security import (
    auth_required,
    clear_auth_cookies,
    clear_login_failures,
    create_token_pair,
    decode_token,
    hash_password,
    login_attempt_allowed,
    password_strength,
    refresh_token_from_request,
    register_login_failure,
    set_auth_cookies,
    revoke_refresh_token,
    token_matches_user_session,
    validate_password,
    verify_password,
)
from ..models.user import RefreshToken, User, UserRole, USERNAME_MAX_LENGTH


auth_bp = Blueprint('auth', __name__)
EMAIL_RE = re.compile(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
VALID_AGE_GROUPS = {'junior', 'middle', 'senior'}


def is_valid_email(value: str) -> bool:
    return bool(EMAIL_RE.fullmatch(value))


def normalize_age_group(value: str | None) -> str | None:
    normalized = (value or '').strip().lower()
    return normalized if normalized in VALID_AGE_GROUPS else None


@auth_bp.get('/options')
def register_options():
    return {
        'roles': [UserRole.STUDENT.value, UserRole.TEACHER.value],
        'age_groups': sorted(VALID_AGE_GROUPS),
    }


@auth_bp.post('/register')
def register():
    data = request.get_json() or {}
    email = (data.get('email') or '').strip().lower()
    username = (data.get('username') or '').strip().lower()
    password = data.get('password') or ''
    role = data.get('role', UserRole.STUDENT.value)
    age_group = normalize_age_group(data.get('age_group'))
    password_error = validate_password(password)

    if role not in {UserRole.STUDENT.value, UserRole.TEACHER.value}:
        return {'message': 'Самостоятельная регистрация доступна только ученикам и учителям.'}, 400
    if not email or not username or not password:
        return {'message': 'Заполните email, username и пароль.'}, 400
    if len(username) > USERNAME_MAX_LENGTH:
        return {'message': f'Логин должен содержать не более {USERNAME_MAX_LENGTH} символов.'}, 400
    if password_error:
        return {'message': password_error}, 400
    if not is_valid_email(email):
        return {'message': 'Укажите корректный email.'}, 400
    if role == UserRole.STUDENT.value and not age_group:
        return {'message': 'Выберите возрастную группу ученика.'}, 400
    if User.query.filter((User.email == email) | (User.username == username)).first():
        return {'message': 'Пользователь с таким email или username уже существует.'}, 409

    user = User(
        full_name=data.get('full_name') or username,
        username=username,
        email=email,
        password_hash=hash_password(password),
        role=UserRole(role),
        age_group=age_group if role == UserRole.STUDENT.value else None,
        theme=data.get('theme') or 'light',
    )
    user.touch_login()
    db.session.add(user)
    db.session.flush()
    tokens = create_token_pair(user)
    db.session.commit()
    response = make_response({
        'message': 'Регистрация успешна',
        'password_strength': password_strength(password),
        'user': user.to_dict(),
    }, 201)
    return set_auth_cookies(response, tokens['access_token'], tokens['refresh_token'])


@auth_bp.post('/login')
def login():
    ip = request.remote_addr or 'unknown'
    data = request.get_json() or {}
    login_value = (data.get('login') or data.get('email') or data.get('username') or '').strip().lower()
    if login_value and not login_attempt_allowed(login_value, ip):
        return {'message': 'Слишком много попыток входа. Повторите через минуту.'}, 429

    password = data.get('password') or ''
    if not login_value or not password:
        return {'message': 'Укажите email или username и пароль.'}, 400
    user = User.query.filter((User.email == login_value) | (User.username == login_value)).first()
    if not user or not verify_password(password, user.password_hash):
        register_login_failure(login_value or 'unknown', ip)
        db.session.commit()
        return {'message': 'Неверный логин или пароль.'}, 401
    if not user.is_active:
        register_login_failure(login_value, ip)
        db.session.commit()
        return {'message': 'Пользователь заблокирован.'}, 403

    clear_login_failures(login_value, ip)
    user.touch_login()
    sync_achievements_for_user(user)
    tokens = create_token_pair(user)
    db.session.commit()
    response = make_response({'message': 'Вход выполнен', 'user': user.to_dict()})
    return set_auth_cookies(response, tokens['access_token'], tokens['refresh_token'])


@auth_bp.post('/refresh')
def refresh():
    token = ((request.get_json(silent=True) or {}).get('refresh_token') or refresh_token_from_request()).strip()
    try:
        payload = decode_token(token)
        if payload.get('type') != 'refresh':
            raise ValueError('Wrong token type')
    except Exception:
        return {'message': 'Недействительный refresh token'}, 401

    refresh_row = RefreshToken.query.filter_by(token_id=payload.get('jti')).first()
    user = db.session.get(User, int(payload['sub'])) if payload.get('sub') else None
    if not refresh_row or not user:
        return {'message': 'Refresh token отозван или пользователь недоступен', 'code': 'session_revoked'}, 401
    if not user.is_active:
        db.session.delete(refresh_row)
        db.session.commit()
        return {'message': 'Пользователь заблокирован.', 'code': 'user_blocked'}, 401
    if not token_matches_user_session(payload, user):
        db.session.delete(refresh_row)
        db.session.commit()
        return {'message': 'Refresh token отозван или пользователь недоступен', 'code': 'session_revoked'}, 401

    db.session.delete(refresh_row)
    tokens = create_token_pair(user)
    db.session.commit()
    response = make_response({'user': user.to_dict()})
    return set_auth_cookies(response, tokens['access_token'], tokens['refresh_token'])


@auth_bp.post('/logout')
def logout():
    token = ((request.get_json(silent=True) or {}).get('refresh_token') or refresh_token_from_request()).strip()
    revoke_refresh_token(token)
    db.session.commit()
    response = make_response({'message': 'Сессия завершена'})
    return clear_auth_cookies(response)


@auth_bp.get('/me')
@auth_required()
def me(current_user: User):
    return {'user': current_user.to_dict()}
