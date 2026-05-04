from __future__ import annotations

from sqlalchemy import inspect, text

revision = "0016_drop_username"
description = "Make users.username nullable then drop it — email is now the sole login identifier"


def upgrade(db) -> None:
    inspector = inspect(db.engine)
    columns = {col["name"] for col in inspector.get_columns("users")}
    if "username" not in columns:
        return

    dialect = db.engine.dialect.name

    if dialect == "postgresql":
        with db.engine.begin() as conn:
            # Drop unique constraint if it exists
            constraints = inspector.get_unique_constraints("users")
            for uc in constraints:
                if "username" in uc["column_names"]:
                    conn.execute(text(f'ALTER TABLE users DROP CONSTRAINT IF EXISTS "{uc["name"]}"'))
            # Drop index if it exists
            indexes = inspector.get_indexes("users")
            for idx in indexes:
                if "username" in idx["column_names"]:
                    conn.execute(text(f'DROP INDEX IF EXISTS "{idx["name"]}"'))
            conn.execute(text("ALTER TABLE users DROP COLUMN username"))
    elif dialect == "sqlite":
        # SQLite does not support DROP COLUMN before 3.35; recreate table without username
        with db.engine.begin() as conn:
            conn.execute(text(
                "CREATE TABLE users_new AS SELECT "
                "id, full_name, email, phone, password_hash, role, age_group, "
                "xp, xp_progress, avatar_id, frame_id, streak, theme, is_active, "
                "teacher_approval_status, teacher_rejection_expires_at, "
                "session_version, last_login_at, created_at "
                "FROM users"
            ))
            conn.execute(text("DROP TABLE users"))
            conn.execute(text("ALTER TABLE users_new RENAME TO users"))
    else:
        with db.engine.begin() as conn:
            conn.execute(text("ALTER TABLE users DROP COLUMN username"))
