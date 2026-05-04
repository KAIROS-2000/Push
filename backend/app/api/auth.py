from __future__ import annotations

import logging
import re
from datetime import UTC, datetime

from flask import Blueprint, make_response, request

from ..core.achievements import sync_achievements_for_user
from ..core.db import db
from ..core.phone import (
    is_valid_russian_phone,
    normalize_russian_phone,
    phone_validation_message,
)
from ..core.security import (
    auth_required,
    clear_auth_cookies,
    clear_login_failures,
    clear_refresh_throttle,
    clear_register_throttle,
    create_token_pair,
    create_access_token,
    decode_token,
    generate_initial_password,
    hash_password,
    invalidate_session_version_cache,
    login_attempt_allowed,
    password_reset_attempt_allowed,
    password_strength,
    refresh_attempt_allowed,
    refresh_token_from_request,
    register_ip_attempt_allowed,
    register_login_failure,
    register_password_reset_attempt,
    register_refresh_failure,
    register_register_ip_attempt,
    register_register_failure,
    register_attempt_allowed,
    register_resend_verification_attempt,
    resend_verification_attempt_allowed,
    revoke_refresh_tokens_for_user,
    set_auth_cookies,
    set_access_cookie,
    revoke_refresh_token,
    token_matches_user_session,
    validate_password,
    verify_password,
)
from ..models.user import (
    EMAIL_TOKEN_PURPOSE_PASSWORD_RESET,
    EMAIL_TOKEN_PURPOSE_VERIFICATION,
    TEACHER_APPROVAL_APPROVED,
    TEACHER_APPROVAL_PENDING,
    RefreshToken,
    User,
    UserRole,
)
from ..services.email_service import (
    EmailServiceError,
    send_parent_welcome_email,
    send_password_reset_email,
    send_verification_email,
)
from ..services.email_tokens import (
    cleanup_expired_unverified_users,
    consume_token,
    delete_unverified_user_if_verification_expired,
    invalidate_active_tokens,
    issue_password_reset_token,
    issue_verification_token,
)
from ..services.teacher_approval_service import cleanup_expired_teacher_requests

_log = logging.getLogger(__name__)


auth_bp = Blueprint('auth', __name__)
EMAIL_RE = re.compile(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
VALID_AGE_GROUPS = {'junior', 'middle', 'senior'}


def is_valid_email(value: str) -> bool:
    return bool(EMAIL_RE.fullmatch(value))


def normalize_age_group(value: str | None) -> str | None:
    normalized = (value or '').strip().lower()
    return normalized if normalized in VALID_AGE_GROUPS else None


def _cleanup_expired_auth_accounts() -> int:
    deleted = cleanup_expired_teacher_requests()
    deleted += cleanup_expired_unverified_users()
    if deleted:
        db.session.commit()
    return deleted


@auth_bp.get('/options')
def register_options():
    return {
        'roles': [UserRole.STUDENT.value, UserRole.TEACHER.value, UserRole.PARENT.value],
        'age_groups': sorted(VALID_AGE_GROUPS),
    }


@auth_bp.post('/register')
def register():
    """Self-registration entry point.

    Three distinct sub-flows (selected by `role` in the body):

    * **student** — email + phone + password. NO session is created. The user
      must verify their email via the link from the welcome letter and only
      then can log in. We deliberately mirror the teacher flow here so
      "verified email" is a real precondition for entering the cabinet.
    * **teacher** — email + phone + password. NO session, status `pending`,
      admin must approve. Email verification still required at login.
    * **parent** — ONLY email is accepted. The backend generates a strong
      random password, persists its hash, sends a single welcome email
      containing both the password and the verification link, and creates a
      session immediately so the parent can browse the cabinet right away.
      Phone, full name and email verification are required only at the
      moment the parent tries to attach a child (enforced in the
      parent_cabinet API).
    """

    ip = request.remote_addr or 'unknown'
    data = request.get_json() or {}
    email = (data.get('email') or '').strip().lower()
    role = data.get('role', UserRole.STUDENT.value)

    if not register_ip_attempt_allowed(ip):
        return {'message': 'Слишком много попыток регистрации. Повторите позже.'}, 429
    register_register_ip_attempt(ip)
    if not register_attempt_allowed(email or 'unknown', ip):
        db.session.commit()
        return {'message': 'Слишком много попыток регистрации. Повторите позже.'}, 429

    if role not in {UserRole.STUDENT.value, UserRole.TEACHER.value, UserRole.PARENT.value}:
        register_register_failure(email, ip)
        db.session.commit()
        return {
            'message': 'Самостоятельная регистрация доступна только ученикам, учителям и родителям.',
        }, 400

    if not email or not is_valid_email(email):
        register_register_failure(email, ip)
        db.session.commit()
        return {'message': 'Укажите корректный email.'}, 400

    _cleanup_expired_auth_accounts()

    if role == UserRole.PARENT.value:
        return _register_parent(email, data, ip)
    return _register_student_or_teacher(email, role, data, ip)


def _register_student_or_teacher(email: str, role: str, data: dict, ip: str):
    phone = normalize_russian_phone(data.get('phone'))
    password = data.get('password') or ''
    age_group = normalize_age_group(data.get('age_group'))
    password_error = validate_password(password)

    if not password or not (data.get('phone') or '').strip():
        register_register_failure(email, ip)
        db.session.commit()
        return {'message': 'Укажите email, пароль и номер телефона.'}, 400
    if not is_valid_russian_phone(phone):
        register_register_failure(email, ip)
        db.session.commit()
        return {'message': phone_validation_message()}, 400
    if password_error:
        register_register_failure(email, ip)
        db.session.commit()
        return {'message': password_error}, 400
    if role == UserRole.STUDENT.value and not age_group:
        register_register_failure(email, ip)
        db.session.commit()
        return {'message': 'Выберите возрастную группу ученика.'}, 400
    if User.query.filter(User.email == email).first():
        register_register_failure(email, ip)
        db.session.commit()
        return {'message': 'Пользователь с таким email уже существует.'}, 409
    if User.query.filter_by(phone=phone).first():
        register_register_failure(email, ip)
        db.session.commit()
        return {'message': 'Пользователь с таким номером телефона уже зарегистрирован.'}, 409

    is_teacher_registration = role == UserRole.TEACHER.value
    requested_theme = data.get('theme') if data.get('theme') in {'light', 'dark'} else 'light'
    user = User(
        full_name=data.get('full_name') or '',
        email=email,
        phone=phone,
        password_hash=hash_password(password),
        role=UserRole(role),
        age_group=age_group if role == UserRole.STUDENT.value else None,
        theme=requested_theme,
        is_active=not is_teacher_registration,
        teacher_approval_status=TEACHER_APPROVAL_PENDING
        if is_teacher_registration
        else TEACHER_APPROVAL_APPROVED,
        email_verified=False,
        password_changed_at=datetime.now(UTC),
    )
    db.session.add(user)
    db.session.flush()

    issued = issue_verification_token(user)
    verification_email_sent = _try_send_verification_email(user, issued.raw_token)
    clear_register_throttle(email, ip)
    db.session.commit()

    if is_teacher_registration:
        return {
            'message': 'Заявка учителя отправлена администратору. После одобрения подтвердите email — мы прислали ссылку.',
            'status': TEACHER_APPROVAL_PENDING,
            'teacher_request': user.to_dict(),
            'verification_email_sent': verification_email_sent,
            'requires_email_verification': True,
        }, 201

    # Student: NO session — user must verify email before logging in.
    return {
        'message': 'Регистрация успешна. Подтвердите email по ссылке из письма, чтобы войти.',
        'password_strength': password_strength(password),
        'user': user.to_dict(),
        'verification_email_sent': verification_email_sent,
        'requires_email_verification': True,
        'requires_login_after_verification': True,
    }, 201


def _register_parent(email: str, data: dict, ip: str):
    """Parent: email-only signup, instant session, password delivered by email."""

    if User.query.filter(User.email == email).first():
        register_register_failure(email, ip)
        db.session.commit()
        return {'message': 'Пользователь с таким email уже существует.'}, 409

    initial_password = generate_initial_password()
    requested_theme = data.get('theme') if data.get('theme') in {'light', 'dark'} else 'light'
    user = User(
        full_name='',  # parent fills name later, before linking a child
        email=email,
        phone=None,
        password_hash=hash_password(initial_password),
        role=UserRole.PARENT,
        age_group=None,
        theme=requested_theme,
        is_active=True,
        teacher_approval_status=TEACHER_APPROVAL_APPROVED,
        email_verified=False,
        password_changed_at=datetime.now(UTC),
    )
    db.session.add(user)
    db.session.flush()

    issued = issue_verification_token(user)
    welcome_sent = _try_send_parent_welcome_email(user, initial_password, issued.raw_token)

    user.touch_login()
    tokens = create_token_pair(user)
    clear_register_throttle(email, ip)
    db.session.commit()

    response = make_response(
        {
            'message': (
                'Семейный кабинет создан. Мы отправили на почту временный пароль и ссылку '
                'для подтверждения email. Подтвердите почту, заполните имя и телефон — '
                'и сможете привязать ребёнка.'
            ),
            'user': user.to_dict(),
            'verification_email_sent': welcome_sent,
            'requires_email_verification': True,
            'parent_initial_password_sent': welcome_sent,
            # Frontend uses this to build the "complete profile" prompt before
            # the parent can attach a child.
            'parent_profile_required_fields': ['full_name', 'phone', 'email_verified'],
        },
        201,
    )
    return set_auth_cookies(response, tokens['access_token'], tokens['refresh_token'])


def _try_send_verification_email(user: User, raw_token: str) -> bool:
    """Best-effort send: failures must not break registration.

    The token row is already persisted, so the user can request a fresh
    delivery via /auth/resend-verification. We log the failure (without the
    raw token) so operators can see why delivery is failing.
    """

    try:
        send_verification_email(user, raw_token)
        return True
    except EmailServiceError as exc:
        _log.warning(
            'verification_email_send_failed user_id=%s error=%s',
            user.id,
            exc,
        )
        return False
    except Exception:  # noqa: BLE001
        _log.exception('verification_email_unexpected_failure user_id=%s', user.id)
        return False


def _try_send_parent_welcome_email(user: User, raw_password: str, raw_token: str) -> bool:
    try:
        send_parent_welcome_email(user, raw_password, raw_token)
        return True
    except EmailServiceError as exc:
        _log.warning(
            'parent_welcome_email_send_failed user_id=%s error=%s',
            user.id,
            exc,
        )
        return False
    except Exception:  # noqa: BLE001
        _log.exception('parent_welcome_email_unexpected_failure user_id=%s', user.id)
        return False


def _try_send_password_reset_email(user: User, raw_token: str) -> bool:
    try:
        send_password_reset_email(user, raw_token)
        return True
    except EmailServiceError as exc:
        _log.warning(
            'password_reset_email_send_failed user_id=%s error=%s',
            user.id,
            exc,
        )
        return False
    except Exception:  # noqa: BLE001
        _log.exception('password_reset_email_unexpected_failure user_id=%s', user.id)
        return False


@auth_bp.post('/login')
def login():
    ip = request.remote_addr or 'unknown'
    data = request.get_json() or {}
    login_value = (data.get('login') or data.get('email') or '').strip().lower()
    if login_value and not login_attempt_allowed(login_value, ip):
        return {'message': 'Слишком много попыток входа. Повторите через минуту.'}, 429

    password = data.get('password') or ''
    if not login_value or not password:
        return {'message': 'Укажите email и пароль.'}, 400
    _cleanup_expired_auth_accounts()
    user = User.query.filter(User.email == login_value).first()
    if not user or not verify_password(password, user.password_hash):
        register_login_failure(login_value or 'unknown', ip)
        db.session.commit()
        return {'message': 'Неверный email или пароль.'}, 401
    teacher_approval_status = user.teacher_approval_status or TEACHER_APPROVAL_APPROVED
    if user.role == UserRole.TEACHER and teacher_approval_status != TEACHER_APPROVAL_APPROVED:
        if teacher_approval_status == TEACHER_APPROVAL_PENDING:
            return {
                'message': 'Заявка учителя ещё ожидает подтверждения администратора.',
                'code': 'teacher_approval_pending',
            }, 403
        return {
            'message': 'Заявка учителя отклонена. Обратитесь к администратору.',
            'code': 'teacher_approval_rejected',
        }, 403
    if not user.is_active:
        register_login_failure(login_value, ip)
        db.session.commit()
        return {'message': 'Пользователь заблокирован.'}, 403

    # Email verification gate: students and teachers cannot log in until they
    # confirm their email via the link from the welcome letter. Parents are
    # exempt — they enter the cabinet immediately on signup; verification is
    # enforced later at the "attach a child" step.
    if (
        user.role in {UserRole.STUDENT, UserRole.TEACHER}
        and not user.email_verified
    ):
        # Don't burn the rate-limit counter for an unverified-email response —
        # this is a self-inflicted-by-design state, not a brute-force signal.
        return {
            'message': (
                'Email не подтверждён. Откройте письмо подтверждения или запросите '
                'отправку повторно.'
            ),
            'code': 'email_not_verified',
            'email': user.email,
        }, 403

    clear_login_failures(login_value, ip)
    user.touch_login()
    sync_achievements_for_user(user)
    tokens = create_token_pair(user)
    db.session.commit()
    response = make_response({'message': 'Вход выполнен', 'user': user.to_dict()})
    return set_auth_cookies(response, tokens['access_token'], tokens['refresh_token'])


@auth_bp.post('/refresh')
def refresh():
    ip = request.remote_addr or 'unknown'
    if not refresh_attempt_allowed(ip):
        return {'message': 'Слишком много запросов обновления сессии. Подождите немного.'}, 429
    _cleanup_expired_auth_accounts()
    token = ((request.get_json(silent=True) or {}).get('refresh_token') or refresh_token_from_request()).strip()
    try:
        payload = decode_token(token)
        if payload.get('type') != 'refresh':
            raise ValueError('Wrong token type')
    except Exception:
        register_refresh_failure(ip)
        db.session.commit()
        return {'message': 'Недействительный refresh token'}, 401

    refresh_row = RefreshToken.query.filter_by(token_id=payload.get('jti')).first()
    user = db.session.get(User, int(payload['sub'])) if payload.get('sub') else None
    if not refresh_row or not user:
        register_refresh_failure(ip)
        db.session.commit()
        return {'message': 'Refresh token отозван или пользователь недоступен', 'code': 'session_revoked'}, 401
    teacher_approval_status = user.teacher_approval_status or TEACHER_APPROVAL_APPROVED
    if user.role == UserRole.TEACHER and teacher_approval_status != TEACHER_APPROVAL_APPROVED:
        db.session.delete(refresh_row)
        register_refresh_failure(ip)
        db.session.commit()
        if teacher_approval_status == TEACHER_APPROVAL_PENDING:
            return {'message': 'Заявка учителя ещё ожидает подтверждения администратора.', 'code': 'teacher_approval_pending'}, 401
        return {'message': 'Заявка учителя отклонена.', 'code': 'teacher_approval_rejected'}, 401
    if not user.is_active:
        db.session.delete(refresh_row)
        register_refresh_failure(ip)
        db.session.commit()
        return {'message': 'Пользователь заблокирован.', 'code': 'user_blocked'}, 401
    if (
        user.role in {UserRole.STUDENT, UserRole.TEACHER}
        and not user.email_verified
    ):
        # Defence-in-depth: even if a student/teacher somehow obtained refresh
        # cookies (e.g. legacy session predating the verify-on-login gate),
        # refusing to mint a new access token forces them through verification.
        db.session.delete(refresh_row)
        db.session.commit()
        return {
            'message': 'Email не подтверждён. Подтвердите почту, чтобы продолжить.',
            'code': 'email_not_verified',
        }, 401
    if not token_matches_user_session(payload, user):
        db.session.delete(refresh_row)
        register_refresh_failure(ip)
        db.session.commit()
        return {'message': 'Refresh token отозван или пользователь недоступен', 'code': 'session_revoked'}, 401

    access_token = create_access_token(user)
    clear_refresh_throttle(ip)
    db.session.commit()
    response = make_response({'user': user.to_dict()})
    return set_access_cookie(response, access_token)


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


# ---------------------------------------------------------------------------
# Email verification
# ---------------------------------------------------------------------------


_FORGOT_PASSWORD_NEUTRAL_RESPONSE = {
    'message': (
        'Если аккаунт с такой почтой существует, мы отправили письмо '
        'для сброса пароля. Проверьте папку «Спам» — иногда оно попадает туда.'
    ),
}


@auth_bp.post('/verify-email')
def verify_email():
    data = request.get_json(silent=True) or {}
    raw_token = (data.get('token') or '').strip()
    if not raw_token:
        return {'message': 'Не передан токен подтверждения.', 'code': 'invalid_token'}, 400

    result = consume_token(raw_token, EMAIL_TOKEN_PURPOSE_VERIFICATION)
    if result.error == 'invalid_token':
        return {
            'message': 'Ссылка для подтверждения недействительна. Запросите новое письмо.',
            'code': 'invalid_token',
        }, 400
    if result.error == 'used_token':
        # Treat as success when the email is already verified — links can be
        # opened twice (e.g. user re-clicks). We never reveal "you used it".
        if result.user and result.user.email_verified:
            return {
                'message': 'Email уже подтверждён.',
                'already_verified': True,
                'user': result.user.to_dict(),
            }
        return {
            'message': 'Эта ссылка уже использовалась. Запросите новое письмо.',
            'code': 'used_token',
        }, 400
    if result.error == 'expired_token':
        deleted = delete_unverified_user_if_verification_expired(result.user)
        db.session.commit()
        return {
            'message': (
                'Срок действия ссылки истёк. Аккаунт удалён — зарегистрируйтесь заново.'
                if deleted
                else 'Срок действия ссылки истёк. Запросите новое письмо.'
            ),
            'code': 'expired_token',
            'account_deleted': deleted,
        }, 400
    if result.error == 'user_unavailable' or result.user is None:
        return {
            'message': 'Аккаунт недоступен. Обратитесь в поддержку.',
            'code': 'user_unavailable',
        }, 400

    user = result.user
    if not user.email_verified:
        user.email_verified = True
        user.email_verified_at = datetime.now(UTC)
    user.touch_login()
    sync_achievements_for_user(user)
    tokens = create_token_pair(user)
    db.session.commit()
    response = make_response({
        'message': 'Email подтверждён. Вход выполнен.',
        'user': user.to_dict(),
        'authenticated': True,
    })
    return set_auth_cookies(response, tokens['access_token'], tokens['refresh_token'])


@auth_bp.post('/resend-verification')
def resend_verification():
    """Issue and send a fresh verification token.

    Accepts either an authenticated session OR a raw email in the body.
    To avoid revealing which emails exist, anonymous callers always see the
    same neutral message regardless of whether the address is registered.
    """

    ip = request.remote_addr or 'unknown'
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    _cleanup_expired_auth_accounts()

    current_user: User | None = None
    token = ''
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        token = auth_header.removeprefix('Bearer ').strip()
    if not token:
        token = (request.cookies.get('codequest_access_token') or '').strip()
    if token:
        try:
            payload = decode_token(token)
            if payload.get('type') == 'access':
                user = db.session.get(User, int(payload['sub']))
                if user and user.is_active:
                    current_user = user
        except Exception:
            current_user = None

    target_email = current_user.email.lower() if current_user else email
    throttle_subject = target_email or 'unknown'
    if not resend_verification_attempt_allowed(throttle_subject, ip):
        return {
            'message': 'Слишком много запросов. Попробуйте позже.',
            'code': 'rate_limited',
        }, 429
    register_resend_verification_attempt(throttle_subject, ip)

    if current_user is None and not target_email:
        # Mirror the forgot-password neutral response to avoid enumeration.
        return {
            'message': (
                'Если аккаунт с такой почтой существует и ещё не подтверждён, '
                'мы отправим письмо повторно.'
            ),
        }

    user = current_user or User.query.filter(User.email == target_email).first()
    neutral_response = {
        'message': (
            'Если аккаунт с такой почтой существует и ещё не подтверждён, '
            'мы отправим письмо повторно.'
        ),
    }

    if user is None or not user.is_active:
        db.session.commit()
        return neutral_response

    if user.email_verified:
        if current_user is not None:
            return {
                'message': 'Email уже подтверждён.',
                'already_verified': True,
                'user': user.to_dict(),
            }
        return neutral_response

    invalidate_active_tokens(user, EMAIL_TOKEN_PURPOSE_VERIFICATION)
    issued = issue_verification_token(user)
    db.session.commit()
    sent = _try_send_verification_email(user, issued.raw_token)

    if current_user is not None:
        return {
            'message': 'Письмо подтверждения отправлено повторно.',
            'verification_email_sent': sent,
        }
    return neutral_response


# ---------------------------------------------------------------------------
# Password reset
# ---------------------------------------------------------------------------


@auth_bp.post('/forgot-password')
def forgot_password():
    ip = request.remote_addr or 'unknown'
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    throttle_subject = email or 'unknown'
    # Always rate-limit by subject+ip so we don't burn provider quota or
    # leak existence via timing of error responses.
    if not password_reset_attempt_allowed(throttle_subject, ip):
        return {
            'message': 'Слишком много запросов. Попробуйте позже.',
            'code': 'rate_limited',
        }, 429
    register_password_reset_attempt(throttle_subject, ip)

    if not email or not is_valid_email(email):
        # Always return a neutral 200 — no enumeration via 400 vs 200.
        db.session.commit()
        return _FORGOT_PASSWORD_NEUTRAL_RESPONSE

    _cleanup_expired_auth_accounts()
    user = User.query.filter(User.email == email).first()
    if user is None or not user.is_active:
        db.session.commit()
        return _FORGOT_PASSWORD_NEUTRAL_RESPONSE

    issued = issue_password_reset_token(user)
    db.session.commit()
    _try_send_password_reset_email(user, issued.raw_token)
    return _FORGOT_PASSWORD_NEUTRAL_RESPONSE


@auth_bp.post('/reset-password')
def reset_password():
    data = request.get_json(silent=True) or {}
    raw_token = (data.get('token') or '').strip()
    new_password = data.get('new_password') or data.get('password') or ''

    if not raw_token:
        return {'message': 'Не передан токен сброса пароля.', 'code': 'invalid_token'}, 400

    _cleanup_expired_auth_accounts()
    password_error = validate_password(new_password)
    if password_error:
        # Validate password BEFORE consuming the token so a typo doesn't burn
        # the link. consume_token() returning success below is the only place
        # that marks `used_at`, keeping the operation atomic with the password
        # change.
        return {'message': password_error, 'code': 'weak_password'}, 400

    result = consume_token(raw_token, EMAIL_TOKEN_PURPOSE_PASSWORD_RESET)
    if result.error == 'invalid_token':
        return {
            'message': 'Ссылка для сброса пароля недействительна.',
            'code': 'invalid_token',
        }, 400
    if result.error == 'used_token':
        return {
            'message': 'Эта ссылка уже использовалась. Запросите новое письмо.',
            'code': 'used_token',
        }, 400
    if result.error == 'expired_token':
        return {
            'message': 'Срок действия ссылки истёк. Запросите новое письмо.',
            'code': 'expired_token',
        }, 400
    if result.error == 'user_unavailable' or result.user is None:
        return {
            'message': 'Аккаунт недоступен. Обратитесь в поддержку.',
            'code': 'user_unavailable',
        }, 400

    user = result.user
    user.password_hash = hash_password(new_password)
    user.password_changed_at = datetime.now(UTC)
    user.bump_session_version()
    invalidate_session_version_cache(user.id)
    revoke_refresh_tokens_for_user(user.id)
    # Cap the blast radius: any other live reset link for this user stops
    # working immediately after the first successful reset.
    invalidate_active_tokens(user, EMAIL_TOKEN_PURPOSE_PASSWORD_RESET)
    db.session.commit()

    return {
        'message': 'Пароль обновлён. Войдите с новым паролем.',
    }
