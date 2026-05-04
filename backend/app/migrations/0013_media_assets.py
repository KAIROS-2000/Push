from __future__ import annotations

from sqlalchemy import inspect

from app.models.media import MediaAsset

revision = "0013_media_assets"
description = "Create media_assets table for assignment cover images and similar"


def upgrade(db) -> None:
    inspector = inspect(db.engine)
    if "media_assets" in inspector.get_table_names():
        return
    MediaAsset.__table__.create(bind=db.engine, checkfirst=True)
    for index in MediaAsset.__table__.indexes:
        index.create(bind=db.engine, checkfirst=True)
