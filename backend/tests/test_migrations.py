from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import inspect, text

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


class MigrationDisciplineTests(unittest.TestCase):
    def setUp(self) -> None:
        self._apps = []
        self._tempdirs: list[tempfile.TemporaryDirectory[str]] = []

    def tearDown(self) -> None:
        for app in self._apps:
            with app.app_context():
                from app.core.db import db

                db.session.remove()
                db.engine.dispose()
        for tempdir in self._tempdirs:
            tempdir.cleanup()

    def create_app(self):
        tempdir = tempfile.TemporaryDirectory()
        self._tempdirs.append(tempdir)
        database_path = Path(tempdir.name) / 'test.db'
        env = {
            'APP_ENV': 'development',
            'SECRET_KEY': 'UnitTestSecretKey123!UnitTestSecretKey123!',
            'DATABASE_URL': f'sqlite:///{database_path.as_posix()}',
            'CLIENT_URL': 'http://localhost:3000',
            'ENABLE_DEMO_DATA': 'false',
            'SUPERADMIN_BOOTSTRAP': 'false',
            'SESSION_COOKIE_SECURE': 'false',
            'METRICS_DEBUG': 'false',
        }

        with patch.dict(os.environ, env, clear=False):
            import app.core.config as config_module
            import app as app_module

            importlib.reload(config_module)
            importlib.reload(app_module)
            app = app_module.create_app()
            app.config.update(TESTING=True)
            self._apps.append(app)
            return app

    def test_upgrade_database_records_ordered_schema_migrations(self):
        app = self.create_app()

        with app.app_context():
            from app.core.db import db
            from app.core.migrations import upgrade_database

            applied = upgrade_database()
            second_run = upgrade_database()
            inspector = inspect(db.engine)
            columns = {column['name'] for column in inspector.get_columns('user_progress')}
            user_columns = {column['name'] for column in inspector.get_columns('users')}
            revisions = [
                row[0]
                for row in db.session.execute(text('SELECT revision FROM schema_migrations ORDER BY revision')).all()
            ]

        self.assertIn('0001_current_schema_baseline', applied)
        self.assertEqual(second_run, [])
        self.assertIn('schema_migrations', inspector.get_table_names())
        self.assertIn('started_at', columns)
        self.assertIn('teacher_approval_status', user_columns)
        self.assertIn('teacher_rejection_expires_at', user_columns)
        self.assertIn('0003_session_and_progress_columns', revisions)
        self.assertIn('0007_teacher_approval_status', revisions)
        self.assertIn('0008_teacher_rejection_expiration', revisions)


if __name__ == '__main__':
    unittest.main()
