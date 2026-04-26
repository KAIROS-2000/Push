from __future__ import annotations

from sqlalchemy import inspect, text

revision = '0008_teacher_rejection_expiration'
description = 'Add expiration time for rejected teacher registration requests'


def _columns(db, table_name: str) -> set[str]:
    inspector = inspect(db.engine)
    if table_name not in inspector.get_table_names():
        return set()
    return {column['name'] for column in inspector.get_columns(table_name)}


def upgrade(db) -> None:
    if 'teacher_rejection_expires_at' not in _columns(db, 'users'):
        with db.engine.begin() as connection:
            connection.execute(text('ALTER TABLE users ADD COLUMN teacher_rejection_expires_at TIMESTAMP'))

    with db.engine.begin() as connection:
        connection.execute(
            text(
                'CREATE INDEX IF NOT EXISTS ix_users_teacher_rejection_expires_at '
                'ON users (teacher_rejection_expires_at)'
            )
        )
