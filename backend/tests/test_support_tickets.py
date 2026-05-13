from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


class SupportTicketApiTests(unittest.TestCase):
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

    def create_app(self) -> object:
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
            with app.app_context():
                from app.core.migrations import upgrade_database

                upgrade_database()
            self._apps.append(app)
            return app

    def create_user(self, app, *, email: str, password: str, role: str) -> None:
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.user import User, UserRole

        with app.app_context():
            db.session.add(
                User(
                    full_name=email.split('@')[0],
                    email=email,
                    password_hash=hash_password(password),
                    role=UserRole(role),
                    age_group='middle' if role == 'student' else None,
                )
            )
            db.session.commit()

    def login(self, client, login: str, password: str) -> None:
        response = client.post('/api/auth/login', json={'login': login, 'password': password})
        self.assertEqual(response.status_code, 200)

    def test_ticket_lifecycle_and_messaging_summary(self):
        app = self.create_app()
        self.create_user(app, email='stu@example.com', password='StudentPass123!', role='student')
        self.create_user(app, email='adm@example.com', password='AdminPass123!', role='admin')

        with app.test_client() as client:
            self.login(client, 'stu@example.com', 'StudentPass123!')
            create = client.post(
                '/api/support/tickets',
                json={
                    'category': 'technical',
                    'subject': 'Не открывается урок',
                    'description': 'Браузер Chrome, после входа белый экран.',
                },
            )
            self.assertEqual(create.status_code, 201)
            tid = int(create.get_json()['ticket']['ticket_id'])

            summary = client.get('/api/messaging/summary')
            self.assertEqual(summary.status_code, 200)
            body = summary.get_json()
            self.assertIn('support_tickets', body)
            self.assertEqual(body['support_tickets']['total_unread'], 0)

            detail = client.get(f'/api/support/tickets/{tid}')
            self.assertEqual(detail.status_code, 200)
            self.assertEqual(detail.get_json()['ticket']['status'], 'open')

        with app.test_client() as client:
            self.login(client, 'adm@example.com', 'AdminPass123!')
            listed = client.get('/api/support/staff/tickets')
            self.assertEqual(listed.status_code, 200)
            tickets = listed.get_json()['tickets']
            self.assertEqual(len(tickets), 1)
            self.assertEqual(tickets[0]['ticket_id'], tid)

            reply = client.post(
                f'/api/support/staff/tickets/{tid}/messages',
                json={'body': 'Здравствуйте! Перезапустите браузер.'},
            )
            self.assertEqual(reply.status_code, 201)
            self.assertEqual(reply.get_json()['ticket_summary']['status'], 'in_progress')

        with app.test_client() as client:
            self.login(client, 'stu@example.com', 'StudentPass123!')
            after = client.get('/api/messaging/summary').get_json()
            self.assertGreaterEqual(after['support_tickets']['total_unread'], 1)

            read = client.post(f'/api/support/tickets/{tid}/read', json={})
            self.assertEqual(read.status_code, 200)
            cleared = client.get('/api/messaging/summary').get_json()
            self.assertEqual(cleared['support_tickets']['total_unread'], 0)
