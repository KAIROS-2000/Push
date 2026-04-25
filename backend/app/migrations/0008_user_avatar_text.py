from __future__ import annotations

from sqlalchemy import inspect, text

revision = '0008_user_avatar_text'
description = 'Widen avatar_url from VARCHAR(500) to TEXT'


def _col_type(db, table_name: str, column_name: str) -> str | None:
    inspector = inspect(db.engine)
    for col in inspector.get_columns(table_name):
        if col['name'] == column_name:
            return str(col['type'])
    return None


def upgrade(db) -> None:
    col_type = _col_type(db, 'users', 'avatar_url')
    if col_type is None:
        return
    if 'TEXT' in col_type.upper() and 'VARCHAR' not in col_type.upper():
        return
    with db.engine.begin() as connection:
        if db.engine.dialect.name == 'postgresql':
            connection.execute(text('ALTER TABLE users ALTER COLUMN avatar_url TYPE TEXT'))
        else:
            # SQLite does not enforce VARCHAR length, no-op needed.
            pass
