from __future__ import annotations

from sqlalchemy import inspect, text

from ..models.parent_cabinet import (
    ParentChildLink,
    ParentConsentSettings,
    ParentLinkCode,
    ParentNotification,
    ParentSafetySettings,
    ParentTeacherMessage,
    ParentTeacherReadState,
    ParentTeacherThread,
)

revision = "0009_parent_cabinet"
description = "Parent role cabinet: drop legacy parent_invites; add secure linking and parent-teacher threads"


def _add_parent_enum_postgres(db) -> None:
    if db.engine.dialect.name != "postgresql":
        return
    with db.engine.begin() as connection:
        try:
            connection.execute(text("ALTER TYPE userrole ADD VALUE 'parent'"))
        except Exception:
            # Label may already exist, or the deployment stores role as plain VARCHAR.
            pass


def upgrade(db) -> None:
    _add_parent_enum_postgres(db)

    inspector = inspect(db.engine)
    if "parent_invites" in inspector.get_table_names():
        with db.engine.begin() as connection:
            connection.execute(text("DROP TABLE IF EXISTS parent_invites"))

    for table in (
        ParentChildLink.__table__,
        ParentLinkCode.__table__,
        ParentSafetySettings.__table__,
        ParentConsentSettings.__table__,
        ParentNotification.__table__,
        ParentTeacherThread.__table__,
        ParentTeacherMessage.__table__,
        ParentTeacherReadState.__table__,
    ):
        table.create(bind=db.engine, checkfirst=True)
        for index in table.indexes:
            index.create(bind=db.engine, checkfirst=True)
