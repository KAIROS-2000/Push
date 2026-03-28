from __future__ import annotations

from flask import current_app
from sqlalchemy import inspect, text

from .db import db


def _timestamp_sql_type() -> str:
    return 'TIMESTAMP WITH TIME ZONE' if db.engine.dialect.name == 'postgresql' else 'TIMESTAMP'


def ensure_runtime_schema() -> None:
    inspector = inspect(db.engine)
    if 'user_progress' not in inspector.get_table_names():
        return

    progress_columns = {column['name'] for column in inspector.get_columns('user_progress')}
    if 'started_at' in progress_columns:
        return

    with db.engine.begin() as connection:
        connection.execute(text(f'ALTER TABLE user_progress ADD COLUMN started_at {_timestamp_sql_type()}'))

    current_app.logger.info('Added missing user_progress.started_at column.')
