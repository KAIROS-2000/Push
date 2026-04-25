from __future__ import annotations

from app.models.messaging import Conversation, ConversationReadState, Message

revision = '0004_teacher_student_messaging'
description = 'Add class-context teacher-student messaging tables'


def upgrade(db) -> None:
    for table in (
        Conversation.__table__,
        Message.__table__,
        ConversationReadState.__table__,
    ):
        table.create(bind=db.engine, checkfirst=True)

    for table in (
        Conversation.__table__,
        Message.__table__,
        ConversationReadState.__table__,
    ):
        for index in table.indexes:
            index.create(bind=db.engine, checkfirst=True)
