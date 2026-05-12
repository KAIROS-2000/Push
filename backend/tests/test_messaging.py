from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


MESSAGING_MAX_BODY_LENGTH = 2000


def _conversation_from_payload(payload: dict) -> dict:
    conversation = payload.get('conversation', payload)
    if not isinstance(conversation, dict):
        return {}
    return conversation


def _conversation_id(conversation: dict) -> int:
    return int(conversation.get('id') or conversation.get('conversation_id'))


def _messages_from_payload(payload: dict) -> list[dict]:
    messages = payload.get('messages', [])
    return messages if isinstance(messages, list) else []


def _summary_conversations(payload: dict) -> list[dict]:
    conversations = payload.get('conversations', [])
    return conversations if isinstance(conversations, list) else []


class TeacherStudentMessagingTests(unittest.TestCase):
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

    def create_app(self, *, run_migrations: bool = True):
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
                if run_migrations:
                    from app.core.migrations import upgrade_database

                    upgrade_database()
                else:
                    from app import models  # noqa: F401
                    from app.core.db import db

                    db.create_all()
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

    def create_messaging_fixture(self, app) -> dict[str, int]:
        from app.core.db import db
        from app.models.learning import ClassMembership, Classroom

        teacher_id = self.create_user(
            app,
            full_name='Teacher One',
            email='teacher1@example.com',
            password='TeacherPass123!',
            role='teacher',
        )
        other_teacher_id = self.create_user(
            app,
            full_name='Teacher Two',
            email='teacher2@example.com',
            password='TeacherPass123!',
            role='teacher',
        )
        student_id = self.create_user(
            app,
            full_name='Student One',
            email='student1@example.com',
            password='StudentPass123!',
            role='student',
            age_group='middle',
        )
        other_student_id = self.create_user(
            app,
            full_name='Student Two',
            email='student2@example.com',
            password='StudentPass123!',
            role='student',
            age_group='middle',
        )
        admin_id = self.create_user(
            app,
            full_name='Admin User',
            email='admin@example.com',
            password='AdminPass123!',
            role='admin',
        )
        superadmin_id = self.create_user(
            app,
            full_name='Super Admin',
            email='root@example.com',
            password='RootPass123!',
            role='superadmin',
        )

        with app.app_context():
            classroom = Classroom(name='Class A', description='Messaging class', code='MSG001', teacher_id=teacher_id)
            other_classroom = Classroom(name='Class B', description='Other class', code='MSG002', teacher_id=other_teacher_id)
            db.session.add_all([classroom, other_classroom])
            db.session.flush()
            db.session.add(ClassMembership(classroom_id=classroom.id, student_id=student_id))
            db.session.add(ClassMembership(classroom_id=other_classroom.id, student_id=other_student_id))
            db.session.commit()
            return {
                'teacher_id': teacher_id,
                'other_teacher_id': other_teacher_id,
                'student_id': student_id,
                'other_student_id': other_student_id,
                'admin_id': admin_id,
                'superadmin_id': superadmin_id,
                'classroom_id': classroom.id,
                'other_classroom_id': other_classroom.id,
            }

    def login(self, client, login: str, password: str) -> None:
        response = client.post('/api/auth/login', json={'login': login, 'password': password})
        self.assertEqual(response.status_code, 200)

    def create_conversation_as_student(self, app, ids: dict[str, int]) -> int:
        with app.test_client() as client:
            self.login(client, 'student1@example.com', 'StudentPass123!')
            response = client.post('/api/messaging/conversations', json={'classroom_id': ids['classroom_id']})
            self.assertEqual(response.status_code, 201)
            return _conversation_id(_conversation_from_payload(response.get_json()))

    def assert_denied(self, response) -> None:
        self.assertIn(response.status_code, {403, 404})

    def assert_conversation_metadata(self, conversation: dict, ids: dict[str, int]) -> None:
        for key in {'id', 'classroom_id', 'teacher_id', 'student_id'}:
            self.assertIn(key, conversation)
        self.assertEqual(conversation['classroom_id'], ids['classroom_id'])
        self.assertEqual(conversation['teacher_id'], ids['teacher_id'])
        self.assertEqual(conversation['student_id'], ids['student_id'])
        self.assertIn('classroom_name', conversation)
        self.assertIn('teacher_name', conversation)
        self.assertIn('student_name', conversation)

    def test_student_creates_class_context_conversation(self):
        app = self.create_app()
        ids = self.create_messaging_fixture(app)

        with app.test_client() as client:
            self.login(client, 'student1@example.com', 'StudentPass123!')
            response = client.post('/api/messaging/conversations', json={'classroom_id': ids['classroom_id']})

        self.assertEqual(response.status_code, 201)
        self.assert_conversation_metadata(_conversation_from_payload(response.get_json()), ids)

    def test_teacher_creates_conversation_for_class_student(self):
        app = self.create_app()
        ids = self.create_messaging_fixture(app)

        with app.test_client() as client:
            self.login(client, 'teacher1@example.com', 'TeacherPass123!')
            first = client.post(
                '/api/messaging/conversations',
                json={'classroom_id': ids['classroom_id'], 'student_id': ids['student_id']},
            )
            second = client.post(
                '/api/messaging/conversations',
                json={'classroom_id': ids['classroom_id'], 'student_id': ids['student_id']},
            )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        first_conversation = _conversation_from_payload(first.get_json())
        second_conversation = _conversation_from_payload(second.get_json())
        self.assert_conversation_metadata(first_conversation, ids)
        self.assertEqual(_conversation_id(first_conversation), _conversation_id(second_conversation))

    def test_send_message_and_list_messages_both_roles(self):
        app = self.create_app()
        ids = self.create_messaging_fixture(app)
        conversation_id = self.create_conversation_as_student(app, ids)

        with app.test_client() as student_client:
            self.login(student_client, 'student1@example.com', 'StudentPass123!')
            student_send = student_client.post(
                f'/api/messaging/conversations/{conversation_id}/messages',
                json={'body': 'Hello teacher'},
            )
            self.assertEqual(student_send.status_code, 201)

        with app.test_client() as teacher_client:
            self.login(teacher_client, 'teacher1@example.com', 'TeacherPass123!')
            teacher_list = teacher_client.get(f'/api/messaging/conversations/{conversation_id}/messages')
            self.assertEqual(teacher_list.status_code, 200)
            teacher_send = teacher_client.post(
                f'/api/messaging/conversations/{conversation_id}/messages',
                json={'body': 'Hello student'},
            )
            self.assertEqual(teacher_send.status_code, 201)

        with app.test_client() as student_client:
            self.login(student_client, 'student1@example.com', 'StudentPass123!')
            student_list = student_client.get(f'/api/messaging/conversations/{conversation_id}/messages')

        self.assertEqual(student_list.status_code, 200)
        teacher_payload = teacher_list.get_json()
        student_payload = student_list.get_json()
        self.assert_conversation_metadata(_conversation_from_payload(teacher_payload), ids)
        messages = _messages_from_payload(student_payload)
        self.assertEqual([message['body'] for message in messages], ['Hello teacher', 'Hello student'])
        self.assertEqual([message['sender_id'] for message in messages], [ids['student_id'], ids['teacher_id']])
        for message in messages:
            for key in {'id', 'conversation_id', 'sender_id', 'sender_role', 'body', 'created_at'}:
                self.assertIn(key, message)
            self.assertEqual(message['conversation_id'], conversation_id)

    def test_unread_counts_increment_for_recipient_and_clear_on_read(self):
        app = self.create_app()
        ids = self.create_messaging_fixture(app)
        conversation_id = self.create_conversation_as_student(app, ids)

        with app.test_client() as student_client:
            self.login(student_client, 'student1@example.com', 'StudentPass123!')
            sent = student_client.post(
                f'/api/messaging/conversations/{conversation_id}/messages',
                json={'body': 'Please review my task'},
            )
            self.assertEqual(sent.status_code, 201)
            student_summary = student_client.get('/api/messaging/summary')

        with app.test_client() as teacher_client:
            self.login(teacher_client, 'teacher1@example.com', 'TeacherPass123!')
            teacher_summary_before = teacher_client.get('/api/messaging/summary')
            messages_response = teacher_client.get(f'/api/messaging/conversations/{conversation_id}/messages')
            teacher_summary_after_get = teacher_client.get('/api/messaging/summary')
            read_response = teacher_client.post(f'/api/messaging/conversations/{conversation_id}/read')
            teacher_summary_after_read = teacher_client.get('/api/messaging/summary')
            repeated_read_response = teacher_client.post(f'/api/messaging/conversations/{conversation_id}/read')

        self.assertEqual(student_summary.status_code, 200)
        self.assertEqual(teacher_summary_before.status_code, 200)
        self.assertEqual(messages_response.status_code, 200)
        self.assertEqual(teacher_summary_after_get.status_code, 200)
        self.assertEqual(read_response.status_code, 200)
        self.assertEqual(repeated_read_response.status_code, 200)
        self.assertEqual(teacher_summary_after_read.status_code, 200)

        self.assertEqual(student_summary.get_json()['total_unread'], 0)
        self.assertEqual(teacher_summary_before.get_json()['total_unread'], 1)
        self.assertEqual(teacher_summary_after_get.get_json()['total_unread'], 1)
        self.assertEqual(teacher_summary_after_read.get_json()['total_unread'], 0)
        teacher_rows = _summary_conversations(teacher_summary_before.get_json())
        self.assertEqual(teacher_rows[0]['conversation_id'], conversation_id)
        self.assertEqual(teacher_rows[0]['unread_count'], 1)
        self.assertNotIn('messages', teacher_rows[0])

    def test_teacher_cannot_access_other_teacher_conversation(self):
        app = self.create_app()
        ids = self.create_messaging_fixture(app)
        conversation_id = self.create_conversation_as_student(app, ids)

        with app.test_client() as other_teacher_client:
            self.login(other_teacher_client, 'teacher2@example.com', 'TeacherPass123!')
            summary = other_teacher_client.get('/api/messaging/summary')
            open_response = other_teacher_client.get(f'/api/messaging/conversations/{conversation_id}/messages')
            send_response = other_teacher_client.post(
                f'/api/messaging/conversations/{conversation_id}/messages',
                json={'body': 'I should not be here'},
            )
            read_response = other_teacher_client.post(f'/api/messaging/conversations/{conversation_id}/read')
            create_response = other_teacher_client.post(
                '/api/messaging/conversations',
                json={'classroom_id': ids['classroom_id'], 'student_id': ids['student_id']},
            )

        self.assertEqual(summary.status_code, 200)
        self.assertEqual(_summary_conversations(summary.get_json()), [])
        self.assert_denied(open_response)
        self.assert_denied(send_response)
        self.assert_denied(read_response)
        self.assert_denied(create_response)

    def test_student_cannot_access_unrelated_class_conversation(self):
        app = self.create_app()
        ids = self.create_messaging_fixture(app)
        conversation_id = self.create_conversation_as_student(app, ids)

        with app.test_client() as other_student_client:
            self.login(other_student_client, 'student2@example.com', 'StudentPass123!')
            summary = other_student_client.get('/api/messaging/summary')
            open_response = other_student_client.get(f'/api/messaging/conversations/{conversation_id}/messages')
            send_response = other_student_client.post(
                f'/api/messaging/conversations/{conversation_id}/messages',
                json={'body': 'I should not be here'},
            )
            read_response = other_student_client.post(f'/api/messaging/conversations/{conversation_id}/read')
            create_response = other_student_client.post(
                '/api/messaging/conversations',
                json={'classroom_id': ids['classroom_id']},
            )

        self.assertEqual(summary.status_code, 200)
        self.assertEqual(_summary_conversations(summary.get_json()), [])
        self.assert_denied(open_response)
        self.assert_denied(send_response)
        self.assert_denied(read_response)
        self.assert_denied(create_response)

    def test_admin_roles_do_not_have_messaging_access_first_pass(self):
        app = self.create_app()
        ids = self.create_messaging_fixture(app)
        conversation_id = self.create_conversation_as_student(app, ids)

        for login, password in [
            ('admin@example.com', 'AdminPass123!'),
            ('root@example.com', 'RootPass123!'),
        ]:
            with self.subTest(login=login), app.test_client() as client:
                self.login(client, login, password)
                self.assert_denied(client.get('/api/messaging/summary'))
                self.assert_denied(
                    client.post(
                        '/api/messaging/conversations',
                        json={'classroom_id': ids['classroom_id'], 'student_id': ids['student_id']},
                    )
                )
                self.assert_denied(client.get(f'/api/messaging/conversations/{conversation_id}/messages'))
                self.assert_denied(
                    client.post(
                        f'/api/messaging/conversations/{conversation_id}/messages',
                        json={'body': 'Admin should not send'},
                    )
                )
                self.assert_denied(client.post(f'/api/messaging/conversations/{conversation_id}/read'))

    def test_message_body_validation(self):
        app = self.create_app()
        ids = self.create_messaging_fixture(app)
        conversation_id = self.create_conversation_as_student(app, ids)
        oversized = 'x' * (MESSAGING_MAX_BODY_LENGTH + 1)

        with app.test_client() as student_client:
            self.login(student_client, 'student1@example.com', 'StudentPass123!')
            empty_response = student_client.post(
                f'/api/messaging/conversations/{conversation_id}/messages',
                json={'body': '   '},
            )
            oversized_response = student_client.post(
                f'/api/messaging/conversations/{conversation_id}/messages',
                json={'body': oversized},
            )
            trimmed_response = student_client.post(
                f'/api/messaging/conversations/{conversation_id}/messages',
                json={'body': '  Trimmed body  '},
            )
            messages_response = student_client.get(f'/api/messaging/conversations/{conversation_id}/messages')

        self.assertEqual(empty_response.status_code, 400)
        self.assertEqual(oversized_response.status_code, 400)
        self.assertEqual(trimmed_response.status_code, 201)
        self.assertEqual(messages_response.status_code, 200)
        self.assertEqual(_messages_from_payload(messages_response.get_json())[-1]['body'], 'Trimmed body')

    def test_mark_read_rejects_message_from_another_conversation(self):
        app = self.create_app()
        ids = self.create_messaging_fixture(app)
        first_conversation_id = self.create_conversation_as_student(app, ids)

        with app.test_client() as other_student_client:
            self.login(other_student_client, 'student2@example.com', 'StudentPass123!')
            other_create = other_student_client.post(
                '/api/messaging/conversations',
                json={'classroom_id': ids['other_classroom_id']},
            )
            self.assertEqual(other_create.status_code, 201)
            other_conversation_id = _conversation_id(_conversation_from_payload(other_create.get_json()))
            sent = other_student_client.post(
                f'/api/messaging/conversations/{other_conversation_id}/messages',
                json={'body': 'Other class message'},
            )
            self.assertEqual(sent.status_code, 201)
            other_message_id = sent.get_json()['message']['id'] if 'message' in sent.get_json() else sent.get_json()['id']

        with app.test_client() as student_client:
            self.login(student_client, 'student1@example.com', 'StudentPass123!')
            bad_read = student_client.post(
                f'/api/messaging/conversations/{first_conversation_id}/read',
                json={'last_message_id': other_message_id},
            )

        self.assertIn(bad_read.status_code, {400, 403})

    def test_stale_membership_and_ownership_remove_conversation_access(self):
        app = self.create_app()
        ids = self.create_messaging_fixture(app)
        membership_stale_conversation_id = self.create_conversation_as_student(app, ids)

        from app.core.db import db
        from app.models.learning import ClassMembership, Classroom

        with app.app_context():
            membership = ClassMembership.query.filter_by(
                classroom_id=ids['classroom_id'],
                student_id=ids['student_id'],
            ).one()
            db.session.delete(membership)
            db.session.commit()

        with app.test_client() as student_client:
            self.login(student_client, 'student1@example.com', 'StudentPass123!')
            stale_open = student_client.get(
                f'/api/messaging/conversations/{membership_stale_conversation_id}/messages'
            )
            stale_summary = student_client.get('/api/messaging/summary')

        self.assert_denied(stale_open)
        self.assertEqual(stale_summary.status_code, 200)
        self.assertEqual(_summary_conversations(stale_summary.get_json()), [])

        app = self.create_app()
        ids = self.create_messaging_fixture(app)
        ownership_stale_conversation_id = self.create_conversation_as_student(app, ids)
        with app.app_context():
            classroom = db.session.get(Classroom, ids['classroom_id'])
            classroom.teacher_id = ids['other_teacher_id']
            db.session.commit()

        with app.test_client() as teacher_client:
            self.login(teacher_client, 'teacher1@example.com', 'TeacherPass123!')
            stale_open = teacher_client.get(
                f'/api/messaging/conversations/{ownership_stale_conversation_id}/messages'
            )
            stale_summary = teacher_client.get('/api/messaging/summary')

        self.assert_denied(stale_open)
        self.assertEqual(stale_summary.status_code, 200)
        self.assertEqual(_summary_conversations(stale_summary.get_json()), [])

    def test_summary_contract_includes_unread_preview_metadata_without_history(self):
        app = self.create_app()
        ids = self.create_messaging_fixture(app)
        conversation_id = self.create_conversation_as_student(app, ids)

        with app.test_client() as student_client:
            self.login(student_client, 'student1@example.com', 'StudentPass123!')
            sent = student_client.post(
                f'/api/messaging/conversations/{conversation_id}/messages',
                json={'body': 'This is a preview message for summary polling'},
            )
            self.assertEqual(sent.status_code, 201)
            summary = student_client.get('/api/messaging/summary')

        self.assertEqual(summary.status_code, 200)
        payload = summary.get_json()
        self.assertEqual(payload['role'], 'student')
        self.assertEqual(payload['total_unread'], 0)
        rows = _summary_conversations(payload)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        for key in {
            'conversation_id',
            'classroom_id',
            'classroom_name',
            'teacher_id',
            'teacher_name',
            'student_id',
            'student_name',
            'latest_message_at',
            'latest_message_preview',
            'unread_count',
        }:
            self.assertIn(key, row)
        self.assertEqual(row['conversation_id'], conversation_id)
        self.assertNotIn('messages', row)
        self.assertLessEqual(len(row['latest_message_preview']), 120)

    def test_upgrade_database_creates_messaging_tables_and_is_idempotent(self):
        app = self.create_app(run_migrations=False)

        with app.app_context():
            from app.core.db import db
            from app.core.migrations import upgrade_database

            applied = upgrade_database()
            second_run = upgrade_database()
            inspector = inspect(db.engine)
            table_names = set(inspector.get_table_names())
            conversation_indexes = {
                item['name'] for item in inspector.get_indexes('message_conversations')
            }
            message_indexes = {item['name'] for item in inspector.get_indexes('messages')}
            read_state_indexes = {
                item['name'] for item in inspector.get_indexes('conversation_read_states')
            }
            conversation_unique_constraints = {
                tuple(item.get('column_names') or [])
                for item in inspector.get_unique_constraints('message_conversations')
            }
            read_state_unique_constraints = {
                tuple(item.get('column_names') or [])
                for item in inspector.get_unique_constraints('conversation_read_states')
            }

        self.assertIn('0004_teacher_student_messaging', applied)
        self.assertEqual(second_run, [])
        self.assertTrue(
            {'message_conversations', 'messages', 'conversation_read_states'}.issubset(table_names)
        )
        self.assertIn(
            ('classroom_id', 'teacher_id', 'student_id'),
            conversation_unique_constraints,
        )
        self.assertIn(('conversation_id', 'user_id'), read_state_unique_constraints)
        self.assertTrue(
            {
                'ix_message_conversation_classroom',
                'ix_message_conversation_teacher',
                'ix_message_conversation_student',
            }.issubset(conversation_indexes)
        )
        self.assertIn('ix_message_conversation_id_id', message_indexes)
        self.assertIn('ix_conversation_read_state_user_conversation', read_state_indexes)

    def test_db_create_all_sees_messaging_models_from_app_models_import(self):
        app = self.create_app(run_migrations=False)

        with app.app_context():
            from app import models  # noqa: F401
            from app.core.db import db

            db.drop_all()
            db.create_all()
            table_names = set(inspect(db.engine).get_table_names())

        self.assertTrue(
            {'message_conversations', 'messages', 'conversation_read_states'}.issubset(table_names)
        )

    def test_conversation_uniqueness_is_enforced_at_data_layer(self):
        app = self.create_app()
        ids = self.create_messaging_fixture(app)

        with app.app_context():
            from app.core.db import db

            db.session.execute(
                text(
                    """
                    INSERT INTO message_conversations
                        (classroom_id, teacher_id, student_id, created_at, updated_at)
                    VALUES
                        (:classroom_id, :teacher_id, :student_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    """
                ),
                {
                    'classroom_id': ids['classroom_id'],
                    'teacher_id': ids['teacher_id'],
                    'student_id': ids['student_id'],
                },
            )
            db.session.commit()
            with self.assertRaises(IntegrityError):
                db.session.execute(
                    text(
                        """
                        INSERT INTO message_conversations
                            (classroom_id, teacher_id, student_id, created_at, updated_at)
                        VALUES
                            (:classroom_id, :teacher_id, :student_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        """
                    ),
                    {
                        'classroom_id': ids['classroom_id'],
                        'teacher_id': ids['teacher_id'],
                        'student_id': ids['student_id'],
                    },
                )
                db.session.commit()
            db.session.rollback()


if __name__ == '__main__':
    unittest.main()
