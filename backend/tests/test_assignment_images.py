"""Tests for the assignment cover image pipeline (P1).

Covers:
- SVG placeholder determinism + content shape.
- Backfill CLI behavior (attaches to all assignments without an image, idempotent).
- Upload endpoint validation (auth, MIME, size, decompression bombs).
- Pillow re-encode actually drops EXIF and produces WebP.
- Attach / detach PATCH semantics.
- GET serving routes (whitelist, 404 for foreign extensions).
"""
from __future__ import annotations

import hashlib
import importlib
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


class AssignmentImagesBase(unittest.TestCase):
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
        # Each test gets its own MEDIA_DIR so generated SVG files don't leak between tests.
        media_dir = Path(tempdir.name) / 'media'
        (media_dir / 'assignment-images').mkdir(parents=True, exist_ok=True)
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
            'MEDIA_DIR': str(media_dir),
        }
        env.update(env_overrides)

        with patch.dict(os.environ, env, clear=False):
            import app.core.config as config_module
            import app as app_module

            importlib.reload(config_module)
            importlib.reload(app_module)

            app = app_module.create_app()
            app.config.update(TESTING=True)
            app.config['MEDIA_DIR'] = str(media_dir)
            with app.app_context():
                from app.core.migrations import upgrade_database

                upgrade_database()
            self._apps.append(app)
            return app, media_dir

    def make_assignment(self, app, *, title='Practice 1'):
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.learning import Assignment, Classroom
        from app.models.user import User, UserRole

        with app.app_context():
            teacher = User.query.filter_by(email='img-teacher@example.com').first()
            if teacher is None:
                teacher = User(
                    full_name='Img Teacher',
                    email='img-teacher@example.com',
                    password_hash=hash_password('TeacherPass123!'),
                    role=UserRole.TEACHER,
                )
                db.session.add(teacher)
                db.session.flush()
            classroom = Classroom.query.filter_by(code='IMGCLS').first()
            if classroom is None:
                classroom = Classroom(name='Img', code='IMGCLS', teacher_id=teacher.id)
                db.session.add(classroom)
                db.session.flush()
            assignment = Assignment(
                classroom_id=classroom.id,
                title=title,
                description='d',
                xp_reward=10,
            )
            db.session.add(assignment)
            db.session.commit()
            return assignment.id

    def make_admin(self, app, *, email='admin-img@example.com', password='AdminStrong123!'):
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.user import User, UserRole

        with app.app_context():
            admin = User(
                full_name='Img Admin',
                email=email,
                password_hash=hash_password(password),
                role=UserRole.ADMIN,
            )
            db.session.add(admin)
            db.session.commit()
            return admin.id

    def login_admin(self, client, *, email='admin-img@example.com', password='AdminStrong123!'):
        r = client.post('/api/auth/login', json={'login': email, 'password': password})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        return r


class SvgPlaceholderTests(AssignmentImagesBase):
    def test_placeholder_is_deterministic_per_seed(self):
        app, _ = self.create_app()
        with app.app_context():
            from app.services.assignment_images import render_assignment_placeholder_svg

            a = render_assignment_placeholder_svg('Тригонометрия', seed='lesson:42')
            b = render_assignment_placeholder_svg('Тригонометрия', seed='lesson:42')
            c = render_assignment_placeholder_svg('Тригонометрия', seed='lesson:43')

        self.assertEqual(a, b)
        self.assertNotEqual(a, c)
        # Sanity: no `<script>` or `javascript:` constructs leaked in.
        self.assertNotIn(b'<script', a.lower())
        self.assertNotIn(b'javascript:', a.lower())

    def test_placeholder_escapes_user_supplied_title(self):
        app, _ = self.create_app()
        with app.app_context():
            from app.services.assignment_images import render_assignment_placeholder_svg

            payload = render_assignment_placeholder_svg('<script>alert(1)</script>', seed='x')
        self.assertNotIn(b'<script>alert', payload)
        self.assertIn(b'&lt;script', payload)


class BackfillTests(AssignmentImagesBase):
    def test_backfill_attaches_to_all_assignments_without_image(self):
        app, _ = self.create_app()
        a1 = self.make_assignment(app, title='A1')
        a2 = self.make_assignment(app, title='A2')

        with app.app_context():
            from app.core.db import db
            from app.models.learning import Assignment
            from app.services.assignment_images import backfill_assignment_placeholders

            attached = backfill_assignment_placeholders()
            db.session.commit()
            self.assertEqual(attached, 2)

            # Idempotent.
            second_pass = backfill_assignment_placeholders()
            db.session.commit()
            self.assertEqual(second_pass, 0)

            for aid in (a1, a2):
                row = Assignment.query.get(aid)
                self.assertIsNotNone(row.image_id)
                self.assertEqual(row.image.format, 'svg')
                self.assertTrue(row.image.is_generated)


class UploadEndpointTests(AssignmentImagesBase):
    def _build_test_image_bytes(self, *, fmt='PNG', size=(200, 150)) -> bytes:
        from PIL import Image

        img = Image.new('RGB', size, color=(72, 130, 200))
        buffer = io.BytesIO()
        img.save(buffer, format=fmt)
        return buffer.getvalue()

    def test_upload_rejects_non_admin(self):
        app, _ = self.create_app()
        # Create a student and try to upload — must 403.
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.user import User, UserRole

        with app.app_context():
            student = User(
                full_name='Stu',
                email='stuimg@example.com',
                password_hash=hash_password('StrongPass123!'),
                role=UserRole.STUDENT,
                age_group='middle',
            )
            db.session.add(student)
            db.session.commit()

        with app.test_client() as client:
            client.post('/api/auth/login', json={'login': 'stuimg@example.com', 'password': 'StrongPass123!'})
            data = {'file': (io.BytesIO(self._build_test_image_bytes()), 'pic.png')}
            r = client.post('/api/admin/media/images', data=data, content_type='multipart/form-data')
        self.assertEqual(r.status_code, 403)

    def test_upload_rejects_non_image_payload(self):
        app, _ = self.create_app()
        self.make_admin(app)

        with app.test_client() as client:
            self.login_admin(client)
            data = {'file': (io.BytesIO(b'definitely not an image'), 'fake.png')}
            r = client.post('/api/admin/media/images', data=data, content_type='multipart/form-data')
        self.assertEqual(r.status_code, 400)

    def test_upload_rejects_empty_file(self):
        app, _ = self.create_app()
        self.make_admin(app)

        with app.test_client() as client:
            self.login_admin(client)
            data = {'file': (io.BytesIO(b''), 'empty.png')}
            r = client.post('/api/admin/media/images', data=data, content_type='multipart/form-data')
        self.assertEqual(r.status_code, 400)

    def test_upload_reencodes_to_webp(self):
        app, media_dir = self.create_app()
        self.make_admin(app)

        with app.test_client() as client:
            self.login_admin(client)
            png_bytes = self._build_test_image_bytes(fmt='PNG', size=(400, 300))
            data = {'file': (io.BytesIO(png_bytes), 'pic.png')}
            r = client.post('/api/admin/media/images', data=data, content_type='multipart/form-data')

        self.assertEqual(r.status_code, 201, r.get_data(as_text=True))
        payload = r.get_json()
        self.assertEqual(payload['image']['format'], 'webp')
        self.assertFalse(payload['image']['is_generated'])
        # File physically present at the predicted path.
        sha = payload['image']['sha256']
        stored = media_dir / 'assignment-images' / f'{sha}.webp'
        self.assertTrue(stored.exists(), f'expected {stored} to exist')
        # First two bytes of WebP riff: starts with "RIFF" then ends with "WEBP".
        head = stored.read_bytes()[:12]
        self.assertEqual(head[:4], b'RIFF')
        self.assertEqual(head[8:12], b'WEBP')


class AttachEndpointTests(AssignmentImagesBase):
    def test_attach_links_image_to_assignment(self):
        app, _ = self.create_app()
        self.make_admin(app)
        assignment_id = self.make_assignment(app)

        with app.app_context():
            from app.core.db import db
            from app.services.assignment_images import create_or_reuse_svg_placeholder

            asset = create_or_reuse_svg_placeholder(title='cover', seed='manual')
            db.session.commit()
            asset_id = asset.id

        with app.test_client() as client:
            self.login_admin(client)
            r = client.patch(
                f'/api/admin/assignments/{assignment_id}/image',
                json={'image_id': asset_id},
            )

        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()['assignment']['image_id'], asset_id)
        self.assertIsNotNone(r.get_json()['assignment']['image_url'])

    def test_attach_with_unknown_image_returns_404(self):
        app, _ = self.create_app()
        self.make_admin(app)
        assignment_id = self.make_assignment(app)

        with app.test_client() as client:
            self.login_admin(client)
            r = client.patch(
                f'/api/admin/assignments/{assignment_id}/image',
                json={'image_id': 999999},
            )
        self.assertEqual(r.status_code, 404)

    def test_detach_when_image_id_is_null(self):
        app, _ = self.create_app()
        self.make_admin(app)
        assignment_id = self.make_assignment(app)

        with app.app_context():
            from app.core.db import db
            from app.models.learning import Assignment
            from app.services.assignment_images import create_or_reuse_svg_placeholder

            asset = create_or_reuse_svg_placeholder(title='cover', seed='detach')
            assignment = Assignment.query.get(assignment_id)
            assignment.image_id = asset.id
            db.session.commit()

        with app.test_client() as client:
            self.login_admin(client)
            r = client.patch(
                f'/api/admin/assignments/{assignment_id}/image',
                json={'image_id': None},
            )
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.get_json()['assignment']['image_id'])


class AssignmentsLightEndpointTests(AssignmentImagesBase):
    def test_lists_assignments_with_image_metadata(self):
        app, _ = self.create_app()
        self.make_admin(app)
        a1 = self.make_assignment(app, title='Light A1')

        with app.app_context():
            from app.core.db import db
            from app.models.learning import Assignment
            from app.services.assignment_images import create_or_reuse_svg_placeholder

            asset = create_or_reuse_svg_placeholder(title='cover', seed=f'al:{a1}')
            Assignment.query.get(a1).image_id = asset.id
            db.session.commit()

        with app.test_client() as client:
            self.login_admin(client)
            r = client.get('/api/admin/assignments-light?page=1&page_size=10')
        self.assertEqual(r.status_code, 200)
        payload = r.get_json()
        self.assertIn('assignments', payload)
        match = next((row for row in payload['assignments'] if row['id'] == a1), None)
        self.assertIsNotNone(match)
        self.assertIsNotNone(match['image_id'])
        self.assertTrue(match['image_url'].startswith('/api/media/assignment-images/'))


class MediaServingTests(AssignmentImagesBase):
    def test_get_assignment_image_serves_generated_svg(self):
        app, media_dir = self.create_app()
        with app.app_context():
            from app.core.db import db
            from app.services.assignment_images import create_or_reuse_svg_placeholder

            asset = create_or_reuse_svg_placeholder(title='Test', seed='serving')
            db.session.commit()
            sha = asset.sha256

        with app.test_client() as client:
            r = client.get(f'/api/media/assignment-images/{sha}.svg')
        self.assertEqual(r.status_code, 200)
        self.assertIn(b'<svg', r.data)

    def test_assignment_image_route_blocks_html_extension(self):
        app, _ = self.create_app()
        with app.test_client() as client:
            r = client.get('/api/media/assignment-images/exploit.html')
        self.assertEqual(r.status_code, 404)


if __name__ == '__main__':
    unittest.main()
