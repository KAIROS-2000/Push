from __future__ import annotations

from app.models.staff_messaging import StaffDirectMessage, StaffDirectReadState, StaffDirectThread

revision = "0010_staff_direct_messaging"
description = "Add staff direct (admin) 1:1 messaging tables"


def upgrade(db) -> None:
    for table in (
        StaffDirectThread.__table__,
        StaffDirectMessage.__table__,
        StaffDirectReadState.__table__,
    ):
        table.create(bind=db.engine, checkfirst=True)

    for table in (
        StaffDirectThread.__table__,
        StaffDirectMessage.__table__,
        StaffDirectReadState.__table__,
    ):
        for index in table.indexes:
            index.create(bind=db.engine, checkfirst=True)
