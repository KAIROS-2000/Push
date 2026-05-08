"""P3a regression: backend strings surfaced inside the parent cabinet must avoid
the explicitly-banned negative vocabulary.

This test does NOT police the entire codebase — only the parent-facing fields
that flow into ParentSummary / notifications. Teacher/student UI
intentionally keeps its existing wording (e.g. "ошибки" as a programming term).
"""
from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


# Substring matches against str.lower(); cover Cyrillic stems plus their inflections.
BANNED_FRAGMENTS = (
    "не выполн",
    "не сдал",
    "не справил",
    "не достиг",
    "ошибк",
    "провал",
    "неуспех",
    "неудач",
    "отстал",
    "отстаёт",
    "отстает",
    "плохо",
    "слаб",
    "пробел",
    "регресс",
    "снижен",
    "упал",
    "застрял",
    "тупик",
    "нужно исправ",
    "разобрать ошибк",
)


def assert_clean_parent_text(test: unittest.TestCase, value: object, where: str) -> None:
    if not isinstance(value, str):
        return
    lowered = value.lower()
    for banned in BANNED_FRAGMENTS:
        test.assertNotIn(
            banned,
            lowered,
            f"Banned fragment '{banned}' found in parent-facing string at {where}: {value!r}",
        )


class ParentInsightsCopyPositivityTests(unittest.TestCase):
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

    def _create_app(self):
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
            'SESSION_COOKIE_SAMESITE': 'Strict',
            'GIGACHAT_VERIFY_SSL': 'true',
            'CODE_JUDGE_RUNNER_URL': '',
            'CODE_JUDGE_RUNNER_TOKEN': '',
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
                from app.core.db import db
                from app.core.runtime_schema import ensure_runtime_schema

                db.create_all()
                ensure_runtime_schema()
            self._apps.append(app)
            return app

    def _make_student_with_needs_revision_lesson(self, app):
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.learning import Lesson, Module, UserProgress
        from app.models.user import User, UserRole

        with app.app_context():
            student = User(
                full_name='Test Child',
                email='child@example.com',
                password_hash=hash_password('StudentPass123!'),
                role=UserRole.STUDENT,
                age_group='middle',
            )
            db.session.add(student)
            db.session.flush()
            module = Module(
                slug='copy-test-mod',
                title='Module',
                description='d',
                age_group='middle',
                icon='code',
                color='#000',
                order_index=900,
                is_published=True,
            )
            db.session.add(module)
            db.session.flush()
            lesson = Lesson(
                module_id=module.id,
                slug='copy-test-l1',
                title='Lesson 1',
                summary='s',
                order_index=1,
                passing_score=70,
                theory_blocks=[],
                interactive_steps=[],
                is_published=True,
            )
            db.session.add(lesson)
            db.session.flush()
            db.session.add(
                UserProgress(
                    user_id=student.id,
                    lesson_id=lesson.id,
                    status='needs_revision',
                    score=40,
                    attempts=5,
                    started_at=datetime.now(UTC),
                )
            )
            db.session.commit()
            return student.id

    def test_weekly_digest_narrative_uses_positive_framing(self):
        app = self._create_app()
        student_id = self._make_student_with_needs_revision_lesson(app)

        with app.app_context():
            from app.models.user import User
            from app.services.parent_insights import (
                activity_trend_text,
                weekly_digest_narrative,
            )

            student = User.query.get(student_id)
            assert_clean_parent_text(
                self,
                weekly_digest_narrative(student, allowed_module_slugs=None),
                'weekly_digest_narrative',
            )
            assert_clean_parent_text(
                self,
                activity_trend_text(student, allowed_module_slugs=None),
                'activity_trend_text',
            )


if __name__ == '__main__':
    unittest.main()
