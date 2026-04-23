from __future__ import annotations

import importlib
import pkgutil
from dataclasses import dataclass

from sqlalchemy import inspect, text

from .db import db


@dataclass(frozen=True)
class Migration:
    revision: str
    description: str
    module_name: str


def _ensure_models_loaded() -> None:
    from .. import models  # noqa: F401


def _migration_modules() -> list[Migration]:
    from .. import migrations

    rows: list[Migration] = []
    for module_info in pkgutil.iter_modules(migrations.__path__):
        if not module_info.name.startswith(('m', 'v')) and not module_info.name[0].isdigit():
            continue
        module = importlib.import_module(f'{migrations.__name__}.{module_info.name}')
        revision = getattr(module, 'revision', module_info.name)
        description = getattr(module, 'description', '')
        rows.append(Migration(revision=revision, description=description, module_name=module.__name__))
    return sorted(rows, key=lambda item: item.revision)


def _ensure_migration_table() -> None:
    with db.engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    revision VARCHAR(120) PRIMARY KEY,
                    description VARCHAR(255) NOT NULL DEFAULT '',
                    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        )


def _applied_revisions() -> set[str]:
    inspector = inspect(db.engine)
    if 'schema_migrations' not in inspector.get_table_names():
        return set()
    rows = db.session.execute(text('SELECT revision FROM schema_migrations')).all()
    return {str(row[0]) for row in rows}


def _record_migration(migration: Migration) -> None:
    db.session.execute(
        text(
            """
            INSERT INTO schema_migrations (revision, description)
            VALUES (:revision, :description)
            """
        ),
        {'revision': migration.revision, 'description': migration.description[:255]},
    )
    db.session.commit()


def upgrade_database() -> list[str]:
    """Apply all pending schema migrations.

    Returns the revisions applied in this call so CLI/CI smoke checks can assert
    deterministic migration execution without parsing logs.
    """

    _ensure_models_loaded()
    _ensure_migration_table()
    applied = _applied_revisions()
    applied_now: list[str] = []

    for migration in _migration_modules():
        if migration.revision in applied:
            continue
        module = importlib.import_module(migration.module_name)
        module.upgrade(db)
        _record_migration(migration)
        applied.add(migration.revision)
        applied_now.append(migration.revision)

    return applied_now
