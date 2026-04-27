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


class StaffMessagingTests(unittest.TestCase):
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
        database_path = Path(tempdir.name) / "test.db"
        env = {
            "APP_ENV": "development",
            "SECRET_KEY": "UnitTestSecretKey123!UnitTestSecretKey123!",
            "DATABASE_URL": f"sqlite:///{database_path.as_posix()}",
            "CLIENT_URL": "http://localhost:3000",
            "ENABLE_DEMO_DATA": "false",
            "SUPERADMIN_BOOTSTRAP": "false",
            "SESSION_COOKIE_SECURE": "false",
            "GIGACHAT_VERIFY_SSL": "true",
            "METRICS_DEBUG": "false",
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

    def create_user(self, app, *, username: str, email: str, role: str, password: str = "TestPass123!") -> int:
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.user import User, UserRole

        with app.app_context():
            user = User(
                full_name=username,
                username=username,
                email=email,
                password_hash=hash_password(password),
                role=UserRole(role),
            )
            db.session.add(user)
            db.session.commit()
            return user.id

    def login(self, client, login: str, password: str) -> None:
        r = client.post("/api/auth/login", json={"login": login, "password": password})
        self.assertEqual(r.status_code, 200)

    def test_admin_starts_thread_student_replies_and_summary_includes_staff_direct(self):
        app = self.create_app()
        admin_id = self.create_user(app, username="adm1", email="a@t.com", role="admin")
        stud_id = self.create_user(app, username="stu1", email="s@t.com", role="student")

        with app.test_client() as client:
            self.login(client, "a@t.com", "TestPass123!")
            start = client.post(
                "/api/staff-messaging/threads",
                json={"peer_id": stud_id, "body": "Hello from admin"},
            )
            self.assertEqual(start.status_code, 201, start.get_json())
            thread_id = start.get_json()["thread"]["thread_id"]

            self.login(client, "s@t.com", "TestPass123!")
            reply = client.post(
                f"/api/staff-messaging/threads/{thread_id}/messages",
                json={"body": "Hi admin"},
            )
            self.assertEqual(reply.status_code, 201, reply.get_json())

            summ = client.get("/api/messaging/summary")
            self.assertEqual(summ.status_code, 200)
            body = summ.get_json()
            self.assertIn("staff_direct", body)
            sd = body["staff_direct"]
            self.assertEqual(sd["total_unread"], 1)
            self.assertEqual(len(sd["threads"]), 1)
            self.assertEqual(sd["threads"][0]["other"]["id"], admin_id)

        with app.test_client() as client:
            self.login(client, "a@t.com", "TestPass123!")
            admin_sum = client.get("/api/staff-messaging/summary")
            self.assertEqual(admin_sum.status_code, 200)
            s = admin_sum.get_json()
            self.assertIn("directory", s)
            self.assertGreaterEqual(len(s["directory"]["teachers"]), 0)

    def test_non_staff_cannot_search_users(self):
        app = self.create_app()
        self.create_user(app, username="t1", email="t1@t.com", role="teacher")
        with app.test_client() as client:
            self.login(client, "t1@t.com", "TestPass123!")
            r = client.get("/api/staff-messaging/search-users?q=stu")
            self.assertEqual(r.status_code, 403)

    def test_parent_messaging_summary_ok_and_staff_block(self):
        app = self.create_app()
        self.create_user(app, username="p1", email="p1@t.com", role="parent")
        with app.test_client() as client:
            self.login(client, "p1@t.com", "TestPass123!")
            r = client.get("/api/messaging/summary")
            self.assertEqual(r.status_code, 200, r.get_json())
            data = r.get_json()
            self.assertEqual(data["role"], "parent")
            self.assertIn("staff_direct", data)
            self.assertEqual(data["classes"], [])

    def test_two_staff_share_one_thread_pair(self):
        app = self.create_app()
        a1_id = self.create_user(app, username="a1", email="a1@t.com", role="admin")
        a2_id = self.create_user(app, username="a2", email="a2@t.com", role="admin")
        with app.test_client() as client:
            self.login(client, "a1@t.com", "TestPass123!")
            first = client.post(
                "/api/staff-messaging/threads",
                json={"peer_id": a2_id, "body": "hey"},
            )
            self.assertEqual(first.status_code, 201, first.get_json())
            tid1 = first.get_json()["thread"]["thread_id"]
        with app.test_client() as client:
            self.login(client, "a2@t.com", "TestPass123!")
            second = client.post(
                "/api/staff-messaging/threads",
                json={"peer_id": a1_id, "body": "reply back"},
            )
            self.assertEqual(second.status_code, 201, second.get_json())
            tid2 = second.get_json()["thread"]["thread_id"]
        self.assertEqual(tid1, tid2)


if __name__ == "__main__":
    unittest.main()
