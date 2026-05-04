from __future__ import annotations

from sqlalchemy import inspect

from app.models.useful import UsefulTask

revision = "0015_useful_tasks"
description = "Create useful_tasks table for admin-curated public practice recommendations"


def upgrade(db) -> None:
    inspector = inspect(db.engine)
    if "useful_tasks" in inspector.get_table_names():
        return
    UsefulTask.__table__.create(bind=db.engine, checkfirst=True)
    for index in UsefulTask.__table__.indexes:
        index.create(bind=db.engine, checkfirst=True)
