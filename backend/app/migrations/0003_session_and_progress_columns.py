from __future__ import annotations

from sqlalchemy import inspect, text

revision = '0003_session_and_progress_columns'
description = 'Add session version and lesson start timestamp columns'


def _timestamp_sql_type(db) -> str:
    return 'TIMESTAMP WITH TIME ZONE' if db.engine.dialect.name == 'postgresql' else 'TIMESTAMP'


def _columns(db, table_name: str) -> set[str]:
    inspector = inspect(db.engine)
    if table_name not in inspector.get_table_names():
        return set()
    return {column['name'] for column in inspector.get_columns(table_name)}


def upgrade(db) -> None:
    if 'started_at' not in _columns(db, 'user_progress'):
        with db.engine.begin() as connection:
            connection.execute(text(f'ALTER TABLE user_progress ADD COLUMN started_at {_timestamp_sql_type(db)}'))

    if 'session_version' not in _columns(db, 'users'):
        with db.engine.begin() as connection:
            connection.execute(text('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0'))
