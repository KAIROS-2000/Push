from __future__ import annotations

from sqlalchemy import inspect, text

revision = "0014_assignment_image"
description = "Add Assignment.image_id FK to media_assets"


def upgrade(db) -> None:
    inspector = inspect(db.engine)
    columns = {column["name"] for column in inspector.get_columns("assignments")}
    if "image_id" in columns:
        return

    dialect = db.engine.dialect.name
    with db.engine.begin() as conn:
        if dialect == "sqlite":
            # SQLite cannot ALTER TABLE ADD COLUMN with FK constraint via ORM-level reflection
            # without table rebuild; the FK is enforced via ORM relationship for SQLite tests.
            conn.execute(text("ALTER TABLE assignments ADD COLUMN image_id INTEGER"))
        else:
            conn.execute(
                text(
                    "ALTER TABLE assignments ADD COLUMN image_id INTEGER "
                    "REFERENCES media_assets(id) ON DELETE SET NULL"
                )
            )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_assignments_image_id ON assignments (image_id)")
        )
