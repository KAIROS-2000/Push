from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _app_factory(**env_overrides):
    class _H:
        apps = []
        tempdirs: list = []

    holder = _H()

    def create_app():
        tempdir = tempfile.TemporaryDirectory()
        holder.tempdirs.append(tempdir)
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
            holder.apps.append(app)
            return app

    def teardown():
        for app in holder.apps:
            with app.app_context():
                from app.core.db import db

                db.session.remove()
                db.engine.dispose()
        for t in holder.tempdirs:
            t.cleanup()
        holder.apps.clear()
        holder.tempdirs.clear()

    return create_app, teardown


class PhoneHelpersTests(unittest.TestCase):
    def test_normalize_russian_phone_accepts_e164_and_8_format(self):
        from app.core.phone import normalize_russian_phone

        self.assertEqual(normalize_russian_phone("+7 (912) 345-67-89"), "79123456789")
        self.assertEqual(normalize_russian_phone("8 912 345 67 89"), "79123456789")
        self.assertEqual(normalize_russian_phone("9123456789"), "79123456789")

    def test_invalid_phone_returns_none(self):
        from app.core.phone import normalize_russian_phone

        self.assertIsNone(normalize_russian_phone("123"))
        self.assertIsNone(normalize_russian_phone(""))

    def test_is_valid_russian_phone(self):
        from app.core.phone import is_valid_russian_phone

        self.assertTrue(is_valid_russian_phone("79123456789"))
        self.assertFalse(is_valid_russian_phone("89123456789"))


class BillingTests(unittest.TestCase):
    def test_parent_billing_placeholder_is_safe_stub(self):
        from app.core.billing import parent_billing_placeholder
        from app.models.user import User, UserRole

        user = User(
            full_name="P",
            username="p",
            email="p@e.com",
            password_hash="x",
            role=UserRole.PARENT,
        )
        out = parent_billing_placeholder(user)
        self.assertEqual(out["status"], "not_connected")
        self.assertEqual(out["invoices"], [])
        self.assertEqual(out["payment_history"], [])


class SecurityPasswordPolicyTests(unittest.TestCase):
    def test_validate_password_rejects_weak_and_incomplete(self):
        from app.core.security import validate_password

        self.assertIsNotNone(validate_password("short1!"))
        self.assertIsNotNone(validate_password("password"))  # weak list
        self.assertIsNotNone(validate_password("NoDigitHere!!"))
        self.assertIsNotNone(validate_password("nodigitorspecial1"))
        self.assertIsNone(validate_password("ValidPass1!"))


class LearningAssignmentMetaTests(unittest.TestCase):
    def test_encode_decode_assignment_description_round_trip(self):
        from app.models.learning import decode_assignment_description, encode_assignment_description

        body = "Read the material"
        raw = encode_assignment_description(body, "quiz", "link")
        meta, text = decode_assignment_description(raw)
        self.assertIn("assignment_type", meta)
        self.assertEqual(text, body)


class CoreDomainWithDbTests(unittest.TestCase):
    def setUp(self) -> None:
        self._create_app, self._teardown = _app_factory()

    def tearDown(self) -> None:
        self._teardown()

    def _app(self):
        return self._create_app()

    def test_parent_link_code_hash_stable_under_uppercase(self):
        app = self._app()
        with app.app_context():
            from app.services.parent_insights import hash_parent_link_code

            h1 = hash_parent_link_code("abcd1234")
            h2 = hash_parent_link_code("  AbCd1234 ")
            self.assertEqual(h1, h2)

    def test_normalized_module_whitelist_and_lesson_filter(self):
        from app.models.learning import Lesson, Module
        from app.services.parent_insights import (
            lesson_allowed_for_parent,
            normalized_module_whitelist,
        )

        self.assertIsNone(normalized_module_whitelist("x"))
        self.assertIsNone(normalized_module_whitelist([]))
        self.assertEqual(normalized_module_whitelist([" a ", " b "]), {"a", "b"})

        mod = Module(
            id=1, slug="m1", title="M", description="D", age_group="middle", order_index=1
        )
        les = Lesson(
            id=1, module=mod, slug="l1", title="L", summary="S", order_index=1
        )
        self.assertTrue(lesson_allowed_for_parent(les, None))
        self.assertTrue(lesson_allowed_for_parent(les, {"m1"}))
        self.assertFalse(lesson_allowed_for_parent(les, {"other"}))

    def test_compact_progress_report_respects_module_whitelist(self):
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.learning import Lesson, Module, UserProgress
        from app.models.user import User, UserRole
        from app.services.parent_insights import compact_progress_report

        app = self._app()
        with app.app_context():
            a = Module(
                slug="mod-a-unique",
                title="A",
                description="d",
                age_group="middle",
                order_index=1,
            )
            b = Module(
                slug="mod-b-unique",
                title="B",
                description="d",
                age_group="middle",
                order_index=2,
            )
            db.session.add_all([a, b])
            db.session.flush()
            l1 = Lesson(
                module_id=a.id,
                slug="la-u",
                title="L1",
                summary="S",
                order_index=1,
            )
            l2 = Lesson(
                module_id=b.id,
                slug="lb-u",
                title="L2",
                summary="S",
                order_index=1,
            )
            st = User(
                full_name="S",
                username="scompact",
                email="scompact@example.com",
                password_hash=hash_password("StudentPass123!"),
                role=UserRole.STUDENT,
                age_group="middle",
            )
            db.session.add_all([l1, l2, st])
            db.session.flush()
            db.session.add_all(
                [
                    UserProgress(
                        user_id=st.id,
                        lesson_id=l1.id,
                        status="completed",
                        score=80,
                    ),
                    UserProgress(
                        user_id=st.id,
                        lesson_id=l2.id,
                        status="completed",
                        score=60,
                    ),
                ]
            )
            db.session.commit()
            rep = compact_progress_report(st, {"mod-a-unique"})
            self.assertEqual(rep["completed_lessons"], 1)
            self.assertEqual(rep["average_score"], 80.0)

    def test_child_hidden_from_public_catalog(self):
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.parent_cabinet import (
            ParentChildLink,
            ParentSafetySettings,
        )
        from app.models.user import User, UserRole
        from app.services.parent_privacy import child_hidden_from_public_catalog

        app = self._app()
        with app.app_context():
            parent = User(
                full_name="P",
                username="phide",
                email="phide@example.com",
                password_hash=hash_password("ParentPass123!"),
                role=UserRole.PARENT,
            )
            child = User(
                full_name="C",
                username="chide",
                email="chide@example.com",
                password_hash=hash_password("StudentPass123!"),
                role=UserRole.STUDENT,
                age_group="middle",
            )
            db.session.add_all([parent, child])
            db.session.flush()
            db.session.add(
                ParentChildLink(
                    parent_user_id=parent.id,
                    child_user_id=child.id,
                )
            )
            db.session.add(
                ParentSafetySettings(
                    parent_user_id=parent.id,
                    child_user_id=child.id,
                    hide_child_public_profile=True,
                )
            )
            db.session.commit()
            self.assertTrue(child_hidden_from_public_catalog(child.id))

    def test_parent_messaging_respects_communication_consent(self):
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.parent_cabinet import ParentConsentSettings
        from app.models.user import User, UserRole
        from app.services import parent_messaging

        app = self._app()
        with app.app_context():
            parent = User(
                full_name="P",
                username="pmsg",
                email="pmsg@example.com",
                password_hash=hash_password("ParentPass123!"),
                role=UserRole.PARENT,
            )
            child = User(
                full_name="C",
                username="cmsg",
                email="cmsg@example.com",
                password_hash=hash_password("StudentPass123!"),
                role=UserRole.STUDENT,
                age_group="middle",
            )
            db.session.add_all([parent, child])
            db.session.flush()
            db.session.add(
                ParentConsentSettings(
                    parent_user_id=parent.id,
                    child_user_id=child.id,
                    allow_parent_teacher_communication=False,
                )
            )
            db.session.commit()
            self.assertFalse(
                parent_messaging._parent_can_message(  # noqa: SLF001
                    parent.id, child.id
                )
            )

    def test_notify_achievements_respects_consent(self):
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.learning import Achievement
        from app.models.parent_cabinet import (
            ParentChildLink,
            ParentConsentSettings,
            ParentNotification,
        )
        from app.models.user import User, UserRole
        from app.services import parent_event_notifications

        app = self._app()
        with app.app_context():
            parent = User(
                full_name="P",
                username="pnot",
                email="pnot@example.com",
                password_hash=hash_password("ParentPass123!"),
                role=UserRole.PARENT,
            )
            st = User(
                full_name="Child Name",
                username="cnot",
                email="cnot@example.com",
                password_hash=hash_password("StudentPass123!"),
                role=UserRole.STUDENT,
                age_group="middle",
            )
            db.session.add_all([parent, st])
            db.session.flush()
            db.session.add(
                ParentChildLink(
                    parent_user_id=parent.id,
                    child_user_id=st.id,
                )
            )
            ach = Achievement.query.filter_by(code="first_code").first()
            self.assertIsNotNone(ach)

            parent_event_notifications.notify_achievements_earned(st, [ach])
            db.session.commit()
            n = ParentNotification.query.filter_by(
                parent_user_id=parent.id, child_user_id=st.id
            ).count()
            self.assertEqual(n, 1)

            for row in ParentNotification.query.filter_by(parent_user_id=parent.id).all():
                db.session.delete(row)
            db.session.add(
                ParentConsentSettings(
                    parent_user_id=parent.id,
                    child_user_id=st.id,
                    allow_notifications=False,
                )
            )
            db.session.commit()
            parent_event_notifications.notify_achievements_earned(st, [ach])
            db.session.commit()
            n2 = ParentNotification.query.filter_by(
                parent_user_id=parent.id, child_user_id=st.id
            ).count()
            self.assertEqual(n2, 0)

    def test_sync_achievements_purges_for_non_student(self):
        from app.core.achievements import sync_achievements_for_user
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.learning import Achievement, UserAchievement
        from app.models.user import User, UserRole

        app = self._app()
        with app.app_context():
            t = User(
                full_name="T",
                username="tach",
                email="tach@example.com",
                password_hash=hash_password("TeacherPass123!"),
                role=UserRole.TEACHER,
            )
            db.session.add(t)
            db.session.flush()
            one = Achievement.query.first()
            self.assertIsNotNone(one)
            db.session.add(UserAchievement(user_id=t.id, achievement_id=one.id))
            t.xp = int(one.xp_reward)
            db.session.commit()
            out = sync_achievements_for_user(t, award_xp=True)
            self.assertEqual(out, [])
            self.assertEqual(
                UserAchievement.query.filter_by(user_id=t.id).count(),
                0,
            )
            self.assertEqual(t.xp, 0)

    def test_sync_achievements_marathon_from_streak(self):
        from app.core.achievements import sync_achievements_for_user
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.learning import UserAchievement
        from app.models.user import User, UserRole

        app = self._app()
        with app.app_context():
            st = User(
                full_name="S",
                username="smar",
                email="smar@example.com",
                password_hash=hash_password("StudentPass123!"),
                role=UserRole.STUDENT,
                age_group="middle",
                streak=30,
            )
            db.session.add(st)
            db.session.commit()
            earned = sync_achievements_for_user(st, award_xp=True)
            codes = {a.code for a in earned}
            self.assertIn("marathon", codes)
            self.assertGreater(
                UserAchievement.query.filter_by(user_id=st.id).count(),
                0,
            )

    def test_sync_achievements_first_code(self):
        from app.core.achievements import sync_achievements_for_user
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.learning import Lesson, Module, Task, UserProgress
        from app.models.user import User, UserRole

        app = self._app()
        with app.app_context():
            mod = Module(
                slug="ach-mod-u",
                title="M",
                description="d",
                age_group="middle",
                order_index=99,
            )
            db.session.add(mod)
            db.session.flush()
            les = Lesson(
                module_id=mod.id,
                slug="ach-les-u",
                title="L",
                summary="S",
                order_index=1,
            )
            db.session.add(les)
            db.session.flush()
            db.session.add(
                Task(
                    lesson_id=les.id,
                    task_type="code",
                    title="T",
                    prompt="Write print('hello') to stdout",
                    validation={"mode": "keywords"},
                )
            )
            st = User(
                full_name="St",
                username="sfc",
                email="sfc@example.com",
                password_hash=hash_password("StudentPass123!"),
                role=UserRole.STUDENT,
                age_group="middle",
            )
            db.session.add(st)
            db.session.flush()
            db.session.add(
                UserProgress(
                    user_id=st.id,
                    lesson_id=les.id,
                    status="completed",
                    score=100,
                    attempts=1,
                )
            )
            db.session.commit()
            earned = {a.code for a in sync_achievements_for_user(st, award_xp=True)}
            self.assertIn("first_code", earned)

    def test_sync_achievements_perfect_five(self):
        from app.core.achievements import sync_achievements_for_user
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.learning import Lesson, Module, UserProgress
        from app.models.user import User, UserRole

        app = self._app()
        with app.app_context():
            mod = Module(
                slug="pfive-mod",
                title="M",
                description="d",
                age_group="middle",
                order_index=100,
            )
            db.session.add(mod)
            db.session.flush()
            t0 = datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC)
            st = User(
                full_name="Sp",
                username="spfive",
                email="spfive@example.com",
                password_hash=hash_password("StudentPass123!"),
                role=UserRole.STUDENT,
                age_group="middle",
            )
            db.session.add(st)
            db.session.flush()
            for i in range(5):
                les = Lesson(
                    module_id=mod.id,
                    slug=f"pfive-lesson-{i}",
                    title="L",
                    summary="S",
                    order_index=i,
                )
                db.session.add(les)
                db.session.flush()
                at = t0 + timedelta(minutes=i)
                db.session.add(
                    UserProgress(
                        user_id=st.id,
                        lesson_id=les.id,
                        status="completed",
                        score=100,
                        attempts=1,
                        started_at=at,
                        completed_at=at,
                    )
                )
            db.session.commit()
            codes = {a.code for a in sync_achievements_for_user(st, award_xp=True)}
            self.assertIn("perfect_five", codes)


if __name__ == "__main__":
    unittest.main()
