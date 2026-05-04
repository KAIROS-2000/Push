from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from unittest.mock import patch
from datetime import UTC, datetime, timedelta
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


class ParentCabinetTests(unittest.TestCase):
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

    def create_app(self, **env_overrides):
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
            "CODE_JUDGE_RUNNER_URL": "",
            "CODE_JUDGE_RUNNER_TOKEN": "",
            "METRICS_DEBUG": "false",
        }
        env.update(env_overrides)
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
                from app.seed.bootstrap import seed_all

                db.create_all()
                ensure_runtime_schema()
                seed_all(enable_demo_data=False)
            self._apps.append(app)
            return app

    def test_parent_registration_and_link_child(self):
        app = self.create_app()
        with app.test_client() as client:
            # Parent self-signup is now email-only. Backend generates the
            # password and sends it by mail; we don't post a password here.
            r = client.post(
                "/api/auth/register",
                json={"email": "parent1@example.com", "role": "parent"},
            )
            self.assertEqual(r.status_code, 201, r.get_data(as_text=True))
            payload = r.get_json() or {}
            # Session is created immediately for parent (cookies set on response).
            cookies = r.headers.getlist("Set-Cookie")
            self.assertTrue(
                any("codequest_access_token=" in cookie for cookie in cookies),
                f"Expected access cookie on parent register, got: {cookies}",
            )
            self.assertEqual(
                payload.get("parent_profile_required_fields"),
                ["full_name", "phone", "email_verified"],
            )

        with app.app_context():
            from app.core.db import db
            from app.core.security import hash_password
            from app.models.parent_cabinet import ParentLinkCode
            from app.models.user import User, UserRole
            from app.services.parent_insights import (
                generate_parent_link_code_plain,
                hash_parent_link_code,
            )

            st = User(
                full_name="Child",
                email="c1@example.com",
                password_hash=hash_password("StudentPass123!"),
                role=UserRole.STUDENT,
                age_group="middle",
                email_verified=True,
            )
            db.session.add(st)
            db.session.commit()
            child_id = st.id
            plain = generate_parent_link_code_plain()
            ch = hash_parent_link_code(plain)
            db.session.add(
                ParentLinkCode(
                    child_user_id=child_id,
                    code_hash=ch,
                    expires_at=datetime.now(UTC) + timedelta(days=1),
                )
            )
            # Pre-fill the parent profile + verification so we can exercise
            # the success path; the "incomplete profile" path is covered by
            # test_parent_link_blocked_until_profile_complete below.
            parent = User.query.filter_by(email="parent1@example.com").first()
            parent.full_name = "Родитель"
            parent.phone = "+79990003344"
            parent.email_verified = True
            db.session.commit()

        with app.test_client() as client:
            # Re-login is needed because the previous client context exited
            # and discarded its cookie jar; the password was generated on the
            # server, so we set a known one in DB for this leg.
            with app.app_context():
                from app.core.db import db
                from app.core.security import hash_password
                from app.models.user import User

                parent = User.query.filter_by(email="parent1@example.com").first()
                parent.password_hash = hash_password("ParentPass123!")
                db.session.commit()

            client.post(
                "/api/auth/login",
                json={"login": "parent1@example.com", "password": "ParentPass123!"},
            )
            res = client.post(
                "/api/parent/children/link",
                json={"code": plain},
            )
            self.assertEqual(res.status_code, 201, res.get_data(as_text=True))

        with app.app_context():
            from app.models.parent_cabinet import ParentChildLink, ParentLinkCode
            from app.models.user import User

            parent = User.query.filter_by(email="parent1@example.com").first()
            self.assertIsNotNone(parent)
            self.assertEqual(ParentChildLink.query.filter_by(parent_user_id=parent.id).count(), 1)
            self.assertIsNotNone(ParentLinkCode.query.filter_by(child_user_id=child_id).first().used_at)

        with app.test_client() as client:
            client.post(
                "/api/auth/login",
                json={"login": "parent1@example.com", "password": "ParentPass123!"},
            )
            res = client.get(f"/api/parent/children/{child_id}/digest")
            self.assertEqual(res.status_code, 200)
            self.assertIn("paragraph", res.get_json() or {})

    def test_parent_link_blocked_until_profile_complete(self):
        """Parent must fill name + phone AND verify email before linking a child."""

        app = self.create_app()
        with app.test_client() as client:
            r = client.post(
                "/api/auth/register",
                json={"email": "parent2@example.com", "role": "parent"},
            )
            self.assertEqual(r.status_code, 201, r.get_data(as_text=True))

            res = client.post(
                "/api/parent/children/link",
                json={"code": "AAAAAAAAAAAA"},
            )
            self.assertEqual(res.status_code, 400)
            body = res.get_json() or {}
            self.assertEqual(body.get("code"), "parent_profile_incomplete")
            self.assertEqual(
                set(body.get("missing_fields") or []),
                {"full_name", "phone", "email_verified"},
            )

            status = client.get("/api/parent/profile/status")
            self.assertEqual(status.status_code, 200)
            status_body = status.get_json() or {}
            self.assertFalse(status_body.get("ready_to_link_child"))
            self.assertEqual(
                set(status_body.get("missing_fields") or []),
                {"full_name", "phone", "email_verified"},
            )

    def test_parent_messaging_threads_lists_classroom_contacts_for_child_in_class(self):
        app = self.create_app()
        with app.app_context():
            from app.core.db import db
            from app.core.security import hash_password
            from app.models.learning import ClassMembership, Classroom
            from app.models.parent_cabinet import ParentChildLink
            from app.models.user import TEACHER_APPROVAL_APPROVED, User, UserRole

            parent = User(
                full_name="Par",
                email="parcc@example.com",
                password_hash=hash_password("ParentPass123!"),
                role=UserRole.PARENT,
            )
            teacher = User(
                full_name="Teach",
                email="teacc@example.com",
                password_hash=hash_password("TeacherPass123!"),
                role=UserRole.TEACHER,
                teacher_approval_status=TEACHER_APPROVAL_APPROVED,
            )
            student = User(
                full_name="Stud",
                email="stacc@example.com",
                password_hash=hash_password("StudentPass123!"),
                role=UserRole.STUDENT,
                age_group="middle",
            )
            db.session.add_all([parent, teacher, student])
            db.session.flush()
            cr = Classroom(name="Cls1", description="d", code="ZZZ001", teacher_id=teacher.id)
            db.session.add(cr)
            db.session.flush()
            db.session.add(ClassMembership(classroom_id=cr.id, student_id=student.id))
            db.session.add(
                ParentChildLink(parent_user_id=parent.id, child_user_id=student.id, active=True)
            )
            db.session.commit()
            parent_email = parent.email
            classroom_id = cr.id

        with app.test_client() as client:
            client.post(
                "/api/auth/login",
                json={"login": parent_email, "password": "ParentPass123!"},
            )
            res = client.get("/api/parent/messaging/threads")
            self.assertEqual(res.status_code, 200, res.get_data(as_text=True))
            payload = res.get_json() or {}
            self.assertIn("classroom_contacts", payload)
            contacts = payload["classroom_contacts"]
            self.assertEqual(len(contacts), 1)
            self.assertIsNone(contacts[0].get("thread_id"))
            self.assertEqual(contacts[0]["classroom"]["id"], classroom_id)


if __name__ == "__main__":
    unittest.main()
