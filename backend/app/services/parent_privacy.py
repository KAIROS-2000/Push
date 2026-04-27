from __future__ import annotations

from ..core.db import db
from ..models.parent_cabinet import ParentChildLink, ParentSafetySettings


def child_hidden_from_public_catalog(student_id: int) -> bool:
    row = (
        db.session.query(ParentSafetySettings.id)
        .join(
            ParentChildLink,
            (ParentChildLink.parent_user_id == ParentSafetySettings.parent_user_id)
            & (ParentChildLink.child_user_id == ParentSafetySettings.child_user_id),
        )
        .filter(
            ParentChildLink.child_user_id == student_id,
            ParentChildLink.active.is_(True),
            ParentChildLink.revoked_at.is_(None),
            ParentSafetySettings.hide_child_public_profile.is_(True),
        )
        .first()
    )
    return row is not None
