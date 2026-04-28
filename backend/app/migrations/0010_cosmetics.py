from __future__ import annotations

from sqlalchemy import inspect, text

revision = "0010_cosmetics"
description = "Cosmetics shop: xp_progress ghost field, avatar_id, frame_id, user_owned_cosmetics table"


def upgrade(db) -> None:
    inspector = inspect(db.engine)
    columns = {col["name"] for col in inspector.get_columns("users")}

    with db.engine.begin() as conn:
        if "xp_progress" not in columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN xp_progress INTEGER NOT NULL DEFAULT 0"))
            # Seed xp_progress = xp for all existing users
            conn.execute(text("UPDATE users SET xp_progress = xp WHERE xp_progress = 0"))

        if "avatar_id" not in columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN avatar_id VARCHAR(80)"))

        if "frame_id" not in columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN frame_id VARCHAR(80)"))

    tables = inspector.get_table_names()
    if "user_owned_cosmetics" not in tables:
        with db.engine.begin() as conn:
            conn.execute(text("""
                CREATE TABLE user_owned_cosmetics (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    item_key VARCHAR(80) NOT NULL,
                    item_type VARCHAR(20) NOT NULL,
                    purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, item_key)
                )
            """))
            conn.execute(text(
                "CREATE INDEX idx_uoc_user_id ON user_owned_cosmetics(user_id)"
            ))
