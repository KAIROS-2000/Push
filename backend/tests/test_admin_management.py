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
            email='admin@example.com',
            password='AdminPass123!',
            role='admin',
            age_group='adult',
        )
        student_id = self.create_user(
            app,
            full_name='Alice Student',
            email='alice@example.com',
            password='StudentPass123!',
            role='student',
            age_group='middle',
        )
        self.create_user(
            app,
            full_name='Boris Teacher',
            email='mentor@example.com',
            password='TeacherPass123!',
            role='teacher',
            age_group='adult',
        )
        secondary_admin_id = self.create_user(
            app,
            full_name='Ops Admin',
            email='opsadmin@example.com',
            password='OpsAdminPass123!',
            role='admin',
            age_group='adult',
        )

        with app.test_client() as admin_client:
            login_response = self.login(admin_client, 'admin@example.com', 'AdminPass123!')
            self.assertEqual(login_response.status_code, 200)

            filtered = admin_client.get('/api/admin/users?email=alice@&status=active&page=1&page_size=10')
            self.assertEqual(filtered.status_code, 200)
            filtered_payload = filtered.get_json()
            self.assertEqual(filtered_payload['pagination']['total'], 1)
            self.assertEqual(filtered_payload['users'][0]['email'], 'alice@example.com')

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
            blocked_login = self.login(blocked_user_client, 'alice@example.com', 'StudentPass123!')
            self.assertEqual(blocked_login.status_code, 403)

    def test_teacher_registration_requires_admin_approval(self):
        app = self.create_app()
        admin_id = self.create_user(
            app,
            full_name='Admin Example',
            email='admin@example.com',
            password='AdminPass123!',
            role='admin',
            age_group='adult',
        )

        with app.test_client() as teacher_client:
            register_response = teacher_client.post(
                '/api/auth/register',
                json={
                    'full_name': 'Pending Teacher',
                    'email': 'mentor1@example.com',
                    'phone': '+7 912 345-67-89',
                    'password': 'TeacherPass123!',
                    'role': 'teacher',
                },
            )
            self.assertEqual(register_response.status_code, 201)
            register_payload = register_response.get_json()
            self.assertEqual(register_payload['status'], 'pending')
            self.assertEqual(register_payload['teacher_request']['teacher_approval_status'], 'pending')
            self.assertFalse(register_payload['teacher_request']['is_active'])

            pending_login = self.login(teacher_client, 'mentor1@example.com', 'TeacherPass123!')
            self.assertEqual(pending_login.status_code, 403)
            self.assertEqual(pending_login.get_json()['code'], 'teacher_approval_pending')

        with app.test_client() as admin_client:
            login_response = self.login(admin_client, 'admin@example.com', 'AdminPass123!')
            self.assertEqual(login_response.status_code, 200)

            requests_response = admin_client.get('/api/admin/teacher-requests?status=pending&page_size=10')
            self.assertEqual(requests_response.status_code, 200)
            requests_payload = requests_response.get_json()
            self.assertEqual(requests_payload['pagination']['total'], 1)
            request_user = requests_payload['teacher_requests'][0]
            self.assertEqual(request_user['email'], 'mentor1@example.com')

            users_response = admin_client.get('/api/admin/users?email=mentor1&page_size=10')
            self.assertEqual(users_response.status_code, 200)
            self.assertEqual(users_response.get_json()['pagination']['total'], 0)

            approve_response = admin_client.patch(f"/api/admin/teacher-requests/{request_user['id']}/approve")
            self.assertEqual(approve_response.status_code, 200)
            approved_user = approve_response.get_json()['teacher_request']
            self.assertEqual(approved_user['teacher_approval_status'], 'approved')
            self.assertTrue(approved_user['is_active'])

            audit_response = admin_client.get('/api/admin/audit-logs?action=teacher_request_approved&target=mentor1@')
            self.assertEqual(audit_response.status_code, 200)
            audit_payload = audit_response.get_json()
            self.assertEqual(audit_payload['pagination']['total'], 1)
            self.assertEqual(audit_payload['audit_logs'][0]['actor_user_id'], admin_id)
            self.assertEqual(audit_payload['audit_logs'][0]['details']['next_status'], 'approved')

        # Teachers must also confirm their email before they can log in
        # (email verification is independent from admin approval). Mark the
        # mailbox as verified directly so this regression test stays focused
        # on the admin-approval contract.
        with app.app_context():
            from app.core.db import db
            from app.models.user import User

            approved_user_row = User.query.filter_by(email='mentor1@example.com').first()
            approved_user_row.email_verified = True
            db.session.commit()

        with app.test_client() as approved_teacher_client:
            approved_login = self.login(approved_teacher_client, 'mentor1@example.com', 'TeacherPass123!')
            self.assertEqual(approved_login.status_code, 200)
            self.assertEqual(approved_login.get_json()['user']['role'], 'teacher')

    def test_admin_can_reject_teacher_registration_request(self):
        app = self.create_app()
        self.create_user(
            app,
            full_name='Admin Example',
            email='admin@example.com',
            password='AdminPass123!',
            role='admin',
            age_group='adult',
        )

        with app.test_client() as teacher_client:
            register_response = teacher_client.post(
                '/api/auth/register',
                json={
                    'full_name': 'Rejected Teacher',
                    'email': 'mentor2@example.com',
                    'phone': '+7 912 345-67-90',
                    'password': 'TeacherPass123!',
                    'role': 'teacher',
                },
            )
            self.assertEqual(register_response.status_code, 201)
            teacher_id = register_response.get_json()['teacher_request']['id']

        with app.test_client() as admin_client:
            login_response = self.login(admin_client, 'admin@example.com', 'AdminPass123!')
            self.assertEqual(login_response.status_code, 200)

            reject_response = admin_client.patch(f'/api/admin/teacher-requests/{teacher_id}/reject')
            self.assertEqual(reject_response.status_code, 200)
            rejected_user = reject_response.get_json()['teacher_request']
            self.assertEqual(rejected_user['teacher_approval_status'], 'rejected')
            self.assertFalse(rejected_user['is_active'])
            self.assertIsNotNone(rejected_user['teacher_rejection_expires_at'])

        with app.test_client() as rejected_teacher_client:
            rejected_login = self.login(rejected_teacher_client, 'mentor2@example.com', 'TeacherPass123!')
            self.assertEqual(rejected_login.status_code, 403)
            self.assertEqual(rejected_login.get_json()['code'], 'teacher_approval_rejected')

        with app.app_context():
            from app.core.db import db
            from app.models.user import User

            rejected_user = db.session.get(User, teacher_id)
            self.assertIsNotNone(rejected_user)
            rejected_user.teacher_rejection_expires_at = datetime.now(UTC) - timedelta(seconds=1)
            db.session.commit()

        with app.test_client() as admin_client:
            login_response = self.login(admin_client, 'admin@example.com', 'AdminPass123!')
            self.assertEqual(login_response.status_code, 200)

            cleanup_response = admin_client.get('/api/admin/teacher-requests?status=all&page_size=10')
            self.assertEqual(cleanup_response.status_code, 200)

        with app.app_context():
            from app.core.db import db
            from app.models.user import User

            self.assertIsNone(db.session.get(User, teacher_id))

        with app.test_client() as teacher_client:
            register_again = teacher_client.post(
                '/api/auth/register',
                json={
                    'full_name': 'Rejected Teacher Retry',
                    'email': 'mentor2@example.com',
                    'phone': '+7 912 345-67-90',
                    'password': 'TeacherPass123!',
                    'role': 'teacher',
                },
            )
            self.assertEqual(register_again.status_code, 201)
            self.assertEqual(register_again.get_json()['status'], 'pending')

    def test_blocked_user_refresh_is_rejected_after_admin_block(self):
        app = self.create_app()
        self.create_user(
            app,
            full_name='Admin Example',
            email='admin@example.com',
            password='AdminPass123!',
            role='admin',
            age_group='adult',
        )
        student_id = self.create_user(
            app,
            full_name='Refresh Student',
            email='refresh1@example.com',
            password='StudentPass123!',
            role='student',
            age_group='middle',
        )

        student_client = app.test_client()
        admin_client = app.test_client()

        student_login = self.login(student_client, 'refresh1@example.com', 'StudentPass123!')
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
            email='admin@example.com',
            password='AdminPass123!',
            role='admin',
            age_group='adult',
        )
        student_id = self.create_user(
            app,
            full_name='Active Student',
            email='active1@example.com',
            password='StudentPass123!',
            role='student',
            age_group='middle',
        )

        student_client = app.test_client()
        admin_client = app.test_client()

        student_login = self.login(student_client, 'active1@example.com', 'StudentPass123!')
        self.assertEqual(student_login.status_code, 200)

        admin_login = self.login(admin_client, 'admin@example.com', 'AdminPass123!')
        self.assertEqual(admin_login.status_code, 200)
        block_response = admin_client.patch(f'/api/admin/users/{student_id}/block')
        self.assertEqual(block_response.status_code, 200)

        me_response = student_client.get('/api/auth/me')
        self.assertEqual(me_response.status_code, 401)
        self.assertIn(me_response.get_json().get('code'), {'session_revoked', 'user_blocked'})

    def test_only_superadmin_can_delete_managed_users(self):
        app = self.create_app()
        admin_id = self.create_user(
            app,
            full_name='Admin Example',
            email='admin@example.com',
            password='AdminPass123!',
            role='admin',
            age_group='adult',
        )
        self.create_user(
            app,
            full_name='Super Admin',
            email='root@example.com',
            password='RootPass123!',
            role='superadmin',
            age_group='adult',
        )
        teacher_id = self.create_user(
            app,
            full_name='Teacher Example',
            email='mentor@example.com',
            password='TeacherPass123!',
            role='teacher',
            age_group='adult',
        )
        student_id = self.create_user(
            app,
            full_name='Delete Student',
            email='delete1@example.com',
            password='StudentPass123!',
            role='student',
            age_group='middle',
        )

        with app.app_context():
            from app.core.db import db
            from app.models.learning import (
                Assignment,
                AssignmentSubmission,
                ClassJoinRequest,
                ClassMembership,
                Classroom,
                Module,
                custom_classroom_module_slug_prefix,
            )
            from app.models.parent_cabinet import ParentLinkCode
            from app.models.messaging import Conversation, ConversationReadState, Message

            classroom = Classroom(
                name='Deletion Class',
                description='Class for delete checks',
                code='DEL123',
                teacher_id=teacher_id,
            )
            db.session.add(classroom)
            db.session.flush()
            custom_module = Module(
                slug=f'{custom_classroom_module_slug_prefix(classroom.id)}middle',
                title='Teacher Custom Module',
                description='Custom lessons',
                age_group='middle',
                icon='sparkles',
                color='#4A90D9',
                order_index=99,
            )
            assignment = Assignment(
                classroom_id=classroom.id,
                title='Deletion Assignment',
                description='Practice',
                difficulty='medium',
                xp_reward=80,
            )
            db.session.add_all(
                [
                    custom_module,
                    ClassMembership(classroom_id=classroom.id, student_id=student_id),
                    ClassJoinRequest(
                        classroom_id=classroom.id,
                        student_id=student_id,
                        status='approved',
                        decided_by_id=teacher_id,
                    ),
                    assignment,
                    ParentLinkCode(
                        child_user_id=student_id,
                        code_hash='a' * 64,
                        expires_at=datetime.now(UTC) + timedelta(days=7),
                    ),
                ]
            )
            db.session.flush()
            db.session.add(
                AssignmentSubmission(
                    assignment_id=assignment.id,
                    student_id=student_id,
                    answer='Done',
                )
            )
            conversation = Conversation(
                classroom_id=classroom.id,
                teacher_id=teacher_id,
                student_id=student_id,
            )
            db.session.add(conversation)
            db.session.flush()
            message = Message(
                conversation_id=conversation.id,
                sender_id=student_id,
                body='Hello',
            )
            db.session.add(message)
            db.session.flush()
            db.session.add(
                ConversationReadState(
                    conversation_id=conversation.id,
                    user_id=student_id,
                    last_read_message_id=message.id,
                )
            )
            db.session.commit()
            classroom_id = classroom.id
            custom_module_id = custom_module.id

        with app.test_client() as admin_client:
            admin_login = self.login(admin_client, 'admin@example.com', 'AdminPass123!')
            self.assertEqual(admin_login.status_code, 200)
            forbidden_delete = admin_client.delete(f'/api/admin/users/{student_id}')
            self.assertEqual(forbidden_delete.status_code, 403)

        with app.test_client() as superadmin_client:
            superadmin_login = self.login(superadmin_client, 'root@example.com', 'RootPass123!')
            self.assertEqual(superadmin_login.status_code, 200)

            invalid_target = superadmin_client.delete(f'/api/admin/users/{admin_id}')
            self.assertEqual(invalid_target.status_code, 400)

            delete_student_response = superadmin_client.delete(f'/api/admin/users/{student_id}')
            self.assertEqual(delete_student_response.status_code, 200)
            self.assertEqual(delete_student_response.get_json()['message'], 'Пользователь удалён')

            delete_teacher_response = superadmin_client.delete(f'/api/admin/users/{teacher_id}')
            self.assertEqual(delete_teacher_response.status_code, 200)

            audit_response = superadmin_client.get('/api/admin/audit-logs?action=user_deleted&target=delete1@')
            self.assertEqual(audit_response.status_code, 200)
            audit_payload = audit_response.get_json()
            self.assertEqual(audit_payload['pagination']['total'], 1)
            self.assertEqual(audit_payload['audit_logs'][0]['details']['target_role'], 'student')

        with app.app_context():
            from app.core.db import db
            from app.models.learning import (
                AssignmentSubmission,
                ClassJoinRequest,
                ClassMembership,
                Classroom,
                Module,
            )
            from app.models.parent_cabinet import ParentLinkCode
            from app.models.messaging import Conversation, ConversationReadState, Message
            from app.models.user import User

            self.assertIsNone(db.session.get(User, student_id))
            self.assertIsNone(db.session.get(User, teacher_id))
            self.assertIsNone(db.session.get(Classroom, classroom_id))
            self.assertIsNone(db.session.get(Module, custom_module_id))
            self.assertEqual(ClassMembership.query.filter_by(student_id=student_id).count(), 0)
            self.assertEqual(ClassJoinRequest.query.filter_by(student_id=student_id).count(), 0)
            self.assertEqual(AssignmentSubmission.query.filter_by(student_id=student_id).count(), 0)
            self.assertEqual(ParentLinkCode.query.filter_by(child_user_id=student_id).count(), 0)
            self.assertEqual(Conversation.query.count(), 0)
            self.assertEqual(Message.query.count(), 0)
            self.assertEqual(ConversationReadState.query.count(), 0)

        with app.test_client() as deleted_student_client:
            deleted_login = self.login(deleted_student_client, 'delete1@example.com', 'StudentPass123!')
            self.assertEqual(deleted_login.status_code, 401)

    def test_admin_telemetry_reports_learning_and_site_metrics(self):
        app = self.create_app()
        self.create_user(
            app,
            full_name='Admin Example',
            email='admin@example.com',
            password='AdminPass123!',
            role='admin',
            age_group='adult',
        )
        teacher_id = self.create_user(
            app,
            full_name='Teacher Example',
            email='teacher@example.com',
            password='TeacherPass123!',
            role='teacher',
            age_group='adult',
        )
        student_a_id = self.create_user(
            app,
            full_name='Student One',
            email='student1@example.com',
            password='StudentPass123!',
            role='student',
            age_group='middle',
        )
        student_b_id = self.create_user(
            app,
            full_name='Student Two',
            email='student2@example.com',
            password='StudentPass123!',
            role='student',
            age_group='middle',
        )
        student_c_id = self.create_user(
            app,
            full_name='Student Three',
            email='student3@example.com',
            password='StudentPass123!',
            role='student',
            age_group='middle',
        )

        with app.app_context():
            from app.core.db import db
            from app.models.learning import (
                Assignment,
                AssignmentSubmission,
                ClassMembership,
                Classroom,
                Lesson,
                Module,
                UserProgress,
                encode_assignment_description,
            )
            from app.models.user import RefreshToken

            now = datetime.now(UTC)
            module = Module(
                slug='analytics-roadmap',
                title='Analytics roadmap',
                description='Analytics test module',
                age_group='middle',
                icon='chart',
                color='#4A90D9',
                order_index=1,
                is_published=True,
            )
            db.session.add(module)
            db.session.flush()

            low_lesson = Lesson(
                module_id=module.id,
                slug='low-completion',
                title='Low completion',
                summary='Lesson with low completion',
                content_format='mixed',
                theory_blocks=[],
                interactive_steps=[],
                order_index=1,
                duration_minutes=15,
                passing_score=70,
                is_published=True,
            )
            high_lesson = Lesson(
                module_id=module.id,
                slug='high-completion',
                title='High completion',
                summary='Lesson with high completion',
                content_format='mixed',
                theory_blocks=[],
                interactive_steps=[],
                order_index=2,
                duration_minutes=15,
                passing_score=70,
                is_published=True,
            )
            classroom = Classroom(
                name='Analytics class',
                description='Telemetry checks',
                code='ANALYT',
                teacher_id=teacher_id,
            )
            db.session.add_all([low_lesson, high_lesson, classroom])
            db.session.flush()

            db.session.add_all(
                [
                    ClassMembership(classroom_id=classroom.id, student_id=student_a_id),
                    ClassMembership(classroom_id=classroom.id, student_id=student_b_id),
                    ClassMembership(classroom_id=classroom.id, student_id=student_c_id),
                    UserProgress(
                        user_id=student_a_id,
                        lesson_id=low_lesson.id,
                        status='completed',
                        score=80,
                        attempts=2,
                        hints_used=1,
                        started_at=now - timedelta(days=1),
                        completed_at=now,
                    ),
                    UserProgress(
                        user_id=student_b_id,
                        lesson_id=low_lesson.id,
                        status='in_progress',
                        score=20,
                        attempts=1,
                        hints_used=0,
                        started_at=now - timedelta(days=1),
                    ),
                    UserProgress(
                        user_id=student_c_id,
                        lesson_id=low_lesson.id,
                        status='in_progress',
                        score=10,
                        attempts=1,
                        hints_used=0,
                        started_at=now - timedelta(days=1),
                    ),
                    UserProgress(
                        user_id=student_a_id,
                        lesson_id=high_lesson.id,
                        status='completed',
                        score=95,
                        attempts=1,
                        hints_used=0,
                        started_at=now - timedelta(days=2),
                        completed_at=now,
                    ),
                    UserProgress(
                        user_id=student_b_id,
                        lesson_id=high_lesson.id,
                        status='completed',
                        score=90,
                        attempts=1,
                        hints_used=0,
                        started_at=now - timedelta(days=2),
                        completed_at=now,
                    ),
                    RefreshToken(
                        user_id=student_a_id,
                        token_id='student-active-session',
                        expires_at=now + timedelta(days=1),
                    ),
                    RefreshToken(
                        user_id=teacher_id,
                        token_id='teacher-active-session',
                        expires_at=now + timedelta(days=1),
                    ),
                ]
            )
            assignment = Assignment(
                classroom_id=classroom.id,
                lesson_id=low_lesson.id,
                title='Practice assignment',
                description=encode_assignment_description(
                    'Practice body',
                    assignment_type='lesson_practice',
                    submission_format='text',
                ),
                difficulty='medium',
                xp_reward=80,
            )
            db.session.add(assignment)
            db.session.flush()
            db.session.add_all(
                [
                    AssignmentSubmission(
                        assignment_id=assignment.id,
                        student_id=student_a_id,
                        answer='Done',
                        score=80,
                        status='checked',
                        submitted_at=now,
                    ),
                    AssignmentSubmission(
                        assignment_id=assignment.id,
                        student_id=student_b_id,
                        answer='Please check',
                        score=0,
                        status='pending_review',
                        submitted_at=now,
                    ),
                ]
            )
            low_lesson_id = low_lesson.id
            db.session.commit()

        with app.test_client() as admin_client:
            login_response = self.login(admin_client, 'admin@example.com', 'AdminPass123!')
            self.assertEqual(login_response.status_code, 200)

            telemetry_response = admin_client.get('/api/admin/telemetry')
            self.assertEqual(telemetry_response.status_code, 200)
            payload = telemetry_response.get_json()

        self.assertEqual(payload['load']['active_students'], 1)
        self.assertEqual(payload['load']['active_teachers'], 1)
        self.assertEqual(payload['audience']['students_with_linked_parent'], 0)
        self.assertEqual(payload['audience']['parent_coverage_percent'], 0.0)
        self.assertEqual(payload['north_star']['window_days'], 7)
        self.assertEqual(payload['north_star']['weekly_active_learners'], 2)
        self.assertAlmostEqual(payload['north_star']['share_of_students_percent'], 66.7, places=1)
        self.assertEqual(payload['practice']['submissions'], 2)
        self.assertEqual(payload['practice']['assignments_with_submissions'], 1)
        self.assertEqual(payload['practice']['submission_rate'], 100.0)
        self.assertEqual(payload['practice']['pending_review'], 1)
        self.assertEqual(payload['learning']['lowest_completion_lessons'][0]['lesson_id'], low_lesson_id)
        self.assertAlmostEqual(
            payload['learning']['lowest_completion_lessons'][0]['completion_rate'],
            33.3,
            places=1,
        )

    def test_admin_telemetry_parent_coverage_metric(self):
        app = self.create_app()
        self.create_user(
            app,
            full_name='Admin Example',
            email='admin@example.com',
            password='AdminPass123!',
            role='admin',
            age_group='adult',
        )
        parent_id = self.create_user(
            app,
            full_name='Parent Example',
            email='parent@example.com',
            password='ParentPass123!',
            role='parent',
            age_group='adult',
        )
        linked_student_id = self.create_user(
            app,
            full_name='Linked Child',
            email='linked-child@example.com',
            password='StudentPass123!',
            role='student',
            age_group='middle',
        )
        self.create_user(
            app,
            full_name='Orphan Student',
            email='orphan@example.com',
            password='StudentPass123!',
            role='student',
            age_group='middle',
        )

        with app.app_context():
            from app.core.db import db
            from app.models.parent_cabinet import ParentChildLink

            db.session.add(
                ParentChildLink(
                    parent_user_id=parent_id,
                    child_user_id=linked_student_id,
                    active=True,
                )
            )
            db.session.commit()

        with app.test_client() as admin_client:
            login_response = self.login(admin_client, 'admin@example.com', 'AdminPass123!')
            self.assertEqual(login_response.status_code, 200)
            telemetry_response = admin_client.get('/api/admin/telemetry')
            self.assertEqual(telemetry_response.status_code, 200)
            payload = telemetry_response.get_json()

        self.assertEqual(payload['audience']['students'], 2)
        self.assertEqual(payload['audience']['students_with_linked_parent'], 1)
        self.assertEqual(payload['audience']['parent_coverage_percent'], 50.0)
        self.assertEqual(payload['north_star']['weekly_active_learners'], 0)
        self.assertEqual(payload['north_star']['share_of_students_percent'], 0.0)

    def test_superadmin_can_manage_admins_and_filter_audit_logs(self):
        app = self.create_app()
        self.create_user(
            app,
            full_name='Super Admin',
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
                    'password': 'OpsAdminPass123!',
                },
            )
            self.assertEqual(create_response.status_code, 201)
            admin_id = create_response.get_json()['user']['id']

            admins_response = superadmin_client.get('/api/admin/admins?email=ops@&status=active')
            self.assertEqual(admins_response.status_code, 200)
            admins_payload = admins_response.get_json()
            self.assertEqual(admins_payload['pagination']['total'], 1)
            self.assertEqual(admins_payload['admins'][0]['email'], 'ops@example.com')

            block_response = superadmin_client.patch(f'/api/admin/admins/{admin_id}/block')
            self.assertEqual(block_response.status_code, 200)
            self.assertFalse(block_response.get_json()['user']['is_active'])

            audit_response = superadmin_client.get(
                '/api/admin/audit-logs?action=admin_blocked&actor_role=superadmin&target=ops@'
            )
            self.assertEqual(audit_response.status_code, 200)
            audit_payload = audit_response.get_json()
            self.assertEqual(audit_payload['pagination']['total'], 1)
            self.assertEqual(audit_payload['audit_logs'][0]['details']['target_email'], 'ops@example.com')

            delete_response = superadmin_client.delete(f'/api/admin/admins/{admin_id}')
            self.assertEqual(delete_response.status_code, 200)

    def test_audit_log_export_clears_db_and_archive_api(self):
        import json

        app = self.create_app()
        archive_root = Path(self._tempdirs[-1].name) / 'audit_archives'
        app.config['AUDIT_LOG_ARCHIVE_DIR'] = str(archive_root)

        self.create_user(
            app,
            full_name='Admin Example',
            email='admin@example.com',
            password='AdminPass123!',
            role='admin',
            age_group='adult',
        )

        with app.app_context():
            from app.core.db import db
            from app.models.user import AdminAuditLog, User, UserRole

            user = User.query.filter_by(email='admin@example.com').first()
            assert user is not None
            db.session.add(
                AdminAuditLog(
                    actor_user_id=user.id,
                    actor_role=UserRole.ADMIN.value,
                    action='test_action',
                    entity_type='test',
                    entity_id=1,
                    entity_label='target',
                    details_json={'note': 'unit'},
                )
            )
            db.session.commit()

        with app.test_client() as client:
            login_response = self.login(client, 'admin@example.com', 'AdminPass123!')
            self.assertEqual(login_response.status_code, 200)
            list_before = client.get('/api/admin/audit-log-archives')
            self.assertEqual(list_before.status_code, 200)
            self.assertEqual(list_before.get_json()['dates'], [])

        with app.app_context():
            from app.services.audit_log_archive import run_daily_admin_log_exports

            result = run_daily_admin_log_exports()
            self.assertEqual(result['audit']['status'], 'ok')
            self.assertEqual(result['audit']['row_count'], 1)
            self.assertEqual(result['site_activity']['status'], 'skipped')

        with app.app_context():
            from app.models.user import AdminAuditLog

            self.assertEqual(AdminAuditLog.query.count(), 0)

        files = list(archive_root.glob('admin_audit_*.json'))
        self.assertEqual(len(files), 1)
        data = json.loads(files[0].read_text(encoding='utf-8'))
        self.assertEqual(data['row_count'], 1)
        self.assertEqual(data['items'][0]['action'], 'test_action')

        with app.test_client() as client:
            self.login(client, 'admin@example.com', 'AdminPass123!')
            list_after = client.get('/api/admin/audit-log-archives')
            self.assertEqual(list_after.status_code, 200)
            archives_json = list_after.get_json()
            dates = archives_json['dates']
            self.assertEqual(len(dates), 1)
            self.assertIn('site_activity_dates', archives_json)
            self.assertEqual(archives_json.get('site_activity_dates', []), [])
            d = dates[0]
            dl = client.get(f'/api/admin/audit-log-archives/{d}')
            self.assertEqual(dl.status_code, 200)
            self.assertIn('application/json', (dl.headers.get('Content-Type') or '').lower())

    def test_daily_export_site_activity_only(self):
        import json as json_lib

        app = self.create_app()
        archive_root = Path(self._tempdirs[-1].name) / 'audit_archives_sa'
        app.config['AUDIT_LOG_ARCHIVE_DIR'] = str(archive_root)

        self.create_user(
            app,
            full_name='Admin Example',
            email='admin_sa@example.com',
            password='AdminPass123!',
            role='admin',
            age_group='adult',
        )
        student_id = self.create_user(
            app,
            full_name='Solo Student',
            email='solo_sa@example.com',
            password='StudentPass123!',
            role='student',
            age_group='middle',
        )
        with app.app_context():
            from app.core.db import db
            from app.models.user import AdminAuditLog, SiteActivityLog

            self.assertEqual(AdminAuditLog.query.count(), 0)
            db.session.add(
                SiteActivityLog(
                    user_id=student_id,
                    user_role='student',
                    method='POST',
                    path='/api/hello',
                    status_code=404,
                    client_ip='127.0.0.2',
                )
            )
            db.session.commit()

        with app.app_context():
            from app.models.user import AdminAuditLog, SiteActivityLog
            from app.services.audit_log_archive import run_daily_admin_log_exports

            result = run_daily_admin_log_exports()
            self.assertEqual(AdminAuditLog.query.count(), 0)
            self.assertEqual(SiteActivityLog.query.count(), 0)

        self.assertEqual(result['audit']['status'], 'skipped')
        self.assertEqual(result['site_activity']['status'], 'ok')
        self.assertEqual(result['site_activity']['row_count'], 1)
        date_key = result['site_activity']['date']

        sa_files = list(archive_root.glob('site_activity_*.json'))
        self.assertEqual(len(sa_files), 1)
        dumped = json_lib.loads(sa_files[0].read_text(encoding='utf-8'))
        self.assertEqual(dumped['items'][0]['path'], '/api/hello')

        with app.test_client() as client:
            self.login(client, 'admin_sa@example.com', 'AdminPass123!')
            archives = client.get('/api/admin/audit-log-archives')
            self.assertEqual(archives.status_code, 200)
            self.assertEqual(archives.get_json()['dates'], [])
            self.assertEqual(archives.get_json()['site_activity_dates'], [date_key])

            dl = client.get(f'/api/admin/site-activity-log-archives/{date_key}')
            self.assertEqual(dl.status_code, 200)

    def test_manual_log_export_writes_timestamp_filenames(self):
        import json as json_lib
        import re

        app = self.create_app()
        archive_root = Path(self._tempdirs[-1].name) / 'manual_archives'
        app.config['AUDIT_LOG_ARCHIVE_DIR'] = str(archive_root)

        admin_id = self.create_user(
            app,
            full_name='Admin Example',
            email='manual-export@example.com',
            password='AdminPass123!',
            role='admin',
            age_group='adult',
        )
        with app.app_context():
            from app.core.db import db
            from app.models.user import AdminAuditLog, SiteActivityLog, UserRole

            db.session.add_all(
                [
                    AdminAuditLog(
                        actor_user_id=admin_id,
                        actor_role=UserRole.ADMIN.value,
                        action='manual_test',
                        entity_type='entity',
                        entity_id=42,
                        entity_label='x',
                        details_json={'k': 'v'},
                    ),
                    SiteActivityLog(
                        user_id=admin_id,
                        user_role='admin',
                        method='GET',
                        path='/api/x',
                        status_code=204,
                        client_ip='127.0.0.1',
                    ),
                ]
            )
            db.session.commit()

        with app.test_client() as client:
            login_response = self.login(client, 'manual-export@example.com', 'AdminPass123!')
            self.assertEqual(login_response.status_code, 200)

            resp = client.post(
                '/api/admin/audit-log-archives/export-manual',
                json={'snapshot_key': '2099-12-31_23-59-59'},
            )
            self.assertEqual(resp.status_code, 200)
            body = resp.get_json() or {}
            self.assertEqual(body.get('export_kind'), 'manual')
            self.assertEqual(body['snapshot_timezone'], 'browser_local')
            self.assertEqual(body['snapshot_key'], '2099-12-31_23-59-59')
            self.assertRegex(
                body['snapshot_key'],
                re.compile(r'^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$'),
            )
            self.assertEqual(body['audit']['status'], 'ok')
            self.assertEqual(body['audit']['row_count'], 1)
            self.assertEqual(body['site_activity']['status'], 'ok')
            self.assertEqual(body['site_activity']['row_count'], 1)

        with app.app_context():
            from app.models.user import AdminAuditLog, SiteActivityLog

            self.assertEqual(AdminAuditLog.query.count(), 0)
            self.assertEqual(SiteActivityLog.query.count(), 0)

        files_a = sorted(archive_root.glob('admin_audit_manual_*.json'))
        files_s = sorted(archive_root.glob('site_activity_manual_*.json'))
        self.assertEqual(len(files_a), 1)
        self.assertEqual(len(files_s), 1)

        jd = json_lib.loads(files_a[0].read_text(encoding='utf-8'))
        self.assertEqual(jd.get('export_kind'), 'manual')
        self.assertEqual(jd.get('snapshot_timezone'), 'browser_local')
        self.assertEqual(jd['items'][0]['action'], 'manual_test')

    def test_manual_export_invalid_snapshot_key_falls_back_to_server_utc(self):
        app = self.create_app()
        archive_root = Path(self._tempdirs[-1].name) / 'manual_archives_fallback'
        app.config['AUDIT_LOG_ARCHIVE_DIR'] = str(archive_root)

        admin_id = self.create_user(
            app,
            full_name='Admin Fallback',
            email='fallback-manual@example.com',
            password='AdminPass123!',
            role='admin',
            age_group='adult',
        )
        with app.app_context():
            from app.core.db import db
            from app.models.user import AdminAuditLog, UserRole

            db.session.add(
                AdminAuditLog(
                    actor_user_id=admin_id,
                    actor_role=UserRole.ADMIN.value,
                    action='junk_key_test',
                    entity_type='entity',
                    entity_id=1,
                    entity_label='x',
                    details_json={},
                )
            )
            db.session.commit()

        with app.test_client() as client:
            login_response = self.login(client, 'fallback-manual@example.com', 'AdminPass123!')
            self.assertEqual(login_response.status_code, 200)
            resp = client.post(
                '/api/admin/audit-log-archives/export-manual',
                json={'snapshot_key': '2099-13-01_01-02-03'},
            )
            self.assertEqual(resp.status_code, 200)
            body = resp.get_json() or {}
            self.assertEqual(body.get('snapshot_timezone'), 'server_utc')

        with app.app_context():
            from app.models.user import AdminAuditLog

            self.assertEqual(AdminAuditLog.query.count(), 0)

    def test_site_activity_logs_and_audit_sorting(self):
        app = self.create_app()
        admin_id = self.create_user(
            app,
            full_name='Admin User',
            email='zeta@example.com',
            password='AdminPass123!',
            role='admin',
            age_group='adult',
        )
        with app.app_context():
            from app.core.db import db
            from app.models.user import AdminAuditLog, SiteActivityLog, UserRole

            db.session.add(
                AdminAuditLog(
                    actor_user_id=admin_id,
                    actor_role=UserRole.ADMIN.value,
                    action='user_blocked',
                    entity_type='user',
                    entity_id=2,
                    entity_label='target',
                    details_json={'actor_email': 'zeta@example.com', 'actor_name': 'Admin User'},
                )
            )
            db.session.add(
                SiteActivityLog(
                    user_id=admin_id,
                    user_role='admin',
                    method='GET',
                    path='/api/teacher/modules',
                    status_code=200,
                    client_ip='127.0.0.1',
                )
            )
            db.session.commit()

        with app.test_client() as client:
            login_response = self.login(client, 'zeta@example.com', 'AdminPass123!')
            self.assertEqual(login_response.status_code, 200)

            r_sort = client.get('/api/admin/audit-logs?sort=action&order=asc&page=1&page_size=20')
            self.assertEqual(r_sort.status_code, 200)
            self.assertEqual(r_sort.get_json()['filters']['sort'], 'action')

            r_actor = client.get('/api/admin/audit-logs?actor_login=zeta&sort=email&order=desc')
            self.assertEqual(r_actor.status_code, 200)
            self.assertEqual(r_actor.get_json()['pagination']['total'], 1)

            r_act = client.get(
                '/api/admin/site-activity-logs?email=zeta&sort=path&order=asc&page=1&page_size=20'
            )
            self.assertEqual(r_act.status_code, 200)
            body = r_act.get_json()
            self.assertEqual(body['pagination']['total'], 1)
            self.assertEqual(body['site_activity_logs'][0]['path'], '/api/teacher/modules')
            self.assertEqual(body['site_activity_logs'][0]['user_id'], admin_id)
            self.assertEqual(body['filters']['sort'], 'path')


if __name__ == '__main__':
    unittest.main()
