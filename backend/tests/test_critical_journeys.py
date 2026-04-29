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


class CriticalJourneyTests(unittest.TestCase):
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
            'CODE_JUDGE_RUNNER_URL': 'http://judge-runner:8090/execute',
            'CODE_JUDGE_RUNNER_TOKEN': 'unit-test-runner-token',
            'CODE_JUDGE_ALLOW_LOCAL_FALLBACK': 'false',
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

    def create_student(self, app, *, email='student@example.com'):
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.user import User, UserRole

        with app.app_context():
            student = User(
                full_name='Student Example',
                username=email.split('@')[0][:10],
                email=email,
                password_hash=hash_password('StudentPass123!'),
                role=UserRole.STUDENT,
                age_group='middle',
            )
            db.session.add(student)
            db.session.commit()
            return student.id

    def create_teacher(self, app):
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.user import User, UserRole

        with app.app_context():
            teacher = User(
                full_name='Teacher Example',
                username='teacher',
                email='teacher@example.com',
                password_hash=hash_password('TeacherPass123!'),
                role=UserRole.TEACHER,
            )
            db.session.add(teacher)
            db.session.commit()
            return teacher.id

    def create_code_lesson(self, app):
        from app.core.db import db
        from app.models.learning import Lesson, Module, Task

        with app.app_context():
            module = Module(
                slug='middle-code',
                title='Middle Code',
                description='Code lessons',
                age_group='middle',
                icon='code',
                color='#4A90D9',
                order_index=1,
                is_published=True,
            )
            db.session.add(module)
            db.session.flush()
            lesson = Lesson(
                module_id=module.id,
                slug='echo-lesson',
                title='Echo lesson',
                summary='Echo stdin',
                order_index=1,
                passing_score=70,
                theory_blocks=[],
                interactive_steps=[],
            )
            db.session.add(lesson)
            db.session.flush()
            task = Task(
                lesson_id=lesson.id,
                task_type='code',
                title='Echo',
                prompt='Read one line and print it.',
                starter_code='print(input())',
                validation={
                    'evaluation_mode': 'stdin_stdout',
                    'language': 'python',
                    'tests': [{'label': 'echo', 'input': 'ok\n', 'expected': 'ok'}],
                },
                hints=[],
                xp_reward=10,
            )
            db.session.add(task)
            db.session.commit()
            return lesson.id, task.id

    def login(self, client, *, login='student@example.com', password='StudentPass123!'):
        response = client.post('/api/auth/login', json={'login': login, 'password': password})
        self.assertEqual(response.status_code, 200)
        return response

    def test_auth_login_and_refresh_cookie_session(self):
        app = self.create_app()
        self.create_student(app)

        with app.test_client() as client:
            self.login(client)
            refresh_response = client.post('/api/auth/refresh')

        self.assertEqual(refresh_response.status_code, 200)
        self.assertIn('user', refresh_response.get_json())
        self.assertTrue(any('codequest_access_token=' in cookie for cookie in refresh_response.headers.getlist('Set-Cookie')))

    def test_teacher_refresh_token_survives_parallel_refresh_retry(self):
        app = self.create_app()
        self.create_teacher(app)

        with app.test_client() as client:
            self.login(client, login='teacher@example.com', password='TeacherPass123!')
            refresh_cookie = client.get_cookie('codequest_refresh_token')
            csrf_cookie = client.get_cookie('csrf_token')
            self.assertIsNotNone(refresh_cookie)
            self.assertIsNotNone(csrf_cookie)
            original_refresh_token = refresh_cookie.value

            first_refresh = client.post(
                '/api/auth/refresh',
                json={'refresh_token': original_refresh_token},
                headers={'X-CSRF-Token': csrf_cookie.value},
            )
            self.assertEqual(first_refresh.status_code, 200)

            next_csrf_cookie = client.get_cookie('csrf_token')
            self.assertIsNotNone(next_csrf_cookie)
            second_refresh = client.post(
                '/api/auth/refresh',
                json={'refresh_token': original_refresh_token},
                headers={'X-CSRF-Token': next_csrf_cookie.value},
            )

        self.assertEqual(second_refresh.status_code, 200)
        self.assertEqual(second_refresh.get_json()['user']['role'], 'teacher')
        self.assertTrue(any('codequest_access_token=' in cookie for cookie in second_refresh.headers.getlist('Set-Cookie')))

    def test_student_task_submission_uses_remote_runner_contract(self):
        app = self.create_app()
        self.create_student(app)
        _, task_id = self.create_code_lesson(app)
        captured_payloads: list[dict] = []

        def fake_runner(payload: dict) -> dict:
            captured_payloads.append(payload)
            return {
                'mode': 'stdin_stdout',
                'runner': 'stdin_stdout',
                'language': payload['language'],
                'passed': True,
                'score': 100,
                'feedback': 'ok',
                'tests_passed': 1,
                'tests_total': 1,
                'results': [],
                'compile_error': None,
                'runtime_error': None,
                'time_limit_ms': payload['time_limit_ms'],
                'memory_limit_mb': payload['memory_limit_mb'],
            }

        with app.test_client() as client, patch('app.core.code_judge._post_to_runner', side_effect=fake_runner):
            self.login(client)
            response = client.post(f'/api/tasks/{task_id}/submit', json={'answer': 'print(input())'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['score'], 100)
        self.assertEqual(captured_payloads[0]['code'], 'print(input())')
        self.assertEqual(captured_payloads[0]['tests'][0]['expected'], 'ok')

    def test_gigachat_endpoint_is_unavailable_without_provider_call(self):
        app = self.create_app()
        self.create_student(app)
        lesson_id, _ = self.create_code_lesson(app)

        with app.test_client() as client, patch('app.core.gigachat.request_lesson_chat_completion') as completion:
            self.login(client)
            response = client.post(
                f'/api/lessons/{lesson_id}/gigachat',
                json={'messages': [{'role': 'user', 'content': 'Help'}]},
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_json()['message'], 'GigaChat недоступен в проекте.')
        completion.assert_not_called()

    def test_teacher_assignment_submission_and_grading_journey(self):
        app = self.create_app()
        student_id = self.create_student(app)
        teacher_id = self.create_teacher(app)
        lesson_id, _ = self.create_code_lesson(app)

        from app.core.db import db
        from app.models.learning import ClassMembership, Classroom

        with app.app_context():
            classroom = Classroom(name='Class A', description='Test class', code='CLASSA', teacher_id=teacher_id)
            db.session.add(classroom)
            db.session.flush()
            db.session.add(ClassMembership(classroom_id=classroom.id, student_id=student_id))
            db.session.commit()
            classroom_id = classroom.id

        with app.test_client() as teacher_client:
            self.login(teacher_client, login='teacher@example.com', password='TeacherPass123!')
            assignment_response = teacher_client.post(
                f'/api/teacher/classes/{classroom_id}/assignments',
                json={
                    'lesson_id': lesson_id,
                    'title': 'Practice assignment',
                    'description': 'Solve and submit.',
                    'due_date': '2099-12-31',
                    'learning_goal': 'Practice code',
                    'work_steps': 'Submit answer',
                    'success_criteria': 'Teacher can review',
                    'resources': 'Course materials',
                },
            )
            self.assertEqual(assignment_response.status_code, 201)
            assignment_id = assignment_response.get_json()['assignment']['id']

        with app.test_client() as student_client:
            self.login(student_client)
            submit_response = student_client.post(
                f'/api/assignments/{assignment_id}/submit',
                json={'answer': 'A sufficiently long answer'},
            )
            self.assertEqual(submit_response.status_code, 200)

        with app.app_context():
            from app.models.learning import AssignmentSubmission

            submission_id = AssignmentSubmission.query.filter_by(assignment_id=assignment_id, student_id=student_id).one().id

        with app.test_client() as teacher_client:
            self.login(teacher_client, login='teacher@example.com', password='TeacherPass123!')
            grade_response = teacher_client.patch(
                f'/api/teacher/submissions/{submission_id}/grade',
                json={'score': 95, 'feedback': 'Good work', 'status': 'checked'},
            )

        self.assertEqual(grade_response.status_code, 200)
        self.assertEqual(grade_response.get_json()['submission']['score'], 95)
        self.assertEqual(grade_response.get_json()['submission']['status'], 'checked')

    def test_teacher_cannot_join_class_with_code(self):
        app = self.create_app()
        teacher_id = self.create_teacher(app)
        from app.core.db import db
        from app.models.learning import Classroom

        with app.app_context():
            db.session.add(
                Classroom(
                    name='T Class',
                    description='',
                    code='JOINME',
                    teacher_id=teacher_id,
                )
            )
            db.session.commit()

        with app.test_client() as client:
            self.login(client, login='teacher@example.com', password='TeacherPass123!')
            response = client.post('/api/classes/join', json={'code': 'joinme'})

        self.assertEqual(response.status_code, 403)


if __name__ == '__main__':
    unittest.main()
