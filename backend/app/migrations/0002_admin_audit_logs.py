from __future__ import annotations

from sqlalchemy import inspect

from app.models.user import AdminAuditLog

revision = '0002_admin_audit_logs'
description = 'Ensure admin audit log table exists'


def upgrade(db) -> None:
    inspector = inspect(db.engine)
    if 'admin_audit_logs' not in inspector.get_table_names():
        AdminAuditLog.__table__.create(bind=db.engine, checkfirst=True)
