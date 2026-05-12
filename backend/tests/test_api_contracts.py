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


def assert_has_keys(testcase: unittest.TestCase, payload: dict, keys: set[str], path: str) -> None:
    missing = keys - set(payload)
    testcase.assertFalse(missing, f'{path} missing keys: {sorted(missing)}')


class ApiContractTests(unittest.TestCase):
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
            'CODE_JUDGE_RUNNER_URL': 'http://judge-runner:8090/execute',
            'CODE_JUDGE_RUNNER_TOKEN': 'unit-test-runner-token',
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

    def seed_fixture(self, app):
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.learning import Classroom, Lesson, Module, Quiz, Task
        from app.models.user import User, UserRole

        with app.app_context():
            student = User(
                full_name='Student Example',
                email='student@example.com',
                password_hash=hash_password('StudentPass123!'),
                role=UserRole.STUDENT,
                age_group='middle',
            )
            teacher = User(
                full_name='Teacher Example',
                email='teacher@example.com',
                password_hash=hash_password('TeacherPass123!'),
                role=UserRole.TEACHER,
            )
            admin = User(
                full_name='Admin Example',
                email='admin@example.com',
                password_hash=hash_password('AdminPass123!'),
                role=UserRole.ADMIN,
            )
            db.session.add_all([student, teacher, admin])
            db.session.flush()
            module = Module(
                slug='middle-contracts',
                title='Contracts',
                description='Contract fixture',
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
                slug='contract-lesson',
                title='Contract lesson',
                summary='Contract summary',
                order_index=1,
                passing_score=70,
                theory_blocks=[],
                interactive_steps=[],
            )
            db.session.add(lesson)
            db.session.flush()
            task = Task(
                lesson_id=lesson.id,
                task_type='text',
                title='Text task',
                prompt='Explain',
                starter_code='',
                validation={'evaluation_mode': 'keywords', 'keywords': ['ok']},
                hints=[],
                xp_reward=10,
            )
            quiz = Quiz(
                lesson_id=lesson.id,
                title='Quiz',
                questions=[{'id': 'q1', 'type': 'single', 'prompt': 'Pick', 'options': ['ok'], 'correct': [0]}],
                passing_score=70,
                xp_reward=10,
            )
            classroom = Classroom(name='Class A', description='Test class', code='CLASSA', teacher_id=teacher.id)
            db.session.add_all([task, quiz, classroom])
            db.session.commit()
            return {
                'lesson_id': lesson.id,
                'task_id': task.id,
                'quiz_id': quiz.id,
                'classroom_id': classroom.id,
            }

    def login(self, client, login: str, password: str):
        response = client.post('/api/auth/login', json={'login': login, 'password': password})
        self.assertEqual(response.status_code, 200)
        return response

    def test_auth_and_lesson_contracts_match_frontend_assumptions(self):
        app = self.create_app()
        ids = self.seed_fixture(app)

        with app.test_client() as client:
            self.login(client, 'student@example.com', 'StudentPass123!')
            me_payload = client.get('/api/auth/me').get_json()
            lesson_payload = client.get(f"/api/lessons/{ids['lesson_id']}").get_json()

        assert_has_keys(self, me_payload, {'user'}, '/api/auth/me')
        assert_has_keys(
            self,
            me_payload['user'],
            {'id', 'full_name', 'email', 'role', 'age_group', 'xp', 'level', 'rank_title', 'xp_to_next', 'streak', 'theme', 'is_active'},
            '/api/auth/me.user',
        )
        assert_has_keys(
            self,
            lesson_payload,
            {'lesson', 'progress', 'is_finished', 'viewer_role'},
            '/api/lessons/<id>',
        )
        task = lesson_payload['lesson']['tasks'][0]
        assert_has_keys(self, task, {'id', 'task_type', 'title', 'prompt', 'starter_code', 'validation', 'hints', 'xp_reward'}, 'lesson.task')
        assert_has_keys(self, task['validation'], {'evaluation_mode', 'runner', 'language', 'keywords', 'tests_count', 'time_limit_ms', 'memory_limit_mb'}, 'lesson.task.validation')

    def test_submit_and_admin_list_contracts_match_frontend_assumptions(self):
        app = self.create_app()
        ids = self.seed_fixture(app)

        with app.test_client() as client:
            self.login(client, 'student@example.com', 'StudentPass123!')
            task_payload = client.post(f"/api/tasks/{ids['task_id']}/submit", json={'answer': 'ok'}).get_json()
            quiz_payload = client.post(f"/api/quizzes/{ids['quiz_id']}/submit", json={'answers': {'q1': 0}}).get_json()

        assert_has_keys(self, task_payload, {'passed', 'score', 'xp_awarded', 'xp_skipped', 'feedback', 'judge_report', 'requires_teacher_review', 'progress', 'user'}, '/api/tasks/<id>/submit')
        assert_has_keys(self, quiz_payload, {'passed', 'score', 'correct_answers', 'total_questions', 'xp_awarded', 'xp_skipped', 'progress', 'user', 'review_questions'}, '/api/quizzes/<id>/submit')

        with app.test_client() as client:
            self.login(client, 'admin@example.com', 'AdminPass123!')
            users_payload = client.get('/api/admin/users').get_json()

        assert_has_keys(self, users_payload, {'users', 'pagination', 'filters'}, '/api/admin/users')
        assert_has_keys(self, users_payload['pagination'], {'page', 'page_size', 'total', 'total_pages'}, '/api/admin/users.pagination')

    def test_lesson_start_and_hint_tracking_contracts_match_achievements(self):
        app = self.create_app()
        ids = self.seed_fixture(app)

        with app.app_context():
            from app.seed.bootstrap import seed_achievements

            seed_achievements()

        with app.test_client() as client:
            self.login(client, 'student@example.com', 'StudentPass123!')
            start_payload = client.post(f"/api/lessons/{ids['lesson_id']}/start").get_json()
            hints_payload = client.post(
                f"/api/lessons/{ids['lesson_id']}/hints",
                json={'hints_used': 2},
            ).get_json()
            reloaded_lesson_payload = client.get(f"/api/lessons/{ids['lesson_id']}").get_json()
            client.post(f"/api/tasks/{ids['task_id']}/submit", json={'answer': 'ok'}).get_json()

        assert_has_keys(self, start_payload, {'progress'}, '/api/lessons/<id>/start')
        self.assertIsNotNone(start_payload['progress']['started_at'])
        assert_has_keys(self, hints_payload, {'progress'}, '/api/lessons/<id>/hints')
        self.assertEqual(hints_payload['progress']['hints_used'], 2)
        self.assertIsNotNone(hints_payload['progress']['started_at'])
        self.assertEqual(reloaded_lesson_payload['progress']['hints_used'], 2)
        self.assertIsNotNone(reloaded_lesson_payload['progress']['started_at'])
        with app.app_context():
            from app.models.learning import Achievement, UserAchievement
            from app.models.user import User

            student = User.query.filter_by(email='student@example.com').one()
            no_hints = Achievement.query.filter_by(code='no_hints').one()
            earned_no_hints = UserAchievement.query.filter_by(
                user_id=student.id,
                achievement_id=no_hints.id,
            ).first()
        self.assertIsNone(earned_no_hints)

    def test_student_outranking_lesson_age_group_can_complete_without_xp(self):
        app = self.create_app()
        self.seed_fixture(app)

        with app.app_context():
            from app.core.db import db
            from app.models.learning import Lesson, Module, Quiz, Task
            from app.models.user import User
            from app.seed.bootstrap import seed_achievements

            seed_achievements()

            student = User.query.filter_by(email='student@example.com').one()
            self.assertEqual(student.age_group, 'middle')
            module = Module(
                slug='junior-review',
                title='Junior Review',
                description='Review younger lessons',
                age_group='junior',
                icon='sparkles',
                color='#4A90D9',
                order_index=1,
                is_published=True,
            )
            db.session.add(module)
            db.session.flush()
            task_lesson = Lesson(
                module_id=module.id,
                slug='junior-task',
                title='Junior task',
                summary='Task summary',
                order_index=1,
                passing_score=70,
                theory_blocks=[],
                interactive_steps=[],
            )
            quiz_lesson = Lesson(
                module_id=module.id,
                slug='junior-quiz',
                title='Junior quiz',
                summary='Quiz summary',
                order_index=2,
                passing_score=70,
                theory_blocks=[],
                interactive_steps=[],
            )
            db.session.add_all([task_lesson, quiz_lesson])
            db.session.flush()
            task = Task(
                lesson_id=task_lesson.id,
                task_type='text',
                title='Junior text',
                prompt='Explain',
                starter_code='',
                validation={'evaluation_mode': 'keywords', 'keywords': ['ok']},
                hints=[],
                xp_reward=30,
            )
            quiz = Quiz(
                lesson_id=quiz_lesson.id,
                title='Junior quiz',
                questions=[{'id': 'q1', 'type': 'single', 'prompt': 'Pick', 'options': ['ok'], 'correct': [0]}],
                passing_score=70,
                xp_reward=40,
            )
            db.session.add_all([task, quiz])
            db.session.commit()
            task_id = task.id
            quiz_id = quiz.id

        with app.test_client() as client:
            self.login(client, 'student@example.com', 'StudentPass123!')
            task_payload = client.post(f'/api/tasks/{task_id}/submit', json={'answer': 'ok'}).get_json()
            quiz_payload = client.post(f'/api/quizzes/{quiz_id}/submit', json={'answers': {'q1': 0}}).get_json()

        with app.app_context():
            from app.models.user import User

            student_xp = User.query.filter_by(email='student@example.com').one().xp

        self.assertTrue(task_payload['passed'])
        self.assertEqual(task_payload['xp_awarded'], 0)
        self.assertTrue(task_payload['xp_skipped'])
        self.assertTrue(quiz_payload['passed'])
        self.assertEqual(quiz_payload['xp_awarded'], 0)
        self.assertTrue(quiz_payload['xp_skipped'])
        self.assertEqual(student_xp, 0)

    def test_seed_achievements_adds_new_codes_without_duplicates(self):
        app = self.create_app()

        with app.app_context():
            from app.core.db import db
            from app.models.learning import Achievement
            from app.seed.bootstrap import seed_achievements

            db.session.add(
                Achievement(
                    code='first_code',
                    name='Existing First Code',
                    description='Existing row',
                    category='start',
                    icon='sparkles',
                    xp_reward=50,
                )
            )
            db.session.commit()

            seed_achievements()
            seed_achievements()

            codes = [achievement.code for achievement in Achievement.query.all()]

        self.assertEqual(codes.count('first_code'), 1)
        for code in {'patience', 'night_owl', 'early_bird', 'golden_streak', 'sprinter', 'no_hints', 'revisitor'}:
            self.assertIn(code, codes)

    def test_leaderboard_supports_class_scope_and_global_cache(self):
        app = self.create_app()
        ids = self.seed_fixture(app)

        with app.app_context():
            from app.core.db import db
            from app.core.security import hash_password
            from app.models.learning import ClassMembership
            from app.models.user import User, UserRole

            student = User.query.filter_by(email='student@example.com').first()
            self.assertIsNotNone(student)
            student.xp = 100

            classmate = User(
                full_name='Classmate Example',
                email='classmate@example.com',
                password_hash=hash_password('StudentPass123!'),
                role=UserRole.STUDENT,
                age_group='middle',
                xp=500,
            )
            outsider = User(
                full_name='Outsider Example',
                email='outsider@example.com',
                password_hash=hash_password('StudentPass123!'),
                role=UserRole.STUDENT,
                age_group='middle',
                xp=1000,
            )
            db.session.add_all([classmate, outsider])
            db.session.flush()
            db.session.add_all(
                [
                    ClassMembership(classroom_id=ids['classroom_id'], student_id=student.id),
                    ClassMembership(classroom_id=ids['classroom_id'], student_id=classmate.id),
                ]
            )
            db.session.commit()

        with app.test_client() as client:
            self.login(client, 'student@example.com', 'StudentPass123!')
            class_payload = client.get(
                f"/api/leaderboard?scope=class&classroom_id={ids['classroom_id']}"
            ).get_json()
            global_payload = client.get('/api/leaderboard').get_json()

            with app.app_context():
                from app.core.db import db
                from app.models.user import User

                User.query.filter_by(email='student@example.com').first().xp = 2000
                db.session.commit()

            cached_global_payload = client.get('/api/leaderboard').get_json()

        assert_has_keys(
            self,
            class_payload,
            {'leaderboard', 'me', 'classes', 'scope', 'classroom', 'refresh_seconds'},
            '/api/leaderboard?scope=class',
        )
        self.assertEqual(class_payload['scope'], 'class')
        self.assertEqual(class_payload['classroom']['id'], ids['classroom_id'])
        self.assertEqual(
            [row['full_name'] for row in class_payload['leaderboard']],
            ['Classmate Example', 'Student Example'],
        )
        for lb in (class_payload['leaderboard'], global_payload['leaderboard']):
            self.assertTrue(lb)
            for row in lb:
                self.assertIn('avatar_id', row)
                self.assertIn('frame_id', row)
        self.assertEqual(global_payload['leaderboard'], cached_global_payload['leaderboard'])

    def test_lesson_access_gate_for_locked_lesson_in_module(self):
        app = self.create_app()
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.learning import Lesson, Module
        from app.models.user import User, UserRole

        with app.app_context():
            student = User(
                full_name='Gate Student',
                email='gstudent@example.com',
                password_hash=hash_password('StudentPass123!'),
                role=UserRole.STUDENT,
                age_group='middle',
            )
            teacher = User(
                full_name='Gate Teacher',
                email='gteacher@example.com',
                password_hash=hash_password('TeacherPass123!'),
                role=UserRole.TEACHER,
            )
            parent = User(
                full_name='Gate Parent',
                email='gparent@example.com',
                password_hash=hash_password('ParentPass123!'),
                role=UserRole.PARENT,
            )
            db.session.add_all([student, teacher, parent])
            db.session.flush()
            module = Module(
                slug='gate-mod',
                title='Gate',
                description='Gate fixture',
                age_group='middle',
                icon='code',
                color='#4A90D9',
                order_index=1,
                is_published=True,
            )
            db.session.add(module)
            db.session.flush()
            first = Lesson(
                module_id=module.id,
                slug='gate-l1',
                title='First',
                summary='A',
                order_index=1,
                passing_score=70,
                theory_blocks=[],
                interactive_steps=[],
            )
            second = Lesson(
                module_id=module.id,
                slug='gate-l2',
                title='Second',
                summary='B',
                order_index=2,
                passing_score=70,
                theory_blocks=[],
                interactive_steps=[],
            )
            db.session.add_all([first, second])
            db.session.commit()
            first_id, second_id = first.id, second.id

        with app.test_client() as client:
            self.login(client, 'gstudent@example.com', 'StudentPass123!')
            locked_gate = client.get(f'/api/student/lesson-access/{second_id}').get_json()
            open_gate = client.get(f'/api/student/lesson-access/{first_id}').get_json()

        self.assertEqual(open_gate, {'allowed': True})
        self.assertFalse(locked_gate['allowed'])
        self.assertEqual(locked_gate['redirect_lesson_id'], first_id)

        # Parents may browse published lessons without forced sequence and can begin / complete
        # catalog lessons under their own UserProgress when exploring the roadmap.
        with app.test_client() as client:
            self.login(client, 'gparent@example.com', 'ParentPass123!')
            parent_first_gate = client.get(f'/api/student/lesson-access/{first_id}').get_json()
            parent_second_gate = client.get(f'/api/student/lesson-access/{second_id}').get_json()
            parent_first_lesson = client.get(f'/api/lessons/{first_id}')
            parent_second_lesson = client.get(f'/api/lessons/{second_id}')
            parent_start = client.post(f'/api/lessons/{first_id}/start')
            parent_complete = client.patch(
                f'/api/lessons/{first_id}/complete',
                json={},
            )

        self.assertEqual(parent_first_gate, {'allowed': True})
        self.assertEqual(parent_second_gate, {'allowed': True})
        self.assertEqual(parent_first_lesson.status_code, 200)
        self.assertEqual(parent_second_lesson.status_code, 200)
        self.assertEqual(parent_second_lesson.get_json()['viewer_role'], 'parent')
        self.assertEqual(parent_start.status_code, 200)
        self.assertEqual(parent_complete.status_code, 200)

        with app.test_client() as client:
            self.login(client, 'gteacher@example.com', 'TeacherPass123!')
            teacher_payload = client.get(f'/api/student/lesson-access/{second_id}').get_json()

        self.assertEqual(teacher_payload, {'allowed': True})

    def test_teacher_detail_contract_matches_frontend_assumptions(self):
        app = self.create_app()
        ids = self.seed_fixture(app)

        with app.test_client() as client:
            self.login(client, 'teacher@example.com', 'TeacherPass123!')
            payload = client.get(f"/api/teacher/classes/{ids['classroom_id']}").get_json()

        assert_has_keys(self, payload, {'classroom', 'students', 'assignments'}, '/api/teacher/classes/<id>')
        assert_has_keys(self, payload['classroom'], {'id', 'name', 'description', 'code', 'teacher_id', 'students_count', 'assignments_count'}, 'teacher.classroom')


if __name__ == '__main__':
    unittest.main()
