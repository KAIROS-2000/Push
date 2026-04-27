from __future__ import annotations

from sqlalchemy import inspect

from app.models.user import SiteActivityLog

revision = '0011_site_activity_logs'
description = 'Site-wide API activity log table'


def upgrade(db) -> None:
    inspector = inspect(db.engine)
    if 'site_activity_logs' not in inspector.get_table_names():
        SiteActivityLog.__table__.create(bind=db.engine, checkfirst=True)
