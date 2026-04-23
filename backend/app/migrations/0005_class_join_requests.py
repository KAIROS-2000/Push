from __future__ import annotations

from app.models.learning import ClassJoinRequest

revision = '0005_class_join_requests'
description = 'Add teacher approval requests for class joins'


def upgrade(db) -> None:
    ClassJoinRequest.__table__.create(bind=db.engine, checkfirst=True)
    for index in ClassJoinRequest.__table__.indexes:
        index.create(bind=db.engine, checkfirst=True)
