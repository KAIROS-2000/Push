from __future__ import annotations

from sqlalchemy import inspect, text

revision = '0006_user_phone'
description = 'Add unique nullable phone for users (registration and identity)'


def _columns(db, table_name: str) -> set[str]:
    inspector = inspect(db.engine)
    if table_name not in inspector.get_table_names():
        return set()
    return {column['name'] for column in inspector.get_columns(table_name)}


def upgrade(db) -> None:
    if 'phone' in _columns(db, 'users'):
        return
    with db.engine.begin() as connection:
        connection.execute(text('ALTER TABLE users ADD COLUMN phone VARCHAR(20)'))
        if db.engine.dialect.name == 'postgresql':
            connection.execute(
                text(
                    """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone
                ON users (phone)
                WHERE phone IS NOT NULL
                """
                )
            )
        else:
            connection.execute(text('CREATE UNIQUE INDEX uq_users_phone ON users(phone) WHERE phone IS NOT NULL'))
