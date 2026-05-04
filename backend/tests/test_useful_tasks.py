"""Useful tasks (P2) — public listing + admin CRUD."""
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


class UsefulTasksBase(unittest.TestCase):
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
        env.update(env_overrides)

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

    def make_user(self, app, *, role, email, password='StrongPass123!', age_group='middle'):
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.user import User, UserRole

        is_learner = role == UserRole.STUDENT
        with app.app_context():
            user = User(
                full_name=f'{role.value} user',
                email=email,
                password_hash=hash_password(password),
                role=role,
                age_group=age_group if is_learner else None,
            )
            db.session.add(user)
            db.session.commit()
            return user.id

    def login(self, client, *, email, password='StrongPass123!'):
        return client.post('/api/auth/login', json={'login': email, 'password': password})

    def make_useful(self, app, *, title='Алгоритм Дейкстры', age_groups=('middle',), is_published=True, **extra):
        from app.core.db import db
        from app.models.useful import UsefulTask

        with app.app_context():
            task = UsefulTask(
                slug=extra.get('slug') or title.lower().replace(' ', '-'),
                title=title,
                summary=extra.get('summary', ''),
                body=extra.get('body', ''),
                age_groups=list(age_groups),
                topic=extra.get('topic'),
                difficulty=extra.get('difficulty', 'medium'),
                is_published=is_published,
            )
            db.session.add(task)
            db.session.commit()
            return task.id


class UsefulPublicListingTests(UsefulTasksBase):
    def test_unpublished_tasks_hidden_from_listing(self):
        app = self.create_app()
        from app.models.user import UserRole

        self.make_useful(app, title='Public', is_published=True)
        self.make_useful(app, title='Draft', slug='draft-1', is_published=False)
        self.make_user(app, role=UserRole.STUDENT, email='stu@example.com')

        with app.test_client() as client:
            self.login(client, email='stu@example.com')
            r = client.get('/api/useful')

        self.assertEqual(r.status_code, 200)
        slugs = [task['slug'] for task in r.get_json()['tasks']]
        self.assertIn('public', slugs)
        self.assertNotIn('draft-1', slugs)

    def test_anonymous_request_is_rejected(self):
        app = self.create_app()
        with app.test_client() as client:
            r = client.get('/api/useful')
        self.assertEqual(r.status_code, 401)

    def test_age_group_filter_applies_to_array_field(self):
        app = self.create_app()
        from app.models.user import UserRole

        self.make_useful(app, title='J-only', slug='j-only', age_groups=('junior',))
        self.make_useful(app, title='M+S', slug='m-s', age_groups=('middle', 'senior'))
        self.make_useful(app, title='No-tag', slug='no-tag', age_groups=())
        self.make_user(app, role=UserRole.STUDENT, email='filt@example.com')

        with app.test_client() as client:
            self.login(client, email='filt@example.com')
            r_junior = client.get('/api/useful?age_group=junior').get_json()
            r_senior = client.get('/api/useful?age_group=senior').get_json()
            r_all = client.get('/api/useful').get_json()

        slugs_junior = {t['slug'] for t in r_junior['tasks']}
        slugs_senior = {t['slug'] for t in r_senior['tasks']}
        slugs_all = {t['slug'] for t in r_all['tasks']}
        self.assertEqual(slugs_junior, {'j-only'})
        self.assertEqual(slugs_senior, {'m-s'})
        self.assertEqual(slugs_all, {'j-only', 'm-s', 'no-tag'})

    def test_difficulty_filter_drops_other_levels(self):
        app = self.create_app()
        from app.models.user import UserRole

        self.make_useful(app, title='Easy', slug='easy', difficulty='easy')
        self.make_useful(app, title='Hard', slug='hard', difficulty='hard')
        self.make_user(app, role=UserRole.STUDENT, email='dif@example.com')

        with app.test_client() as client:
            self.login(client, email='dif@example.com')
            r = client.get('/api/useful?difficulty=hard').get_json()
        slugs = {t['slug'] for t in r['tasks']}
        self.assertEqual(slugs, {'hard'})

    def test_detail_404_for_draft_when_not_admin(self):
        app = self.create_app()
        from app.models.user import UserRole

        self.make_useful(app, title='Draft', slug='secret', is_published=False)
        self.make_user(app, role=UserRole.STUDENT, email='s2@example.com')

        with app.test_client() as client:
            self.login(client, email='s2@example.com')
            r = client.get('/api/useful/secret')
        self.assertEqual(r.status_code, 404)

    def test_detail_includes_body_for_published_task(self):
        app = self.create_app()
        from app.models.user import UserRole

        self.make_useful(app, title='Body', slug='body', body='## Markdown body', is_published=True)
        self.make_user(app, role=UserRole.STUDENT, email='b@example.com')

        with app.test_client() as client:
            self.login(client, email='b@example.com')
            r = client.get('/api/useful/body')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()['task']['body'], '## Markdown body')


class UsefulAdminCrudTests(UsefulTasksBase):
    def test_student_cannot_create(self):
        app = self.create_app()
        from app.models.user import UserRole

        self.make_user(app, role=UserRole.STUDENT, email='s@example.com')
        with app.test_client() as client:
            self.login(client, email='s@example.com')
            r = client.post('/api/useful/admin', json={'title': 'No'})
        self.assertEqual(r.status_code, 403)

    def test_admin_create_then_read_back(self):
        app = self.create_app()
        from app.models.user import UserRole

        self.make_user(app, role=UserRole.ADMIN, email='admin@example.com', age_group=None)
        with app.test_client() as client:
            self.login(client, email='admin@example.com')
            r = client.post(
                '/api/useful/admin',
                json={
                    'title': 'Сортировка пузырьком',
                    'summary': 'Простой перебор',
                    'body': '## Тело',
                    'age_groups': ['junior', 'middle', 'unknown'],
                    'topic': 'algorithms',
                    'difficulty': 'easy',
                    'external_url': 'https://example.com/a',
                    'is_published': True,
                },
            )

        self.assertEqual(r.status_code, 201, r.get_data(as_text=True))
        payload = r.get_json()['task']
        self.assertEqual(payload['title'], 'Сортировка пузырьком')
        self.assertEqual(payload['age_groups'], ['junior', 'middle'])  # 'unknown' dropped
        self.assertEqual(payload['difficulty'], 'easy')
        self.assertTrue(payload['slug'])
        self.assertTrue(payload['is_published'])

    def test_admin_update_changes_publishing(self):
        app = self.create_app()
        from app.models.user import UserRole

        self.make_user(app, role=UserRole.ADMIN, email='ad@example.com', age_group=None)
        task_id = self.make_useful(app, title='Draft1', slug='draft-1', is_published=False)

        with app.test_client() as client:
            self.login(client, email='ad@example.com')
            r = client.patch(f'/api/useful/admin/{task_id}', json={'is_published': True})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.get_json()['task']['is_published'])

    def test_admin_delete_removes_task(self):
        app = self.create_app()
        from app.models.user import UserRole

        self.make_user(app, role=UserRole.ADMIN, email='ad2@example.com', age_group=None)
        task_id = self.make_useful(app, title='Del', slug='del', is_published=True)

        with app.test_client() as client:
            self.login(client, email='ad2@example.com')
            r = client.delete(f'/api/useful/admin/{task_id}')
        self.assertEqual(r.status_code, 200)

        with app.app_context():
            from app.models.useful import UsefulTask

            self.assertIsNone(UsefulTask.query.get(task_id))

    def test_unique_slug_collision_is_resolved(self):
        app = self.create_app()
        from app.models.user import UserRole

        self.make_user(app, role=UserRole.ADMIN, email='ad3@example.com', age_group=None)
        self.make_useful(app, title='Original', slug='original')

        with app.test_client() as client:
            self.login(client, email='ad3@example.com')
            r = client.post('/api/useful/admin', json={'title': 'Original'})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.get_json()['task']['slug'], 'original-1')


if __name__ == '__main__':
    unittest.main()
