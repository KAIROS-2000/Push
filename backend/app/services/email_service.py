"""Transactional email service.

This module provides a thin provider-agnostic facade so the rest of the
codebase only depends on `send_email`, `send_verification_email` and
`send_password_reset_email`. The default provider talks to Unisender Go's
Web API v1 (https://godocs.unisender.ru/web-api-ref). To switch providers,
add a new sender function and dispatch on `Config.EMAIL_PROVIDER` inside
`_send_via_provider` — calling code does not change.

Hard rules enforced here:

* The raw verification/reset token leaves the backend exactly once — inside
  the outgoing email link. We never log it.
* The Unisender Go API key is read from env at call time and never logged.
* Network errors raise `EmailDeliveryError`; the caller decides how to react.
* Email never sent silently in production: callers are expected to commit
  DB rows in the same request and surface the result, but if a transient
  delivery error happens we still return a controlled exception.
"""

from __future__ import annotations

import json
import logging
import socket
from dataclasses import dataclass
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request

from flask import current_app

from ..models.user import User

# Late-imported in render functions to avoid a circular import (the learning
# models import from `..core` which doesn't depend on services). We only need
# the type at module level for annotations, so we hide it behind TYPE_CHECKING.

_log = logging.getLogger(__name__)

PLATFORM_NAME = 'Progyx'
DEFAULT_VERIFICATION_PATH = '/verify-email'
DEFAULT_RESET_PATH = '/reset-password'


class EmailServiceError(RuntimeError):
    """Base error for any email service failure."""


class EmailConfigurationError(EmailServiceError):
    """Raised when required env config is missing or malformed."""


class EmailDeliveryError(EmailServiceError):
    """Raised when the upstream provider rejected the request or is unreachable."""

    def __init__(self, message: str, *, status_code: int | None = None, payload: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


@dataclass(frozen=True)
class EmailDeliveryResult:
    provider: str
    accepted: bool
    message_id: str | None = None
    dry_run: bool = False
    skipped: bool = False


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------


def _verification_url(raw_token: str) -> str:
    base = (current_app.config.get('FRONTEND_PUBLIC_URL') or '').strip().rstrip('/')
    if not base:
        raise EmailConfigurationError('FRONTEND_PUBLIC_URL is not configured.')
    return f"{base}{DEFAULT_VERIFICATION_PATH}?token={raw_token}"


def _reset_url(raw_token: str) -> str:
    base = (current_app.config.get('FRONTEND_PUBLIC_URL') or '').strip().rstrip('/')
    if not base:
        raise EmailConfigurationError('FRONTEND_PUBLIC_URL is not configured.')
    return f"{base}{DEFAULT_RESET_PATH}?token={raw_token}"


def _platform_name() -> str:
    return (current_app.config.get('EMAIL_FROM_NAME') or PLATFORM_NAME).strip() or PLATFORM_NAME


_BASE_STYLES = (
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;"
    "color:#0f172a;line-height:1.6;font-size:16px;"
)
_CARD_STYLES = (
    "max-width:560px;margin:24px auto;padding:32px;border-radius:24px;"
    "background:#ffffff;border:1px solid #e2e8f0;box-shadow:0 12px 32px rgba(15,23,42,0.06);"
)
_BUTTON_STYLES = (
    "display:inline-block;padding:14px 28px;border-radius:14px;background:#0284c7;"
    "color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;"
)
_MUTED_STYLES = "color:#475569;font-size:14px;"


def _render_card(*, heading: str, intro: str, button_label: str, action_url: str, expiration_note: str, ignore_note: str) -> tuple[str, str]:
    platform = _platform_name()
    safe_url = action_url.replace('"', '&quot;')
    html = (
        f"<!doctype html><html><body style=\"background:#f1f5f9;margin:0;padding:24px;{_BASE_STYLES}\">"
        f"<div style=\"{_CARD_STYLES}\">"
        f"<p style=\"font-weight:700;letter-spacing:0.18em;text-transform:uppercase;font-size:12px;color:#0284c7;margin:0 0 16px;\">{platform}</p>"
        f"<h1 style=\"margin:0 0 16px;font-size:24px;line-height:1.3;\">{heading}</h1>"
        f"<p style=\"margin:0 0 24px;\">{intro}</p>"
        f"<p style=\"margin:0 0 24px;\"><a href=\"{safe_url}\" style=\"{_BUTTON_STYLES}\">{button_label}</a></p>"
        f"<p style=\"margin:0 0 16px;{_MUTED_STYLES}\">Если кнопка не работает, скопируйте ссылку:<br/>"
        f"<span style=\"word-break:break-all;color:#0f172a;\">{action_url}</span></p>"
        f"<p style=\"margin:0 0 8px;{_MUTED_STYLES}\">{expiration_note}</p>"
        f"<p style=\"margin:0;{_MUTED_STYLES}\">{ignore_note}</p>"
        f"</div></body></html>"
    )
    text = (
        f"{platform}\n\n"
        f"{heading}\n\n"
        f"{intro}\n\n"
        f"{button_label}: {action_url}\n\n"
        f"{expiration_note}\n"
        f"{ignore_note}\n"
    )
    return html, text


def render_verification_email(user: User, raw_token: str) -> tuple[str, str, str]:
    ttl_minutes = int(current_app.config.get('EMAIL_VERIFICATION_TOKEN_TTL_MINUTES') or 1440)
    ttl_hours = max(ttl_minutes // 60, 1)
    full_name = (user.full_name or '').strip() or 'друг'
    intro = (
        f"Здравствуйте, {full_name}! Чтобы завершить регистрацию в {_platform_name()}, "
        "подтвердите адрес электронной почты — это нужно один раз."
    )
    expiration_note = f"Ссылка действует {ttl_hours} ч и работает только один раз."
    ignore_note = (
        "Если вы не регистрировались на платформе, просто игнорируйте это письмо — "
        "никаких дальнейших действий не потребуется."
    )
    html, text = _render_card(
        heading='Подтвердите свой email',
        intro=intro,
        button_label='Подтвердить email',
        action_url=_verification_url(raw_token),
        expiration_note=expiration_note,
        ignore_note=ignore_note,
    )
    subject = f"Подтверждение почты в {_platform_name()}"
    return subject, html, text


def render_parent_welcome_email(user: User, raw_password: str, raw_token: str) -> tuple[str, str, str]:
    """Single email that gives the parent both the initial password and the verify link.

    Parent flow is "enter email -> get into cabinet immediately, password arrives by mail".
    We never store the raw password anywhere except the email body — DB has only the hash.
    """

    if not raw_password:
        raise EmailConfigurationError('Initial password must not be empty.')
    ttl_minutes = int(current_app.config.get('EMAIL_VERIFICATION_TOKEN_TTL_MINUTES') or 1440)
    ttl_hours = max(ttl_minutes // 60, 1)
    full_name = (user.full_name or '').strip() or 'родитель'
    platform = _platform_name()
    safe_url = _verification_url(raw_token).replace('"', '&quot;')
    safe_password = (
        raw_password.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    )

    html = (
        f"<!doctype html><html><body style=\"background:#f1f5f9;margin:0;padding:24px;{_BASE_STYLES}\">"
        f"<div style=\"{_CARD_STYLES}\">"
        f"<p style=\"font-weight:700;letter-spacing:0.18em;text-transform:uppercase;font-size:12px;color:#0284c7;margin:0 0 16px;\">{platform}</p>"
        f"<h1 style=\"margin:0 0 16px;font-size:24px;line-height:1.3;\">Семейный кабинет создан</h1>"
        f"<p style=\"margin:0 0 16px;\">Здравствуйте, {full_name}! Мы создали для вас семейный кабинет в {platform}.</p>"
        f"<p style=\"margin:0 0 8px;font-weight:600;\">Ваш логин: <span style=\"color:#0f172a;\">{user.email}</span></p>"
        f"<p style=\"margin:0 0 24px;font-weight:600;\">Временный пароль: "
        f"<code style=\"display:inline-block;padding:4px 10px;border-radius:8px;background:#0f172a;color:#f8fafc;font-size:15px;letter-spacing:0.04em;\">{safe_password}</code></p>"
        f"<p style=\"margin:0 0 16px;\">Сейчас вы уже вошли в кабинет в браузере. Сохраните пароль — он понадобится для входа с другого устройства.</p>"
        f"<p style=\"margin:0 0 12px;font-weight:600;\">Подтвердите email, чтобы привязать ребёнка:</p>"
        f"<p style=\"margin:0 0 24px;\"><a href=\"{safe_url}\" style=\"{_BUTTON_STYLES}\">Подтвердить email</a></p>"
        f"<p style=\"margin:0 0 16px;{_MUTED_STYLES}\">Если кнопка не работает, скопируйте ссылку:<br/>"
        f"<span style=\"word-break:break-all;color:#0f172a;\">{_verification_url(raw_token)}</span></p>"
        f"<p style=\"margin:0 0 8px;{_MUTED_STYLES}\">Ссылка подтверждения действует {ttl_hours} ч.</p>"
        f"<p style=\"margin:0 0 8px;{_MUTED_STYLES}\">Рекомендуем сразу сменить временный пароль в настройках профиля.</p>"
        f"<p style=\"margin:0;{_MUTED_STYLES}\">Если вы не регистрировались на платформе, проигнорируйте это письмо — никаких дальнейших действий не потребуется.</p>"
        f"</div></body></html>"
    )
    text = (
        f"{platform}\n\n"
        f"Семейный кабинет создан.\n\n"
        f"Логин: {user.email}\n"
        f"Временный пароль: {raw_password}\n\n"
        f"Сейчас вы уже вошли в кабинет в браузере. Сохраните пароль — он понадобится для входа с другого устройства.\n\n"
        f"Подтвердите email, чтобы привязать ребёнка: {_verification_url(raw_token)}\n\n"
        f"Ссылка подтверждения действует {ttl_hours} ч.\n"
        f"Рекомендуем сразу сменить временный пароль в настройках профиля.\n"
        f"Если вы не регистрировались на платформе, проигнорируйте это письмо.\n"
    )
    subject = f"Доступ к семейному кабинету в {platform}"
    return subject, html, text


def _child_dashboard_url(child_id: int | None = None) -> str:
    base = (current_app.config.get('FRONTEND_PUBLIC_URL') or '').strip().rstrip('/')
    if not base:
        raise EmailConfigurationError('FRONTEND_PUBLIC_URL is not configured.')
    if child_id is not None:
        return f"{base}/parent/dashboard?child={child_id}"
    return f"{base}/parent/dashboard"


def render_child_achievement_email(
    parent: User,
    child: User,
    achievements: list,
) -> tuple[str, str, str]:
    """Notify the parent that the child unlocked one or more achievements.

    `achievements` is a list of `Achievement` model rows (kept untyped here to
    keep this module free of model imports beyond `User`). Each row exposes
    `name`, `description`, `xp_reward`.
    """

    if not achievements:
        raise EmailConfigurationError('Achievements list must not be empty.')

    platform = _platform_name()
    parent_name = (parent.full_name or '').strip() or 'родитель'
    child_full_name = (child.full_name or '').strip() or 'ребёнок'
    child_first = child_full_name.split()[0] if child_full_name else 'ребёнок'

    # Cap to avoid mega-emails if a single sync somehow returns dozens.
    capped = list(achievements[:5])
    extra = max(len(achievements) - len(capped), 0)
    multiple = len(capped) > 1

    if multiple:
        subject = f"{child_first}: новые достижения в {platform}"
        intro = (
            f"Здравствуйте, {parent_name}! У {child_first} в кабинете {platform} "
            f"появилось {len(capped)} новых достижений — мы хотели поделиться этим с вами."
        )
    else:
        subject = f"{child_first} получил(а) достижение «{capped[0].name}»"
        intro = (
            f"Здравствуйте, {parent_name}! У {child_first} в кабинете {platform} "
            "новое достижение — есть повод порадоваться вместе."
        )

    achievement_items_html = ''.join(
        (
            f"<li style=\"margin:0 0 12px;padding:12px 16px;border-radius:14px;background:#f1f5f9;\">"
            f"<p style=\"margin:0 0 4px;font-weight:700;color:#0f172a;\">{ach.name}</p>"
            f"<p style=\"margin:0;color:#475569;font-size:14px;\">{(ach.description or '').strip()}</p>"
            + (
                f"<p style=\"margin:6px 0 0;color:#0284c7;font-size:13px;font-weight:600;\">+{int(ach.xp_reward or 0)} XP</p>"
                if int(ach.xp_reward or 0) > 0
                else ""
            )
            + "</li>"
        )
        for ach in capped
    )
    extra_note_html = (
        f"<p style=\"margin:0 0 16px;{_MUTED_STYLES}\">И ещё {extra} достижений — все они уже видны в кабинете.</p>"
        if extra
        else ""
    )

    action_url = _child_dashboard_url(child.id)
    safe_url = action_url.replace('"', '&quot;')

    share_text = (
        f"{child_first} получил(а) достижение в {platform}: "
        f"{capped[0].name}!"
    )
    safe_share = share_text.replace('"', '&quot;')

    html = (
        f"<!doctype html><html><body style=\"background:#f1f5f9;margin:0;padding:24px;{_BASE_STYLES}\">"
        f"<div style=\"{_CARD_STYLES}\">"
        f"<p style=\"font-weight:700;letter-spacing:0.18em;text-transform:uppercase;font-size:12px;color:#0284c7;margin:0 0 16px;\">{platform}</p>"
        f"<h1 style=\"margin:0 0 16px;font-size:24px;line-height:1.3;\">"
        f"{('Новые достижения у ' + child_first) if multiple else ('Достижение у ' + child_first)}"
        f"</h1>"
        f"<p style=\"margin:0 0 20px;\">{intro}</p>"
        f"<ul style=\"margin:0 0 20px;padding:0;list-style:none;\">{achievement_items_html}</ul>"
        f"{extra_note_html}"
        f"<p style=\"margin:0 0 24px;\"><a href=\"{safe_url}\" style=\"{_BUTTON_STYLES}\">Посмотреть в кабинете</a></p>"
        f"<p style=\"margin:0 0 16px;{_MUTED_STYLES}\">Если кнопка не работает, скопируйте ссылку:<br/>"
        f"<span style=\"word-break:break-all;color:#0f172a;\">{action_url}</span></p>"
        f"<div style=\"margin:0 0 12px;padding:12px 16px;border-radius:14px;background:#ecfeff;border:1px solid #a5f3fc;\">"
        f"<p style=\"margin:0 0 6px;font-weight:700;color:#0e7490;font-size:14px;\">Поделитесь радостью</p>"
        f"<p style=\"margin:0 0 6px;color:#155e75;font-size:13px;line-height:1.5;\">"
        f"Маленькая похвала закрепляет привычку учиться. Расскажите близким:"
        f"</p>"
        f"<p style=\"margin:0;padding:8px 12px;border-radius:10px;background:#ffffff;color:#0f172a;font-size:13px;\">"
        f"«{share_text}»"
        f"</p></div>"
        f"<p style=\"margin:0;{_MUTED_STYLES}\">"
        "Это автоматическое письмо из семейного кабинета. Отключить уведомления можно в настройках кабинета."
        f"</p>"
        f"</div></body></html>"
    )
    text = (
        f"{platform}\n\n"
        f"{intro}\n\n"
        + "\n".join(
            f"• {ach.name}"
            + (f" — {ach.description.strip()}" if (ach.description or '').strip() else '')
            + (f" (+{int(ach.xp_reward or 0)} XP)" if int(ach.xp_reward or 0) > 0 else '')
            for ach in capped
        )
        + (f"\nИ ещё {extra} достижений — все они уже видны в кабинете." if extra else '')
        + f"\n\nПосмотреть в кабинете: {action_url}\n\n"
        f"Поделитесь радостью с близкими: «{share_text}»\n\n"
        "Отключить уведомления можно в настройках семейного кабинета.\n"
    )
    # share_text is computed but not exported — listed via subject preview above.
    _ = safe_share
    return subject, html, text


def render_password_reset_email(user: User, raw_token: str) -> tuple[str, str, str]:
    ttl_minutes = max(int(current_app.config.get('PASSWORD_RESET_TOKEN_TTL_MINUTES') or 30), 1)
    full_name = (user.full_name or '').strip() or 'друг'
    intro = (
        f"Здравствуйте, {full_name}! Мы получили запрос на сброс пароля в {_platform_name()}. "
        "Чтобы задать новый пароль, перейдите по кнопке ниже."
    )
    expiration_note = f"Ссылка действует {ttl_minutes} мин. и срабатывает только один раз."
    ignore_note = (
        "Если вы не запрашивали сброс пароля, проигнорируйте это письмо — "
        "ваш текущий пароль останется без изменений."
    )
    html, text = _render_card(
        heading='Сброс пароля',
        intro=intro,
        button_label='Задать новый пароль',
        action_url=_reset_url(raw_token),
        expiration_note=expiration_note,
        ignore_note=ignore_note,
    )
    subject = f"Сброс пароля в {_platform_name()}"
    return subject, html, text


# ---------------------------------------------------------------------------
# Provider transport
# ---------------------------------------------------------------------------


def _provider_name() -> str:
    return (current_app.config.get('EMAIL_PROVIDER') or 'unisender_go').strip().lower() or 'unisender_go'


def _from_email() -> str:
    value = (current_app.config.get('EMAIL_FROM') or '').strip()
    if not value:
        raise EmailConfigurationError('EMAIL_FROM is not configured.')
    # Catch the common misconfiguration where operators put a bare domain
    # (e.g. "email.progyx.pro") instead of a full address. Unisender Go would
    # reject this with a generic 400 — surface a clearer message here so the
    # fix is obvious from the logs.
    if '@' not in value or value.startswith('@') or value.endswith('@'):
        raise EmailConfigurationError(
            f"EMAIL_FROM must be a full email address like 'no-reply@your-domain', got '{value}'."
        )
    return value


def _api_endpoint() -> str:
    base = (current_app.config.get('UNISENDER_GO_API_URL') or '').strip().rstrip('/')
    if not base:
        raise EmailConfigurationError('UNISENDER_GO_API_URL is not configured.')
    return f"{base}/email/send.json"


def _api_key() -> str:
    value = (current_app.config.get('UNISENDER_GO_API_KEY') or '').strip()
    if not value:
        raise EmailConfigurationError('UNISENDER_GO_API_KEY is not configured.')
    return value


def _build_unisender_payload(
    *,
    to: str,
    subject: str,
    html: str,
    text: str | None,
    metadata: dict[str, Any] | None,
) -> dict[str, Any]:
    body: dict[str, Any] = {'html': html}
    if text:
        body['plaintext'] = text
    message: dict[str, Any] = {
        'recipients': [{'email': to}],
        'body': body,
        'subject': subject,
        'from_email': _from_email(),
        'from_name': _platform_name(),
    }
    reply_to = (current_app.config.get('EMAIL_REPLY_TO') or '').strip()
    if reply_to:
        message['reply_to'] = reply_to
    if metadata:
        cleaned = {str(k): str(v) for k, v in metadata.items() if v is not None}
        if cleaned:
            message['metadata'] = cleaned
    # Unisender Go rejects requests that send the API key in both the body and
    # the `X-API-KEY` header ("You must use one of the authorization methods
    # and not two at once"). We only use the header — see _send_via_unisender_go.
    return {'message': message}


def _post_json(url: str, payload: dict[str, Any], *, headers: dict[str, str], timeout_seconds: float) -> tuple[int, bytes]:
    encoded = json.dumps(payload).encode('utf-8')
    req = urllib_request.Request(url, data=encoded, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Accept', 'application/json')
    for header_name, header_value in headers.items():
        req.add_header(header_name, header_value)
    try:
        with urllib_request.urlopen(req, timeout=timeout_seconds) as response:
            body = response.read() or b''
            return response.status, body
    except urllib_error.HTTPError as exc:
        body = exc.read() or b''
        return exc.code, body
    except (urllib_error.URLError, socket.timeout, OSError) as exc:
        raise EmailDeliveryError(f"Email provider unreachable: {exc}") from exc


def _send_via_unisender_go(
    *,
    to: str,
    subject: str,
    html: str,
    text: str | None,
    metadata: dict[str, Any] | None,
) -> EmailDeliveryResult:
    url = _api_endpoint()
    payload = _build_unisender_payload(
        to=to, subject=subject, html=html, text=text, metadata=metadata,
    )
    timeout_seconds = max(int(current_app.config.get('UNISENDER_GO_TIMEOUT_MS') or 15000), 1000) / 1000.0
    status_code, raw_body = _post_json(
        url,
        payload,
        headers={'X-API-KEY': _api_key()},
        timeout_seconds=timeout_seconds,
    )

    parsed: Any = None
    if raw_body:
        try:
            parsed = json.loads(raw_body.decode('utf-8'))
        except (ValueError, UnicodeDecodeError):
            parsed = None

    if status_code >= 400:
        error_message = _extract_provider_error(parsed) or f"Unisender Go responded with HTTP {status_code}"
        # Never include the api_key or full payload in the log.
        _log.warning(
            "email_send_failed provider=unisender_go status=%s error=%s",
            status_code,
            error_message,
        )
        raise EmailDeliveryError(error_message, status_code=status_code, payload=parsed)

    message_id: str | None = None
    if isinstance(parsed, dict):
        # Per Unisender Go contract: { "status": "success", "job_id": ..., "emails": [{"id": ...}] }
        emails = parsed.get('emails')
        if isinstance(emails, list) and emails and isinstance(emails[0], dict):
            mid = emails[0].get('id') or emails[0].get('email_id')
            if mid is not None:
                message_id = str(mid)
        if message_id is None:
            mid = parsed.get('job_id') or parsed.get('id')
            if mid is not None:
                message_id = str(mid)

    return EmailDeliveryResult(provider='unisender_go', accepted=True, message_id=message_id)


def _extract_provider_error(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    for key in ('message', 'error_message', 'error', 'detail'):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    failed = payload.get('failed_emails')
    if isinstance(failed, dict) and failed:
        first = next(iter(failed.values()))
        if isinstance(first, str) and first.strip():
            return first.strip()
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def _mask_email(value: str) -> str:
    value = (value or '').strip()
    if '@' not in value:
        return '***'
    local, domain = value.split('@', 1)
    if len(local) <= 2:
        masked_local = '*' * len(local)
    else:
        masked_local = f"{local[0]}***{local[-1]}"
    return f"{masked_local}@{domain}"


def send_email(
    to: str,
    subject: str,
    html: str,
    text: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> EmailDeliveryResult:
    recipient = (to or '').strip()
    if not recipient or '@' not in recipient:
        raise EmailConfigurationError('Recipient email must be a valid address.')
    if not (subject or '').strip():
        raise EmailConfigurationError('Email subject must not be empty.')
    if not (html or '').strip():
        raise EmailConfigurationError('Email html body must not be empty.')

    if current_app.config.get('EMAIL_DRY_RUN'):
        _log.info(
            'email_dry_run provider=%s to=%s subject=%s',
            _provider_name(),
            _mask_email(recipient),
            subject,
        )
        return EmailDeliveryResult(provider=_provider_name(), accepted=True, dry_run=True)

    if not current_app.config.get('SEND_MAIL', True):
        _log.info(
            'email_send_disabled to=%s subject=%s',
            _mask_email(recipient),
            subject,
        )
        return EmailDeliveryResult(provider='disabled', accepted=True, skipped=True)

    provider = _provider_name()
    if provider != 'unisender_go':
        raise EmailConfigurationError(f"Unsupported EMAIL_PROVIDER: {provider}")

    result = _send_via_unisender_go(
        to=recipient,
        subject=subject,
        html=html,
        text=text,
        metadata=metadata,
    )
    _log.info(
        'email_sent provider=%s to=%s subject=%s message_id=%s',
        result.provider,
        _mask_email(recipient),
        subject,
        result.message_id or '-',
    )
    return result


def send_verification_email(user: User, raw_token: str) -> EmailDeliveryResult:
    if not raw_token:
        raise EmailConfigurationError('Verification token must not be empty.')
    subject, html, text = render_verification_email(user, raw_token)
    return send_email(
        user.email,
        subject,
        html,
        text=text,
        metadata={'purpose': 'email_verification', 'user_id': user.id},
    )


def send_child_achievement_email(parent: User, child: User, achievements: list) -> EmailDeliveryResult:
    if not achievements:
        raise EmailConfigurationError('Achievements list must not be empty.')
    subject, html, text = render_child_achievement_email(parent, child, achievements)
    return send_email(
        parent.email,
        subject,
        html,
        text=text,
        metadata={
            'purpose': 'child_achievement',
            'parent_id': parent.id,
            'child_id': child.id,
            'achievement_count': len(achievements),
        },
    )


def send_parent_welcome_email(user: User, raw_password: str, raw_token: str) -> EmailDeliveryResult:
    if not raw_token:
        raise EmailConfigurationError('Verification token must not be empty.')
    subject, html, text = render_parent_welcome_email(user, raw_password, raw_token)
    return send_email(
        user.email,
        subject,
        html,
        text=text,
        metadata={'purpose': 'parent_welcome', 'user_id': user.id},
    )


def send_password_reset_email(user: User, raw_token: str) -> EmailDeliveryResult:
    if not raw_token:
        raise EmailConfigurationError('Reset token must not be empty.')
    subject, html, text = render_password_reset_email(user, raw_token)
    return send_email(
        user.email,
        subject,
        html,
        text=text,
        metadata={'purpose': 'password_reset', 'user_id': user.id},
    )
