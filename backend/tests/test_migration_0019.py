"""Regression guard for migration 0019_fk_ondelete_cascade.

Audit findings C-1, C-2, C-3 (May 2026) showed that hand-written FK-rule
tuples in the migration silently drifted from real model table/column names,
causing the migration to either crash on PostgreSQL or to silently skip
entire tables. These tests assert that every entry in ``_FK_RULES`` points
at a column that actually exists on a real model, and that the referenced
parent table exists too.

On PostgreSQL it also runs ``upgrade_database()`` and queries
``information_schema.referential_constraints`` to assert that every FK in
``_FK_RULES`` has ``delete_rule != 'NO ACTION'`` after the migration.

The test uses SQLite by default (no PG required) — in that mode it falls
back to static, model-level assertions. Set ``DATABASE_URL`` to a
``postgresql+psycopg://`` URI to enable the live PG assertions.
"""

from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import inspect, text

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


class Migration0019FKRulesTests(unittest.TestCase):
    """Static validation of the FK-rule table — no DB required."""

    def test_fk_rules_reference_real_models(self) -> None:
        """Every (table, column, ref_table) tuple must match a real model."""
        from app import models  # noqa: F401  — ensure model classes are loaded
        from app.core.db import db as _db  # noqa: F401  — ensure metadata is populated
        from app.migrations import _0019_module as _m

        # Build a lookup of table_name -> set(column_names) from SQLAlchemy
        # metadata, which is fed by every loaded model class.
        from app.core.db import db

        tables: dict[str, set[str]] = {}
        for tbl in db.metadata.tables.values():
            tables[tbl.name] = {col.name for col in tbl.columns}

        seen_combos: set[tuple[str, str]] = set()
        for table, column, ref_table, action in _m._FK_RULES:
            with self.subTest(table=table, column=column, ref_table=ref_table):
                self.assertIn(
                    table,
                    tables,
                    f"_FK_RULES references unknown table '{table}'. "
                    "Did you mean an existing __tablename__?",
                )
                self.assertIn(
                    column,
                    tables[table],
                    f"_FK_RULES references unknown column '{column}' on table '{table}'.",
                )
                self.assertIn(
                    ref_table,
                    tables,
                    f"_FK_RULES references unknown ref_table '{ref_table}'.",
                )
                self.assertIn(
                    action,
                    ("CASCADE", "SET NULL"),
                    f"_FK_RULES action must be CASCADE or SET NULL, got {action!r}.",
                )
                # Duplicate (table, column) combos would create overlapping
                # constraints and a confusing migration.
                self.assertNotIn(
                    (table, column),
                    seen_combos,
                    f"Duplicate FK rule for ({table}.{column}).",
                )
                seen_combos.add((table, column))

    def test_fk_rules_set_null_targets_nullable_columns(self) -> None:
        """SET NULL only makes sense on nullable columns."""
        from app import models  # noqa: F401
        from app.core.db import db
        from app.migrations import _0019_module as _m

        for table, column, _ref_table, action in _m._FK_RULES:
            if action != "SET NULL":
                continue
            tbl = db.metadata.tables.get(table)
            if tbl is None:
                continue
            col = tbl.columns.get(column)
            if col is None:
                continue
            with self.subTest(table=table, column=column):
                self.assertTrue(
                    col.nullable,
                    f"{table}.{column} is NOT NULL but _FK_RULES uses SET NULL.",
                )


class Migration0019PostgresLiveTests(unittest.TestCase):
    """Live PostgreSQL assertion — skipped when DATABASE_URL is sqlite."""

    @classmethod
    def setUpClass(cls) -> None:
        database_url = os.environ.get("DATABASE_URL", "")
        if not database_url.startswith("postgresql"):
            raise unittest.SkipTest(
                "DATABASE_URL is not a PostgreSQL URL; live FK CASCADE assertion skipped."
            )

    def test_upgrade_database_applies_cascade_to_every_rule(self) -> None:
        from app.core.db import db
        from app.core.migrations import upgrade_database
        from app.migrations import _0019_module as _m

        env = {
            "APP_ENV": "development",
            "SECRET_KEY": "UnitTestSecretKey123!UnitTestSecretKey123!",
            "CLIENT_URL": "http://localhost:3000",
            "ENABLE_DEMO_DATA": "false",
            "SUPERADMIN_BOOTSTRAP": "false",
            "SESSION_COOKIE_SECURE": "false",
            "METRICS_DEBUG": "false",
        }
        with patch.dict(os.environ, env, clear=False):
            import app.core.config as config_module
            import app as app_module

            importlib.reload(config_module)
            importlib.reload(app_module)
            app = app_module.create_app()
            app.config.update(TESTING=True)

            with app.app_context():
                applied = upgrade_database()
                self.assertIn("0019_fk_ondelete_cascade", applied + self._existing_revisions())

                for table, column, _ref_table, action in _m._FK_RULES:
                    expected = "CASCADE" if action == "CASCADE" else "SET NULL"
                    with self.subTest(table=table, column=column):
                        rule = self._query_delete_rule(table, column)
                        self.assertIsNotNone(
                            rule,
                            f"No FK constraint found for {table}.{column}.",
                        )
                        self.assertEqual(
                            rule,
                            expected,
                            f"{table}.{column} has delete_rule={rule}, expected {expected}.",
                        )

    @staticmethod
    def _existing_revisions() -> list[str]:
        from app.core.db import db

        rows = db.session.execute(
            text("SELECT revision FROM schema_migrations")
        ).all()
        return [str(r[0]) for r in rows]

    @staticmethod
    def _query_delete_rule(table: str, column: str) -> str | None:
        from app.core.db import db

        row = db.session.execute(
            text(
                """
                SELECT rc.delete_rule
                FROM information_schema.referential_constraints rc
                JOIN information_schema.key_column_usage kcu
                  ON rc.constraint_name = kcu.constraint_name
                 AND rc.constraint_schema = kcu.constraint_schema
                WHERE kcu.table_name = :table
                  AND kcu.column_name = :column
                LIMIT 1
                """
            ),
            {"table": table, "column": column},
        ).first()
        return row[0] if row else None


# Convenience: alias the migration module so tests above can import it as
# `app.migrations._0019_module`. We can't simply ``from app.migrations import
# 0019_fk_ondelete_cascade`` because Python identifiers can't start with a
# digit. The runtime migration loader uses ``importlib.import_module`` and
# doesn't care about identifier rules; here we replicate that.
def _load_0019_module():
    from app.migrations import (
        __path__ as _migrations_path,  # noqa: F401
    )
    import importlib

    return importlib.import_module("app.migrations.0019_fk_ondelete_cascade")


# Re-export under a Python-legal name so the assertions above can ``from
# app.migrations import _0019_module``.
import app.migrations as _migrations_pkg  # noqa: E402

_migrations_pkg._0019_module = _load_0019_module()


if __name__ == "__main__":
    unittest.main()
