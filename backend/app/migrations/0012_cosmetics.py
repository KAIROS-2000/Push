from __future__ import annotations

from sqlalchemy import inspect, text

from app.models.cosmetics import UserOwnedCosmetic

revision = "0012_cosmetics"
description = "Add profile cosmetics inventory and equipped avatar/frame fields"


def upgrade(db) -> None:
    inspector = inspect(db.engine)
    user_columns = {column["name"] for column in inspector.get_columns("users")}

    with db.engine.begin() as conn:
        if "xp_progress" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN xp_progress INTEGER NOT NULL DEFAULT 0"))
            conn.execute(text("UPDATE users SET xp_progress = xp WHERE xp_progress = 0"))

        if "avatar_id" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN avatar_id VARCHAR(80)"))

        if "frame_id" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN frame_id VARCHAR(80)"))

    UserOwnedCosmetic.__table__.create(bind=db.engine, checkfirst=True)
    for index in UserOwnedCosmetic.__table__.indexes:
        index.create(bind=db.engine, checkfirst=True)
