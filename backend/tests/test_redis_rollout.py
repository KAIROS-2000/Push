from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import fakeredis
from flask import Flask

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


class RedisClientHelpersTests(unittest.TestCase):
    def tearDown(self) -> None:
        from app.core import redis_client

        redis_client.reset_redis_pools_for_tests()

    def test_redis_key_contains_env_slug(self):
        with patch.dict(os.environ, {'APP_ENV': 'staging-test'}, clear=False):
            import app.core.config as config_module
            import app.core.redis_client as rc

            importlib.reload(config_module)
            importlib.reload(rc)
            try:
                k = rc.redis_key('leaderboard', 'global', 'all')
            finally:
                importlib.reload(config_module)
                importlib.reload(rc)
        self.assertIn('staging-test', k)
        self.assertTrue(k.startswith('progyx:'))


class ThrottleRedisTests(unittest.TestCase):
    def setUp(self) -> None:
        self._fake = fakeredis.FakeStrictRedis(decode_responses=True)
        self._patcher = patch(
            'app.core.throttle_redis.get_redis',
            side_effect=lambda db=None: self._fake,
        )
        self._patcher.start()

    def tearDown(self) -> None:
        self._patcher.stop()

    def test_register_scope_blocks_after_limit(self):
        app = Flask(__name__)
        app.config['REGISTER_RATE_LIMIT_WINDOW_SECONDS'] = 600
        app.config['REGISTER_RATE_LIMIT_MAX_FAILURES'] = 3
        app.config['REGISTER_RATE_LIMIT_BLOCK_SECONDS'] = 60
        with app.app_context():
            from app.core import throttle_redis

            self.assertTrue(throttle_redis.throttle_check_allowed('register', 'a@b.c', '1.1.1.1'))
            throttle_redis.throttle_register_failure('register', 'a@b.c', '1.1.1.1')
            throttle_redis.throttle_register_failure('register', 'a@b.c', '1.1.1.1')
            self.assertTrue(throttle_redis.throttle_check_allowed('register', 'a@b.c', '1.1.1.1'))
            throttle_redis.throttle_register_failure('register', 'a@b.c', '1.1.1.1')
            self.assertFalse(throttle_redis.throttle_check_allowed('register', 'a@b.c', '1.1.1.1'))
            throttle_redis.throttle_clear('register', 'a@b.c', '1.1.1.1')
            self.assertTrue(throttle_redis.throttle_check_allowed('register', 'a@b.c', '1.1.1.1'))


class LeaderboardRedisCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        self._fake = fakeredis.FakeStrictRedis(decode_responses=True)
        patcher_avail = patch('app.core.redis_client.redis_available', return_value=True)
        patcher_get = patch(
            'app.core.redis_client.get_redis',
            side_effect=lambda db=None: self._fake,
        )
        patcher_avail.start()
        patcher_get.start()
        self._patchers = (patcher_avail, patcher_get)

    def tearDown(self) -> None:
        for p in self._patchers:
            p.stop()
        from app.core import redis_client

        redis_client.reset_redis_pools_for_tests()

    def test_leaderboard_roundtrip_json(self):
        from app.api.student import (
            GLOBAL_LEADERBOARD_CACHE_KEY_ALL,
            _read_leaderboard_from_cache,
            _write_leaderboard_to_cache,
        )

        rows = [
            {'id': 1, 'position': 1, 'full_name': 'U', 'xp': 10, 'level': 1, 'age_group': 'middle'}
        ]
        _write_leaderboard_to_cache(GLOBAL_LEADERBOARD_CACHE_KEY_ALL, rows)
        got = _read_leaderboard_from_cache(GLOBAL_LEADERBOARD_CACHE_KEY_ALL)
        self.assertEqual(got, rows)


class MaintenanceFlagTests(unittest.TestCase):
    def test_maintenance_blocks_unsafe_request(self):
        tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(tempdir.cleanup)
        database_path = Path(tempdir.name) / 'test.db'
        env = {
            'APP_ENV': 'development',
            'SECRET_KEY': 'UnitTestSecretKey123!UnitTestSecretKey123!',
            'DATABASE_URL': f'sqlite:///{database_path.as_posix()}',
            'CLIENT_URL': 'http://localhost:3000',
            'ENABLE_DEMO_DATA': 'false',
            'SUPERADMIN_BOOTSTRAP': 'false',
            'SESSION_COOKIE_SECURE': 'false',
            'GIGACHAT_VERIFY_SSL': 'true',
            'CODE_JUDGE_RUNNER_URL': '',
            'CODE_JUDGE_RUNNER_TOKEN': '',
            'METRICS_DEBUG': 'false',
            'SESSION_VERSION_CACHE': 'off',
        }
        fake = fakeredis.FakeStrictRedis(decode_responses=True)
        with patch.dict(os.environ, env, clear=False):
            import app.core.config as config_module
            import app as app_module

            importlib.reload(config_module)
            importlib.reload(app_module)
            app = app_module.create_app()
            app.config.update(TESTING=True)
            with app.app_context():
                from app.core.redis_client import redis_key

                fake.set(redis_key('flags', 'maintenance'), '1')

            with patch('app.core.redis_client.get_redis', return_value=fake):
                client = app.test_client()
                response = client.post('/api/auth/login', json={'login': 'x', 'password': 'y'})
                self.assertEqual(response.status_code, 503)


if __name__ == '__main__':
    unittest.main()
