from __future__ import annotations

from sqlalchemy import inspect, text

revision = '0007_user_avatar'
description = 'Add avatar_url column to users'


def _columns(db, table_name: str) -> set[str]:
    inspector = inspect(db.engine)
    if table_name not in inspector.get_table_names():
        return set()
    return {column['name'] for column in inspector.get_columns(table_name)}


def upgrade(db) -> None:
    if 'avatar_url' in _columns(db, 'users'):
        return
    with db.engine.begin() as connection:
        connection.execute(text('ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500)'))
