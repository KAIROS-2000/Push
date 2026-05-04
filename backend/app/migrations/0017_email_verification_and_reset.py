from __future__ import annotations

from sqlalchemy import inspect, text

from app.models.user import EmailToken

revision = "0017_email_verification_and_reset"
description = (
    "Add email_verified/email_verified_at/password_changed_at to users and "
    "create email_tokens table for verification and password reset flows"
)


def _columns(db, table_name: str) -> set[str]:
    inspector = inspect(db.engine)
    if table_name not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade(db) -> None:
    inspector = inspect(db.engine)
    dialect = db.engine.dialect.name

    user_columns = _columns(db, "users")
    statements: list[str] = []
    if "email_verified" not in user_columns:
        # Existing users (created before this feature shipped) are grandfathered
        # in as verified — otherwise applying the migration would lock everyone
        # out at the next login. New self-signups go through /auth/register,
        # which explicitly stamps email_verified=False on the new row.
        if dialect == "postgresql":
            statements.append(
                "ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT TRUE"
            )
        else:
            statements.append(
                "ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT 1"
            )
    if "email_verified_at" not in user_columns:
        statements.append(
            "ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMP NULL"
        )
    if "password_changed_at" not in user_columns:
        statements.append(
            "ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMP NULL"
        )

    if statements:
        with db.engine.begin() as conn:
            for stmt in statements:
                conn.execute(text(stmt))

    if "email_tokens" not in inspector.get_table_names():
        EmailToken.__table__.create(bind=db.engine, checkfirst=True)
        for index in EmailToken.__table__.indexes:
            index.create(bind=db.engine, checkfirst=True)
