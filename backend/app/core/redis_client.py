from __future__ import annotations

import logging
import threading
import time
from typing import TYPE_CHECKING
from urllib.parse import quote, urlparse, urlunparse

import redis

from .config import Config, resolve_redis_password

if TYPE_CHECKING:
    from redis.client import Redis

_log = logging.getLogger(__name__)

_pool_lock = threading.Lock()
_pools: dict[int, redis.ConnectionPool | None] = {}

_negative_ping_until = 0.0
_negative_ping_lock = threading.Lock()
NEGATIVE_PING_CACHE_SECONDS = 5.0

_last_warn_monotonic = 0.0
_WARN_INTERVAL_SECONDS = 30.0


def _rate_limited_warning(message: str, *args: object) -> None:
    global _last_warn_monotonic
    now = time.monotonic()
    if now - _last_warn_monotonic < _WARN_INTERVAL_SECONDS:
        return
    _last_warn_monotonic = now
    _log.warning(message, *args)


def _redis_env_slug() -> str:
    return (Config.APP_ENV or 'development').strip().lower().replace(' ', '_')[:48]


def redis_key(*parts: str) -> str:
    base = f'progyx:{_redis_env_slug()}'
    cleaned = [p.strip().replace(' ', '_') for p in parts if p and str(p).strip()]
    return ':'.join([base, *cleaned])


def _inject_password_and_db(url: str, db: int) -> str:
    raw = (url or '').strip()
    if not raw:
        return raw
    parsed = urlparse(raw)
    password = resolve_redis_password()
    netloc = parsed.netloc or ''
    host = parsed.hostname or 'localhost'
    port = parsed.port or 6379
    if '@' not in netloc and password:
        userinfo = f':{quote(password, safe="")}@'
        netloc = f'{userinfo}{host}:{port}'
    elif not netloc:
        netloc = f'{host}:{port}'
    return urlunparse((parsed.scheme or 'redis', netloc, f'/{db}', '', '', ''))


def _get_pool(db: int) -> redis.ConnectionPool | None:
    base_url = Config.REDIS_URL
    if not base_url or not base_url.strip():
        return None
    url = _inject_password_and_db(base_url, db)
    socket_timeout = max(Config.REDIS_SOCKET_TIMEOUT_MS, 1) / 1000
    connect_timeout = max(Config.REDIS_CONNECT_TIMEOUT_MS, 1) / 1000
    return redis.ConnectionPool.from_url(
        url,
        decode_responses=True,
        health_check_interval=30,
        socket_timeout=socket_timeout,
        socket_connect_timeout=connect_timeout,
    )


def get_redis(db: int | None = None) -> Redis | None:
    """Возвращает клиент Redis для логической БД `db` или None если URL не задан."""
    if db is None:
        db = Config.REDIS_DB_LEADERBOARD
    if not Config.REDIS_URL or not Config.REDIS_URL.strip():
        return None
    with _pool_lock:
        if db not in _pools or _pools[db] is None:
            try:
                _pools[db] = _get_pool(db)
            except (redis.RedisError, OSError, ValueError) as exc:
                _rate_limited_warning('Redis pool init failed: %s', type(exc).__name__)
                _pools[db] = None
        pool = _pools[db]
    if pool is None:
        return None
    try:
        return redis.Redis(connection_pool=pool)
    except (redis.RedisError, OSError, ValueError) as exc:
        _rate_limited_warning('Redis client init failed: %s', type(exc).__name__)
        return None


def reset_redis_pools_for_tests() -> None:
    with _pool_lock:
        for pool in _pools.values():
            if pool is not None:
                try:
                    pool.disconnect()
                except Exception:
                    pass
        _pools.clear()
    global _negative_ping_until
    with _negative_ping_lock:
        _negative_ping_until = 0.0


def redis_available() -> bool:
    global _negative_ping_until
    now = time.monotonic()
    with _negative_ping_lock:
        if now < _negative_ping_until:
            return False
    if not Config.REDIS_URL or not Config.REDIS_URL.strip():
        return False
    client = get_redis(Config.REDIS_DB_LEADERBOARD)
    if client is None:
        with _negative_ping_lock:
            _negative_ping_until = time.monotonic() + NEGATIVE_PING_CACHE_SECONDS
        return False
    try:
        if not client.ping():
            raise redis.RedisError('PING returned false')
        return True
    except (redis.RedisError, OSError) as exc:
        _rate_limited_warning('Redis ping failed: %s', type(exc).__name__)
        with _negative_ping_lock:
            _negative_ping_until = time.monotonic() + NEGATIVE_PING_CACHE_SECONDS
        return False


def redis_ping_with_timeout_ms(timeout_ms: int | None = None) -> bool:
    limit = timeout_ms if timeout_ms is not None else Config.REDIS_HEALTH_PING_MS
    if not Config.REDIS_URL or not Config.REDIS_URL.strip():
        return True
    client = get_redis(Config.REDIS_DB_LEADERBOARD)
    if client is None:
        return False
    try:
        return bool(client.execute_command('PING'))
    except (redis.RedisError, OSError):
        return False
