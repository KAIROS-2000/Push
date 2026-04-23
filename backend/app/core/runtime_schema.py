from __future__ import annotations

from .migrations import upgrade_database


def ensure_runtime_schema() -> None:
    """Compatibility wrapper for older tests/commands.

    Runtime app startup no longer performs ad-hoc DDL. Use the migration runner
    so schema changes are recorded and deterministic.
    """

    upgrade_database()
