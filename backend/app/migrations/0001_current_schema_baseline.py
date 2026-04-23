from __future__ import annotations

revision = '0001_current_schema_baseline'
description = 'Create the current application schema for empty databases'


def upgrade(db) -> None:
    # Baseline migration for new environments. Existing databases keep their
    # current tables; later migrations perform additive compatibility changes.
    db.create_all()
