from __future__ import annotations

from sqlalchemy import inspect

from app.models.support import SupportTicket, SupportTicketMessage, SupportTicketReadState

revision = "0018_support_tickets"
description = "Support tickets with threaded messages and per-user read states"


def upgrade(db) -> None:
    inspector = inspect(db.engine)
    tables = set(inspector.get_table_names())

    if "support_tickets" not in tables:
        SupportTicket.__table__.create(bind=db.engine, checkfirst=True)
        for index in SupportTicket.__table__.indexes:
            index.create(bind=db.engine, checkfirst=True)

    if "support_ticket_messages" not in tables:
        SupportTicketMessage.__table__.create(bind=db.engine, checkfirst=True)
        for index in SupportTicketMessage.__table__.indexes:
            index.create(bind=db.engine, checkfirst=True)

    if "support_ticket_read_states" not in tables:
        SupportTicketReadState.__table__.create(bind=db.engine, checkfirst=True)
        for index in SupportTicketReadState.__table__.indexes:
            index.create(bind=db.engine, checkfirst=True)
