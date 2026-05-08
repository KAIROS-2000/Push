"""End-to-end tests for the email verification & password-reset flows.

These tests intentionally do NOT touch the network. The Unisender Go HTTP
transport is replaced by a recording stub that lets each test inspect the
last delivery attempt. The token persistence layer is exercised end-to-end
so we cover hashing, TTL, single-use semantics, and rate limiting.
"""

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


class _RecordingMailer:
    """Drop-in replacement for `_send_via_unisender_go` that records calls.

    The real provider is never contacted in tests. Each captured call exposes
    the full payload so we can assert subject lines, recipient, and that the
    raw token was actually embedded in the email body.
    """

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def __call__(
        self,
        *,
        to: str,
        subject: str,
        html: str,
        text: str | None,
        metadata: dict | None,
    ):
        from app.services.email_service import EmailDeliveryResult

        self.calls.append(
            {
                'to': to,
                'subject': subject,
                'html': html,
                'text': text,
                'metadata': metadata,
            }
        )
        return EmailDeliveryResult(
            provider='unisender_go',
            accepted=True,
            message_id=f'recorded-{len(self.calls)}',
        )


def _extract_token_from_html(html: str) -> str:
    marker = 'token='
    idx = html.find(marker)
    if idx == -1:
        raise AssertionError('Verification/reset link not found in email body')
    tail = html[idx + len(marker):]
    end = 0
    for end, char in enumerate(tail):
        if char in {'"', '<', ' ', '&', "'"}:
            break
    else:
        end = len(tail)
    return tail[:end]


class EmailFlowsTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tempdirs: list[tempfile.TemporaryDirectory[str]] = []
        self._apps = []
        self._mailer = _RecordingMailer()
        self._patcher = patch(
            'app.services.email_service._send_via_unisender_go',
            new=self._mailer,
        )
        self._patcher.start()

    def tearDown(self) -> None:
        self._patcher.stop()
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
        database_path = Path(tempdir.name) / 'email-test.db'
        env = {
            'APP_ENV': 'development',
            'SECRET_KEY': 'UnitTestSecretKey123!UnitTestSecretKey123!',
            'DATABASE_URL': f'sqlite:///{database_path.as_posix()}',
            'CLIENT_URL': 'http://localhost:3000',
            'FRONTEND_PUBLIC_URL': 'http://localhost:3000',
            'EMAIL_FROM': 'no-reply@progyx.test',
            'EMAIL_FROM_NAME': 'Progyx Test',
            'UNISENDER_GO_API_KEY': 'test-api-key',
            'UNISENDER_GO_API_URL': 'https://go1.unisender.example/ru/transactional/api/v1',
            'EMAIL_DRY_RUN': 'false',
            'ENABLE_DEMO_DATA': 'false',
            'SUPERADMIN_BOOTSTRAP': 'false',
            'SESSION_COOKIE_SECURE': 'false',
            'SESSION_COOKIE_SAMESITE': 'Strict',
            'GIGACHAT_VERIFY_SSL': 'true',
            'CODE_JUDGE_RUNNER_URL': '',
            'CODE_JUDGE_RUNNER_TOKEN': '',
            'METRICS_DEBUG': 'false',
            'THROTTLE_BACKEND': 'db',
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
        # The patched transport must survive the module reloads above. We
        # have to re-apply the patch because importlib.reload rebinds the
        # `_send_via_unisender_go` symbol.
        self._patcher.stop()
        self._patcher = patch(
            'app.services.email_service._send_via_unisender_go',
            new=self._mailer,
        )
        self._patcher.start()
        return app

    def _register_student(self, client, email='student@example.com'):
        return client.post(
            '/api/auth/register',
            json={
                'full_name': 'Test Student',
                'email': email,
                'phone': '+7 (912) 345-67-89',
                'password': 'StrongPass123!',
                'role': 'student',
                'age_group': 'middle',
            },
        )

    def _register_and_verify_student(self, client, email='student@example.com'):
        """Register and immediately verify so the student can actually log in."""

        response = self._register_student(client, email=email)
        assert response.status_code == 201, response.get_json()
        raw_token = _extract_token_from_html(self._mailer.calls[-1]['html'])
        verify = client.post('/api/auth/verify-email', json={'token': raw_token})
        assert verify.status_code == 200, verify.get_json()
        return raw_token

    # ------------------------------------------------------------------
    # Verification flow
    # ------------------------------------------------------------------

    def test_register_creates_verification_token_and_sends_email(self):
        app = self.create_app()
        with app.test_client() as client:
            response = self._register_student(client)
            self.assertEqual(response.status_code, 201, response.get_json())
            payload = response.get_json()
            self.assertTrue(payload.get('verification_email_sent'))
            self.assertTrue(payload.get('requires_email_verification'))
            self.assertTrue(payload.get('requires_login_after_verification'))
            self.assertFalse(payload['user']['email_verified'])
            # Student registration must NOT create a session — login happens
            # only after the email is verified.
            cookies = response.headers.getlist('Set-Cookie')
            self.assertFalse(
                any('codequest_access_token=' in cookie and 'HttpOnly' in cookie for cookie in cookies),
                f'Unexpected access-token cookie: {cookies}',
            )

        self.assertEqual(len(self._mailer.calls), 1)
        call = self._mailer.calls[0]
        self.assertEqual(call['to'], 'student@example.com')
        self.assertIn('Подтверждение почты', call['subject'])
        self.assertIn('http://localhost:3000/verify-email?token=', call['html'])

        with app.app_context():
            from app.models.user import EMAIL_TOKEN_PURPOSE_VERIFICATION, EmailToken, User

            user = User.query.filter_by(email='student@example.com').first()
            tokens = EmailToken.query.filter_by(
                user_id=user.id, purpose=EMAIL_TOKEN_PURPOSE_VERIFICATION
            ).all()
            self.assertEqual(len(tokens), 1)
            # Persisted value must be the hash, never the raw token
            self.assertNotIn(' ', tokens[0].token_hash)
            self.assertEqual(len(tokens[0].token_hash), 64)
            self.assertIsNone(tokens[0].used_at)

    def test_verify_email_works_once_and_marks_user_verified(self):
        app = self.create_app()
        with app.test_client() as client:
            response = self._register_student(client)
            self.assertEqual(response.status_code, 201)
            raw_token = _extract_token_from_html(self._mailer.calls[0]['html'])

            verify = client.post('/api/auth/verify-email', json={'token': raw_token})
            self.assertEqual(verify.status_code, 200, verify.get_json())
            verify_payload = verify.get_json()
            self.assertTrue(verify_payload['user']['email_verified'])
            self.assertTrue(verify_payload.get('authenticated'))
            verify_cookies = verify.headers.getlist('Set-Cookie')
            self.assertTrue(
                any('codequest_access_token=' in cookie and 'HttpOnly' in cookie for cookie in verify_cookies),
                f'Expected access-token cookie after verification: {verify_cookies}',
            )
            self.assertTrue(
                any('codequest_refresh_token=' in cookie and 'HttpOnly' in cookie for cookie in verify_cookies),
                f'Expected refresh-token cookie after verification: {verify_cookies}',
            )

            # Re-using the same link should not re-issue success without the
            # already_verified flag, and the user must stay verified.
            second = client.post('/api/auth/verify-email', json={'token': raw_token})
            self.assertEqual(second.status_code, 200)
            self.assertTrue(second.get_json().get('already_verified'))
            self.assertFalse(second.get_json().get('authenticated'))
            second_cookies = second.headers.getlist('Set-Cookie')
            self.assertFalse(
                any('codequest_access_token=' in cookie for cookie in second_cookies),
                f'Replayed verification link must not re-issue access cookies: {second_cookies}',
            )
            self.assertFalse(
                any('codequest_refresh_token=' in cookie for cookie in second_cookies),
                f'Replayed verification link must not re-issue refresh cookies: {second_cookies}',
            )

        with app.app_context():
            from app.models.user import EmailToken, User

            user = User.query.filter_by(email='student@example.com').first()
            self.assertTrue(user.email_verified)
            self.assertIsNotNone(user.email_verified_at)
            tokens = EmailToken.query.filter_by(user_id=user.id).all()
            self.assertEqual(len(tokens), 1)
            self.assertIsNotNone(tokens[0].used_at)

    def test_verify_email_rejects_replayed_token_after_invalidation(self):
        """A second verification token issued via resend should invalidate the first."""

        app = self.create_app()
        with app.test_client() as client:
            response = self._register_student(client)
            self.assertEqual(response.status_code, 201)
            first_raw_token = _extract_token_from_html(self._mailer.calls[0]['html'])

            # Student isn't logged in yet (no session on register), so resend
            # is invoked anonymously with the email in the body.
            resend = client.post(
                '/api/auth/resend-verification',
                json={'email': 'student@example.com'},
            )
            self.assertEqual(resend.status_code, 200, resend.get_json())
            self.assertEqual(len(self._mailer.calls), 2)
            second_raw_token = _extract_token_from_html(self._mailer.calls[1]['html'])
            self.assertNotEqual(first_raw_token, second_raw_token)

            # The first link is now used (invalidated by the resend), so it
            # must not transition the user to verified.
            stale = client.post('/api/auth/verify-email', json={'token': first_raw_token})
            self.assertEqual(stale.status_code, 400)
            self.assertEqual(stale.get_json()['code'], 'used_token')

            # The fresh link still works exactly once.
            fresh = client.post('/api/auth/verify-email', json={'token': second_raw_token})
            self.assertEqual(fresh.status_code, 200)
            self.assertTrue(fresh.get_json()['user']['email_verified'])

    def test_expired_verification_token_is_rejected(self):
        app = self.create_app()
        with app.test_client() as client:
            self._register_student(client)
            raw_token = _extract_token_from_html(self._mailer.calls[0]['html'])

        # Expire the token by rewinding expires_at past now.
        with app.app_context():
            from app.core.db import db
            from app.models.user import EmailToken

            row = EmailToken.query.first()
            row.expires_at = datetime.now(UTC) - timedelta(minutes=1)
            db.session.commit()

        with app.test_client() as client:
            response = client.post('/api/auth/verify-email', json={'token': raw_token})
            self.assertEqual(response.status_code, 400)
            payload = response.get_json()
            self.assertEqual(payload['code'], 'expired_token')
            self.assertTrue(payload.get('account_deleted'))

        with app.app_context():
            from app.models.user import EmailToken, User

            self.assertIsNone(User.query.filter_by(email='student@example.com').first())
            self.assertEqual(EmailToken.query.count(), 0)

    def test_register_reclaims_email_after_unverified_account_expires(self):
        app = self.create_app()
        with app.test_client() as client:
            self._register_student(client)

        with app.app_context():
            from app.core.db import db
            from app.models.user import EmailToken

            row = EmailToken.query.first()
            row.expires_at = datetime.now(UTC) - timedelta(minutes=1)
            db.session.commit()

        with app.test_client() as client:
            response = self._register_student(client)
            self.assertEqual(response.status_code, 201, response.get_json())
            self.assertTrue(response.get_json().get('requires_email_verification'))

        with app.app_context():
            from app.models.user import User

            self.assertEqual(User.query.filter_by(email='student@example.com').count(), 1)

    def test_resend_verification_no_op_when_already_verified(self):
        app = self.create_app()
        with app.test_client() as client:
            self._register_and_verify_student(client)
            # Log in (now allowed because email is verified) so the resend
            # endpoint sees an authenticated session and can return the
            # explicit `already_verified` flag.
            login = client.post(
                '/api/auth/login',
                json={'login': 'student@example.com', 'password': 'StrongPass123!'},
            )
            self.assertEqual(login.status_code, 200, login.get_json())
            self._mailer.calls.clear()

            response = client.post('/api/auth/resend-verification')
            self.assertEqual(response.status_code, 200, response.get_json())
            self.assertTrue(response.get_json().get('already_verified'))
            self.assertEqual(len(self._mailer.calls), 0)

    # ------------------------------------------------------------------
    # Forgot / reset password flow
    # ------------------------------------------------------------------

    def test_forgot_password_does_not_disclose_existence(self):
        app = self.create_app()
        with app.test_client() as client:
            self._register_student(client)
            self._mailer.calls.clear()

            existing = client.post(
                '/api/auth/forgot-password',
                json={'email': 'student@example.com'},
            )
            missing = client.post(
                '/api/auth/forgot-password',
                json={'email': 'ghost@example.com'},
            )

            self.assertEqual(existing.status_code, 200)
            self.assertEqual(missing.status_code, 200)
            self.assertEqual(existing.get_json(), missing.get_json())

        # An email should be sent only for the existing user.
        self.assertEqual(len(self._mailer.calls), 1)
        self.assertEqual(self._mailer.calls[0]['to'], 'student@example.com')

    def test_reset_password_changes_password_and_revokes_session(self):
        app = self.create_app()
        with app.test_client() as client:
            # Verify first so the post-reset login isn't blocked by the
            # email-not-verified gate (which is unrelated to this scenario).
            self._register_and_verify_student(client)
            client.post(
                '/api/auth/login',
                json={'login': 'student@example.com', 'password': 'StrongPass123!'},
            )
            self._mailer.calls.clear()

            client.post(
                '/api/auth/forgot-password',
                json={'email': 'student@example.com'},
            )
            self.assertEqual(len(self._mailer.calls), 1)
            reset_call = self._mailer.calls[-1]
            self.assertIn('Сброс пароля', reset_call['subject'])
            raw_token = _extract_token_from_html(reset_call['html'])

            new_password = 'NewStrongPass987!'
            response = client.post(
                '/api/auth/reset-password',
                json={'token': raw_token, 'new_password': new_password},
            )
            self.assertEqual(response.status_code, 200, response.get_json())

            # Old session must be revoked: refresh fails post-reset.
            refresh_response = client.post('/api/auth/refresh')
            self.assertIn(refresh_response.status_code, (401, 403))

        with app.test_client() as client:
            old = client.post(
                '/api/auth/login',
                json={'login': 'student@example.com', 'password': 'StrongPass123!'},
            )
            self.assertEqual(old.status_code, 401)
            new_login = client.post(
                '/api/auth/login',
                json={'login': 'student@example.com', 'password': new_password},
            )
            self.assertEqual(new_login.status_code, 200, new_login.get_json())

    def test_reset_password_token_is_single_use(self):
        app = self.create_app()
        with app.test_client() as client:
            self._register_student(client)
            client.post(
                '/api/auth/forgot-password',
                json={'email': 'student@example.com'},
            )
            raw_token = _extract_token_from_html(self._mailer.calls[-1]['html'])

            first = client.post(
                '/api/auth/reset-password',
                json={'token': raw_token, 'new_password': 'NewStrongPass987!'},
            )
            self.assertEqual(first.status_code, 200)

            second = client.post(
                '/api/auth/reset-password',
                json={'token': raw_token, 'new_password': 'AnotherStrongPass987!'},
            )
            self.assertEqual(second.status_code, 400)
            self.assertEqual(second.get_json()['code'], 'used_token')

    def test_reset_password_rejects_weak_password_without_consuming_token(self):
        app = self.create_app()
        with app.test_client() as client:
            self._register_student(client)
            client.post(
                '/api/auth/forgot-password',
                json={'email': 'student@example.com'},
            )
            raw_token = _extract_token_from_html(self._mailer.calls[-1]['html'])

            weak = client.post(
                '/api/auth/reset-password',
                json={'token': raw_token, 'new_password': 'short'},
            )
            self.assertEqual(weak.status_code, 400)
            self.assertEqual(weak.get_json()['code'], 'weak_password')

            # Token still works after a rejected weak password.
            ok = client.post(
                '/api/auth/reset-password',
                json={'token': raw_token, 'new_password': 'NewStrongPass987!'},
            )
            self.assertEqual(ok.status_code, 200)

    def test_forgot_password_rate_limit(self):
        app = self.create_app(
            PASSWORD_RESET_RATE_LIMIT_MAX_REQUESTS='2',
            PASSWORD_RESET_RATE_LIMIT_WINDOW_SECONDS='600',
            PASSWORD_RESET_RATE_LIMIT_BLOCK_SECONDS='600',
        )
        with app.test_client() as client:
            self._register_student(client)
            self._mailer.calls.clear()

            for _ in range(2):
                response = client.post(
                    '/api/auth/forgot-password',
                    json={'email': 'student@example.com'},
                )
                self.assertEqual(response.status_code, 200)
            blocked = client.post(
                '/api/auth/forgot-password',
                json={'email': 'student@example.com'},
            )
            self.assertEqual(blocked.status_code, 429)

    # ------------------------------------------------------------------
    # Email service unit assertions
    # ------------------------------------------------------------------

    def test_email_service_does_not_call_provider_in_dry_run(self):
        app = self.create_app(EMAIL_DRY_RUN='true')
        with app.app_context():
            from app.services.email_service import EmailDeliveryResult, send_email

            result = send_email(
                'recipient@example.com',
                'subject',
                '<b>hi</b>',
                text='hi',
            )
            self.assertIsInstance(result, EmailDeliveryResult)
            self.assertTrue(result.dry_run)

        # The recording stub must NOT have been invoked.
        self.assertEqual(len(self._mailer.calls), 0)

    # ------------------------------------------------------------------
    # Parent achievement notifications
    # ------------------------------------------------------------------

    def _create_linked_parent_and_student(self, app):
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.parent_cabinet import ParentChildLink
        from app.models.user import User, UserRole

        with app.app_context():
            parent = User(
                full_name="Parent Person",
                email="parent-ach@example.com",
                password_hash=hash_password("ParentPass123!"),
                role=UserRole.PARENT,
            )
            student = User(
                full_name="Child Name",
                email="child-ach@example.com",
                password_hash=hash_password("StudentPass123!"),
                role=UserRole.STUDENT,
                age_group="middle",
            )
            db.session.add_all([parent, student])
            db.session.flush()
            db.session.add(
                ParentChildLink(parent_user_id=parent.id, child_user_id=student.id)
            )
            db.session.commit()
            return parent.id, student.id

    def test_parent_receives_email_on_child_achievement(self):
        app = self.create_app()
        parent_id, student_id = self._create_linked_parent_and_student(app)
        self._mailer.calls.clear()

        with app.app_context():
            from app.core.db import db
            from app.models.learning import Achievement
            from app.models.user import User
            from app.services.parent_event_notifications import notify_achievements_earned

            student = db.session.get(User, student_id)
            achievement = Achievement.query.filter_by(code='first_code').first()
            self.assertIsNotNone(achievement)
            notify_achievements_earned(student, [achievement])
            db.session.commit()

        self.assertEqual(len(self._mailer.calls), 1, self._mailer.calls)
        call = self._mailer.calls[0]
        self.assertEqual(call['to'], 'parent-ach@example.com')
        self.assertIn('достижение', call['subject'].lower())
        self.assertIn('/parent/dashboard', call['html'])
        # Suggested share text is part of the body
        self.assertIn('Поделитесь', call['html'])

    def test_parent_consent_disabled_blocks_email_and_inapp(self):
        app = self.create_app()
        parent_id, student_id = self._create_linked_parent_and_student(app)
        self._mailer.calls.clear()

        with app.app_context():
            from app.core.db import db
            from app.models.learning import Achievement
            from app.models.parent_cabinet import (
                ParentConsentSettings,
                ParentNotification,
            )
            from app.models.user import User
            from app.services.parent_event_notifications import notify_achievements_earned

            db.session.add(
                ParentConsentSettings(
                    parent_user_id=parent_id,
                    child_user_id=student_id,
                    allow_notifications=False,
                )
            )
            db.session.commit()

            student = db.session.get(User, student_id)
            achievement = Achievement.query.filter_by(code='first_code').first()
            notify_achievements_earned(student, [achievement])
            db.session.commit()

            inapp = ParentNotification.query.filter_by(parent_user_id=parent_id).count()
            self.assertEqual(inapp, 0)

        self.assertEqual(len(self._mailer.calls), 0)

    def test_achievement_email_failure_does_not_break_award(self):
        app = self.create_app()
        parent_id, student_id = self._create_linked_parent_and_student(app)
        self._mailer.calls.clear()

        # Force the recording stub to raise on the next call so we can verify
        # `_send_achievement_email_safe` swallows it and the in-app row is
        # still committed.
        from app.services.email_service import EmailDeliveryError

        def _explode(**_kwargs):
            raise EmailDeliveryError('simulated provider failure')

        with patch('app.services.email_service._send_via_unisender_go', new=_explode):
            with app.app_context():
                from app.core.db import db
                from app.models.learning import Achievement
                from app.models.parent_cabinet import ParentNotification
                from app.models.user import User
                from app.services.parent_event_notifications import notify_achievements_earned

                student = db.session.get(User, student_id)
                achievement = Achievement.query.filter_by(code='first_code').first()
                notify_achievements_earned(student, [achievement])
                db.session.commit()

                inapp_count = ParentNotification.query.filter_by(
                    parent_user_id=parent_id,
                ).count()
                self.assertEqual(inapp_count, 1)

    def test_register_student_send_mail_false_skips_mail_and_logs_in(self):
        app = self.create_app(SEND_MAIL='false')
        client = app.test_client()
        self._mailer.calls.clear()
        resp = client.post(
            '/api/auth/register',
            json={
                'full_name': 'Quick Student',
                'email': 'quick-student@example.com',
                'phone': '+7 (912) 345-67-90',
                'password': 'StrongPass123!',
                'role': 'student',
                'age_group': 'middle',
            },
        )
        self.assertEqual(resp.status_code, 201, resp.get_json())
        body = resp.get_json()
        self.assertTrue(body['user']['email_verified'])
        self.assertFalse(body.get('requires_email_verification', True))
        cookies = resp.headers.getlist('Set-Cookie')
        self.assertTrue(any('codequest_access_token=' in c for c in cookies), cookies)
        self.assertEqual(len(self._mailer.calls), 0)

    def test_register_parent_send_mail_false_returns_initial_password(self):
        app = self.create_app(SEND_MAIL='false')
        client = app.test_client()
        self._mailer.calls.clear()
        resp = client.post(
            '/api/auth/register',
            json={'email': 'quick-parent@example.com', 'role': 'parent', 'theme': 'light'},
        )
        self.assertEqual(resp.status_code, 201, resp.get_json())
        body = resp.get_json()
        self.assertTrue(body['user']['email_verified'])
        self.assertFalse(body.get('requires_email_verification', True))
        self.assertIn('initial_password', body)
        self.assertEqual(len(body['initial_password']), 14)
        self.assertNotIn('email_verified', body['parent_profile_required_fields'])
        self.assertEqual(len(self._mailer.calls), 0)


if __name__ == '__main__':
    unittest.main()
