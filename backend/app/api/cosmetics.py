from __future__ import annotations

from flask import Blueprint, request

from ..core.db import db
from ..core.security import auth_required
from ..models.cosmetics import CATALOG, CATALOG_BY_KEY, UserOwnedCosmetic
from ..models.user import User, UserRole

cosmetics_bp = Blueprint("cosmetics", __name__)

_FREE_TYPES = {"avatar", "theme"}


def _owned_keys(user_id: int) -> set[str]:
    rows = db.session.query(UserOwnedCosmetic.item_key).filter_by(user_id=user_id).all()
    return {r.item_key for r in rows}


@cosmetics_bp.get("/cosmetics")
@auth_required()
def list_cosmetics(user: User):
    owned = _owned_keys(user.id)
    # Themes light and dark are always owned
    owned.update({"light", "dark"})
    items = []
    for item in CATALOG:
        is_owned = item["key"] in owned or item["price"] == 0
        items.append({**item, "owned": is_owned})
    return {"items": items, "xp": user.xp}


@cosmetics_bp.post("/cosmetics/purchase")
@auth_required()
def purchase_cosmetic(user: User):
    body = request.get_json(silent=True) or {}
    item_key = str(body.get("item_key", "")).strip()

    item = CATALOG_BY_KEY.get(item_key)
    if not item:
        return {"message": "Предмет не найден."}, 404

    if item["price"] == 0:
        return {"message": "Этот предмет бесплатный.", "xp": user.xp}, 200

    already_owned = db.session.query(UserOwnedCosmetic).filter_by(
        user_id=user.id, item_key=item_key
    ).first()
    if already_owned:
        return {"message": "Предмет уже приобретён.", "xp": user.xp}, 200

    if not user.spend_xp(item["price"]):
        return {"message": f"Недостаточно XP. Нужно {item['price']}, есть {user.xp}.", "xp": user.xp}, 402

    owned_record = UserOwnedCosmetic(
        user_id=user.id,
        item_key=item_key,
        item_type=item["type"],
    )
    db.session.add(owned_record)
    db.session.commit()

    return {"message": f"Предмет «{item['name']}» куплен!", "xp": user.xp}, 200


@cosmetics_bp.post("/cosmetics/equip")
@auth_required()
def equip_cosmetic(user: User):
    body = request.get_json(silent=True) or {}
    item_key = str(body.get("item_key", "")).strip()
    slot = str(body.get("slot", "")).strip()  # avatar | frame | theme

    if slot not in ("avatar", "frame", "theme"):
        return {"message": "Неверный слот."}, 400

    if item_key == "":
        # Unequip
        if slot == "avatar":
            user.avatar_id = None
        elif slot == "frame":
            user.frame_id = None
        elif slot == "theme":
            user.theme = "light"
        db.session.commit()
        return {"user": user.to_dict()}, 200

    item = CATALOG_BY_KEY.get(item_key)
    if not item or item["type"] != slot:
        return {"message": "Предмет не найден или неверный тип."}, 404

    # Check ownership (free items are always accessible)
    if item["price"] > 0 and item_key not in {"light", "dark"}:
        owned = db.session.query(UserOwnedCosmetic).filter_by(
            user_id=user.id, item_key=item_key
        ).first()
        if not owned:
            return {"message": "Предмет не приобретён."}, 403

    if slot == "avatar":
        user.avatar_id = item_key
    elif slot == "frame":
        user.frame_id = item_key
    elif slot == "theme":
        user.theme = item_key

    db.session.commit()
    return {"user": user.to_dict()}, 200
