from __future__ import annotations

from sqlalchemy import inspect, text

revision = '0007_teacher_approval_status'
description = 'Track teacher registration approval status'


def _columns(db, table_name: str) -> set[str]:
    inspector = inspect(db.engine)
    if table_name not in inspector.get_table_names():
        return set()
    return {column['name'] for column in inspector.get_columns(table_name)}


def upgrade(db) -> None:
    if 'teacher_approval_status' not in _columns(db, 'users'):
        with db.engine.begin() as connection:
            connection.execute(
                text(
                    "ALTER TABLE users "
                    "ADD COLUMN teacher_approval_status VARCHAR(20) NOT NULL DEFAULT 'approved'"
                )
            )

    with db.engine.begin() as connection:
        connection.execute(
            text(
                'CREATE INDEX IF NOT EXISTS ix_users_teacher_approval_status '
                'ON users (teacher_approval_status)'
            )
        )
