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


class CosmeticsTests(unittest.TestCase):
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

        with patch.dict(os.environ, env, clear=False):
            import app as app_module
            import app.core.config as config_module

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

    def create_student(self, app, *, xp: int = 160):
        from app.core.db import db
        from app.core.security import hash_password
        from app.models.user import User, UserRole

        with app.app_context():
            user = User(
                full_name="Test Student",
                username="student",
                email="student@example.com",
                password_hash=hash_password("StrongPass123!"),
                role=UserRole.STUDENT,
                age_group="middle",
                xp=xp,
                xp_progress=xp,
            )
            db.session.add(user)
            db.session.commit()
            return user.id

    def login(self, client):
        response = client.post("/api/auth/login", json={"login": "student@example.com", "password": "StrongPass123!"})
        self.assertEqual(response.status_code, 200)
        return response

    def test_purchase_and_equip_cosmetics_preserves_lifetime_level(self):
        app = self.create_app()
        self.create_student(app, xp=260)

        with app.test_client() as client:
            self.login(client)

            catalog = client.get("/api/cosmetics").get_json()
            self.assertIn("items", catalog)
            self.assertEqual(catalog["xp"], 260)
            by_key = {item["key"]: item for item in catalog["items"]}
            self.assertTrue(by_key["light"]["owned"])
            self.assertTrue(by_key["женщина1"]["owned"])
            self.assertFalse(by_key["forest"]["owned"])

            purchase_theme = client.post("/api/cosmetics/purchase", json={"item_key": "forest"})
            self.assertEqual(purchase_theme.status_code, 200)
            self.assertEqual(purchase_theme.get_json()["xp"], 160)

            duplicate_theme = client.post("/api/cosmetics/purchase", json={"item_key": "forest"})
            self.assertEqual(duplicate_theme.status_code, 200)
            self.assertEqual(duplicate_theme.get_json()["xp"], 160)

            equip_theme = client.post("/api/cosmetics/equip", json={"item_key": "forest", "slot": "theme"})
            self.assertEqual(equip_theme.status_code, 200)
            user = equip_theme.get_json()["user"]
            self.assertEqual(user["theme"], "forest")
            self.assertEqual(user["xp"], 160)
            self.assertGreater(user["level"], 1)

            equip_unowned_frame = client.post("/api/cosmetics/equip", json={"item_key": "деревянная", "slot": "frame"})
            self.assertEqual(equip_unowned_frame.status_code, 403)

            purchase_frame = client.post("/api/cosmetics/purchase", json={"item_key": "деревянная"})
            self.assertEqual(purchase_frame.status_code, 200)
            self.assertEqual(purchase_frame.get_json()["xp"], 125)

            equip_frame = client.post("/api/cosmetics/equip", json={"item_key": "деревянная", "slot": "frame"})
            self.assertEqual(equip_frame.status_code, 200)
            self.assertEqual(equip_frame.get_json()["user"]["frame_id"], "деревянная")


if __name__ == "__main__":
    unittest.main()
