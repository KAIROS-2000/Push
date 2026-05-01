from __future__ import annotations

import logging

import jwt
from flask import Flask, current_app, request, Response

from ..core.db import db
from ..core.security import access_token_from_request, decode_token
from ..models.user import SiteActivityLog

_log = logging.getLogger(__name__)

# Only these paths; keep noise low (health, static, optional self-read of log feed).
_EXCLUDED_PATH_PREFIXES: tuple[str, ...] = (
    '/api/health',
    '/api/mascot/',
)
_MAX_PATH = 1008


def _client_ip() -> str:
    trust = bool(current_app.config.get('TRUST_PROXY'))
    if trust:
        raw = (request.headers.get('X-Forwarded-For') or request.headers.get('X-Real-IP') or '').strip()
        if raw:
            return raw.split(',')[0].strip()[:64]
    return (request.remote_addr or '')[:64]


def _path_for_log() -> str:
    p = (request.path or '/').strip() or '/'
    if len(p) > _MAX_PATH:
        return p[:_MAX_PATH] + '…'
    return p


def _access_user_from_request() -> tuple[int | None, str]:
    token = access_token_from_request()
    if not token:
        return None, 'anonymous'
    try:
        payload = decode_token(token)
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, ValueError, KeyError):
        return None, 'anonymous'
    if payload.get('type') != 'access':
        return None, 'anonymous'
    try:
        uid = int(payload.get('sub'))
    except (TypeError, ValueError):
        return None, 'anonymous'
    role = str(payload.get('role') or 'anonymous').strip().lower()[:32] or 'anonymous'
    return uid, role


def _should_log_request() -> bool:
    if not current_app.config.get('ENABLE_SITE_ACTIVITY_LOG', True):
        return False
    if current_app.config.get('TESTING'):
        return False
    if request.method == 'OPTIONS':
        return False
    path = request.path or ''
    if not path.startswith('/api/'):
        return False
    for prefix in _EXCLUDED_PATH_PREFIXES:
        if path.startswith(prefix):
            return False
    return True


def _persist_log(*, user_id: int | None, user_role: str, method: str, path: str, status_code: int, client_ip: str) -> None:
    try:
        entry = SiteActivityLog(
            user_id=user_id,
            user_role=user_role,
            method=method[:8].upper(),
            path=path,
            status_code=int(status_code),
            client_ip=client_ip,
        )
        db.session.add(entry)
        db.session.commit()
    except Exception:
        db.session.rollback()
        _log.exception("site_activity_log persist failed path=%s", path)


def site_activity_after_request(response: Response) -> Response:
    if not _should_log_request():
        return response
    user_id, role = _access_user_from_request()
    _persist_log(
        user_id=user_id,
        user_role=role,
        method=request.method,
        path=_path_for_log(),
        status_code=response.status_code,
        client_ip=_client_ip(),
    )
    return response


def register_site_activity_logging(app: Flask) -> None:
    app.after_request(site_activity_after_request)
