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


class AdminManagementRegressionTests(unittest.TestCase):
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
            'GIGACHAT_VERIFY_SSL': 'true',
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
                from app import models  # noqa: F401
                from app.core.db import db
                from app.core.runtime_schema import ensure_runtime_schema

                db.create_all()
                ensure_runtime_schema()
            self._apps.append(app)
            return app

    def create_user(
        self,
        app,
        *,
        full_name: str,
        username: str,
        email: str,
        password: str,
        role: str,
        age_group: str | None = None,
    ) -> int:
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.user import User, UserRole

        with app.app_context():
            user = User(
                full_name=full_name,
                username=username,
                email=email,
                password_hash=hash_password(password),
                role=UserRole(role),
                age_group=age_group,
            )
            db.session.add(user)
            db.session.commit()
            return user.id

    def login(self, client, login: str, password: str):
        return client.post('/api/auth/login', json={'login': login, 'password': password})

    def test_admin_can_filter_and_block_students_and_teachers(self):
        app = self.create_app()
        admin_id = self.create_user(
            app,
            full_name='Admin Example',
            username='admin',
            email='admin@example.com',
            password='AdminPass123!',
            role='admin',
            age_group='adult',
        )
        student_id = self.create_user(
            app,
            full_name='Alice Student',
            username='alice',
            email='alice@example.com',
            password='StudentPass123!',
            role='student',
            age_group='middle',
        )
        self.create_user(
            app,
            full_name='Boris Teacher',
            username='mentor',
            email='mentor@example.com',
            password='TeacherPass123!',
            role='teacher',
            age_group='adult',
        )
        secondary_admin_id = self.create_user(
            app,
            full_name='Ops Admin',
            username='opsadmin',
            email='opsadmin@example.com',
            password='OpsAdminPass123!',
            role='admin',
            age_group='adult',
        )

        with app.test_client() as admin_client:
            login_response = self.login(admin_client, 'admin@example.com', 'AdminPass123!')
            self.assertEqual(login_response.status_code, 200)

            filtered = admin_client.get('/api/admin/users?username=ali&status=active&page=1&page_size=10')
            self.assertEqual(filtered.status_code, 200)
            filtered_payload = filtered.get_json()
            self.assertEqual(filtered_payload['pagination']['total'], 1)
            self.assertEqual(filtered_payload['users'][0]['username'], 'alice')

            invalid_target = admin_client.patch(f'/api/admin/users/{secondary_admin_id}/block')
            self.assertEqual(invalid_target.status_code, 400)

            block_response = admin_client.patch(f'/api/admin/users/{student_id}/block')
            self.assertEqual(block_response.status_code, 200)
            self.assertFalse(block_response.get_json()['user']['is_active'])

            audit_response = admin_client.get('/api/admin/audit-logs?action=user_blocked&target=alice')
            self.assertEqual(audit_response.status_code, 200)
            audit_payload = audit_response.get_json()
            self.assertEqual(audit_payload['pagination']['total'], 1)
            self.assertEqual(audit_payload['audit_logs'][0]['actor_user_id'], admin_id)
            self.assertEqual(audit_payload['audit_logs'][0]['details']['target_role'], 'student')

        with app.test_client() as blocked_user_client:
            blocked_login = self.login(blocked_user_client, 'alice', 'StudentPass123!')
            self.assertEqual(blocked_login.status_code, 403)

    def test_blocked_user_refresh_is_rejected_after_admin_block(self):
        app = self.create_app()
        self.create_user(
            app,
            full_name='Admin Example',
            username='admin',
            email='admin@example.com',
            password='AdminPass123!',
            role='admin',
            age_group='adult',
        )
        student_id = self.create_user(
            app,
            full_name='Refresh Student',
            username='refresh1',
            email='refresh1@example.com',
            password='StudentPass123!',
            role='student',
            age_group='middle',
        )

        student_client = app.test_client()
        admin_client = app.test_client()

        student_login = self.login(student_client, 'refresh1', 'StudentPass123!')
        self.assertEqual(student_login.status_code, 200)

        admin_login = self.login(admin_client, 'admin@example.com', 'AdminPass123!')
        self.assertEqual(admin_login.status_code, 200)
        block_response = admin_client.patch(f'/api/admin/users/{student_id}/block')
        self.assertEqual(block_response.status_code, 200)

        refresh_response = student_client.post('/api/auth/refresh')
        self.assertEqual(refresh_response.status_code, 401)
        self.assertEqual(refresh_response.get_json()['code'], 'session_revoked')

    def test_blocked_user_existing_access_cookie_is_rejected_on_me_endpoint(self):
        app = self.create_app()
        self.create_user(
            app,
            full_name='Admin Example',
            username='admin',
            email='admin@example.com',
            password='AdminPass123!',
            role='admin',
            age_group='adult',
        )
        student_id = self.create_user(
            app,
            full_name='Active Student',
            username='active1',
            email='active1@example.com',
            password='StudentPass123!',
            role='student',
            age_group='middle',
        )

        student_client = app.test_client()
        admin_client = app.test_client()

        student_login = self.login(student_client, 'active1', 'StudentPass123!')
        self.assertEqual(student_login.status_code, 200)

        admin_login = self.login(admin_client, 'admin@example.com', 'AdminPass123!')
        self.assertEqual(admin_login.status_code, 200)
        block_response = admin_client.patch(f'/api/admin/users/{student_id}/block')
        self.assertEqual(block_response.status_code, 200)

        me_response = student_client.get('/api/auth/me')
        self.assertEqual(me_response.status_code, 401)
        self.assertIn(me_response.get_json().get('code'), {'session_revoked', 'user_blocked'})

    def test_superadmin_can_manage_admins_and_filter_audit_logs(self):
        app = self.create_app()
        self.create_user(
            app,
            full_name='Super Admin',
            username='root',
            email='root@example.com',
            password='RootPass123!',
            role='superadmin',
            age_group='adult',
        )

        with app.test_client() as superadmin_client:
            login_response = self.login(superadmin_client, 'root@example.com', 'RootPass123!')
            self.assertEqual(login_response.status_code, 200)

            create_response = superadmin_client.post(
                '/api/admin/admins',
                json={
                    'full_name': 'Operations Admin',
                    'email': 'ops@example.com',
                    'username': 'opsadmin',
                    'password': 'OpsAdminPass123!',
                },
            )
            self.assertEqual(create_response.status_code, 201)
            admin_id = create_response.get_json()['user']['id']

            admins_response = superadmin_client.get('/api/admin/admins?username=ops&status=active')
            self.assertEqual(admins_response.status_code, 200)
            admins_payload = admins_response.get_json()
            self.assertEqual(admins_payload['pagination']['total'], 1)
            self.assertEqual(admins_payload['admins'][0]['username'], 'opsadmin')

            block_response = superadmin_client.patch(f'/api/admin/admins/{admin_id}/block')
            self.assertEqual(block_response.status_code, 200)
            self.assertFalse(block_response.get_json()['user']['is_active'])

            audit_response = superadmin_client.get(
                '/api/admin/audit-logs?action=admin_blocked&actor_role=superadmin&target=opsadmin'
            )
            self.assertEqual(audit_response.status_code, 200)
            audit_payload = audit_response.get_json()
            self.assertEqual(audit_payload['pagination']['total'], 1)
            self.assertEqual(audit_payload['audit_logs'][0]['details']['target_username'], 'opsadmin')

            delete_response = superadmin_client.delete(f'/api/admin/admins/{admin_id}')
            self.assertEqual(delete_response.status_code, 200)


if __name__ == '__main__':
    unittest.main()
