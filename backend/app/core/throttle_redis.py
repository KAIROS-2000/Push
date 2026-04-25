from __future__ import annotations

import hashlib
import ipaddress
import logging
import re
from flask import current_app

from .config import Config
from .redis_client import get_redis, redis_key

_log = logging.getLogger(__name__)

_SCOPE_RE = re.compile(r'^[a-z][a-z0-9_]{0,63}$')


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode('utf-8')).hexdigest()[:32]


def _normalize_scope(scope: str) -> str:
    s = (scope or '').strip().lower()
    if not _SCOPE_RE.match(s):
        return 'invalid_scope'
    return s


def _normalize_subject(subject: str) -> str:
    return (subject or '').strip()[:255] or 'unknown'


def _normalize_ip(ip_address: str) -> str:
    """Возвращает стабильный хеш IP для ключа Redis (без хранения сырого PII в ключе)."""
    raw = (ip_address or '').strip()[:64] or 'unknown'
    try:
        canonical = str(ipaddress.ip_address(raw))
    except ValueError:
        canonical = raw
    return _digest(canonical)


def _keys(scope: str, subject: str, ip_address: str) -> tuple[str, str]:
    sc = _normalize_scope(scope)
    sj = _digest(_normalize_subject(subject))
    ip = _normalize_ip(ip_address)
    base = redis_key('throttle', sc, sj, ip)
    return f'{base}:cnt', f'{base}:blk'


def _settings(scope: str) -> tuple[int, int, int]:
    if scope == 'login':
        return (
            int(current_app.config.get('LOGIN_RATE_LIMIT_WINDOW_SECONDS', 900)),
            int(current_app.config.get('LOGIN_RATE_LIMIT_MAX_FAILURES', 8)),
            int(current_app.config.get('LOGIN_RATE_LIMIT_BLOCK_SECONDS', 900)),
        )
    if scope == 'parent_access':
        return (
            int(current_app.config.get('PARENT_ACCESS_RATE_LIMIT_WINDOW_SECONDS', 600)),
            int(current_app.config.get('PARENT_ACCESS_RATE_LIMIT_MAX_FAILURES', 20)),
            int(current_app.config.get('PARENT_ACCESS_RATE_LIMIT_BLOCK_SECONDS', 900)),
        )
    if scope == 'register':
        return (
            int(current_app.config.get('REGISTER_RATE_LIMIT_WINDOW_SECONDS', 3600)),
            int(current_app.config.get('REGISTER_RATE_LIMIT_MAX_FAILURES', 25)),
            int(current_app.config.get('REGISTER_RATE_LIMIT_BLOCK_SECONDS', 3600)),
        )
    if scope == 'refresh':
        return (
            int(current_app.config.get('REFRESH_RATE_LIMIT_WINDOW_SECONDS', 60)),
            int(current_app.config.get('REFRESH_RATE_LIMIT_MAX_FAILURES', 45)),
            int(current_app.config.get('REFRESH_RATE_LIMIT_BLOCK_SECONDS', 300)),
        )
    return (900, 10, 900)


def throttle_check_allowed(scope: str, subject: str, ip_address: str) -> bool:
    client = get_redis(Config.REDIS_DB_THROTTLE)
    if client is None:
        return True
    window_seconds, max_failures, _ = _settings(scope)
    cnt_key, blk_key = _keys(scope, subject, ip_address)
    try:
        if client.exists(blk_key):
            return False
        raw = client.get(cnt_key)
        count = int(raw or 0)
        return count < max_failures
    except (Exception,) as exc:  # noqa: BLE001 — graceful degrade
        _log.debug('throttle_redis check failed: %s', exc)
        return True


def throttle_register_failure(scope: str, subject: str, ip_address: str) -> bool:
    """Возвращает True, если после инкремента пользователь ещё не в блокировке."""
    client = get_redis(Config.REDIS_DB_THROTTLE)
    if client is None:
        return True
    window_seconds, max_failures, block_seconds = _settings(scope)
    cnt_key, blk_key = _keys(scope, subject, ip_address)
    try:
        pipe = client.pipeline()
        pipe.incr(cnt_key)
        results = pipe.execute()
        count = int(results[0] or 0)
        if count == 1:
            client.expire(cnt_key, window_seconds)
        if count >= max_failures:
            client.setex(blk_key, block_seconds, '1')
            return False
        return True
    except (Exception,) as exc:  # noqa: BLE001
        _log.debug('throttle_redis register_failure failed: %s', exc)
        return True


def throttle_clear(scope: str, subject: str, ip_address: str) -> None:
    client = get_redis(Config.REDIS_DB_THROTTLE)
    if client is None:
        return
    cnt_key, blk_key = _keys(scope, subject, ip_address)
    try:
        client.delete(cnt_key, blk_key)
    except (Exception,) as exc:  # noqa: BLE001
        _log.debug('throttle_redis clear failed: %s', exc)


def throttle_register_attempt(scope: str, subject: str, ip_address: str) -> bool:
    """Учёт попытки как «неуспех» для скоупов вроде register (лимит попыток)."""
    return throttle_register_failure(scope, subject, ip_address)
