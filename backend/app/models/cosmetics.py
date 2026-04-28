from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import UniqueConstraint

from ..core.db import db


class UserOwnedCosmetic(db.Model):
    __tablename__ = "user_owned_cosmetics"
    __table_args__ = (UniqueConstraint("user_id", "item_key", name="uq_user_owned_cosmetic_user_item"),)

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    item_key = db.Column(db.String(80), nullable=False)
    item_type = db.Column(db.String(20), nullable=False)
    purchased_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)

    user = db.relationship("User", backref=db.backref("owned_cosmetics", cascade="all, delete-orphan"))


# ---------------------------------------------------------------------------
# Cosmetics catalog (hard-coded, no DB table needed)
# ---------------------------------------------------------------------------

AVATARS: list[dict[str, Any]] = [
    {"key": "женщина1", "name": "Женщина 1", "type": "avatar", "price": 0, "file": "женщина1.png"},
    {"key": "женщина2", "name": "Женщина 2", "type": "avatar", "price": 0, "file": "женщина2.png"},
    {"key": "женщина3", "name": "Женщина 3", "type": "avatar", "price": 0, "file": "женщина3.png"},
    {"key": "женщина4", "name": "Женщина 4", "type": "avatar", "price": 0, "file": "женщина4.png"},
    {"key": "женщина5", "name": "Женщина 5", "type": "avatar", "price": 0, "file": "женщина5.png"},
    {"key": "мужчина1", "name": "Мужчина 1", "type": "avatar", "price": 0, "file": "иужчина1.png"},
    {"key": "мужчина2", "name": "Мужчина 2", "type": "avatar", "price": 0, "file": "мужчина2.png"},
    {"key": "мужчина3", "name": "Мужчина 3", "type": "avatar", "price": 0, "file": "мужчина3.png"},
    {"key": "мужчина4", "name": "Мужчина 4", "type": "avatar", "price": 0, "file": "мужчина4.png"},
    {"key": "мужчина5", "name": "Мужчина 5", "type": "avatar", "price": 0, "file": "мужчина5.png"},
]

FRAMES: list[dict[str, Any]] = [
    {"key": "деревянная", "name": "Деревянная", "type": "frame", "price": 35, "file": "деревянная.png"},
    {"key": "бантик",     "name": "Бантик",     "type": "frame", "price": 35, "file": "бантик.png"},
    {"key": "очки",       "name": "Очки",        "type": "frame", "price": 35, "file": "очки.png"},
    {"key": "железная",   "name": "Железная",   "type": "frame", "price": 50, "file": "железная.png"},
    {"key": "золотая",    "name": "Золотая",    "type": "frame", "price": 75, "file": "золотая.png"},
    {"key": "корона",     "name": "Корона",     "type": "frame", "price": 75, "file": "корона.png"},
    {"key": "лоза",       "name": "Лоза",       "type": "frame", "price": 75, "file": "лоза.png"},
    {"key": "водная",     "name": "Водная",     "type": "frame", "price": 75, "file": "водная.png"},
    {"key": "радужная",   "name": "Радужная",   "type": "frame", "price": 150, "file": "радужная.png"},
    {"key": "пиксельная", "name": "Пиксельная", "type": "frame", "price": 150, "file": "пиксельная.png"},
    {"key": "алмазная",   "name": "Алмазная",   "type": "frame", "price": 200, "file": "алмазная.png"},
    {"key": "двоичная",   "name": "Двоичная",   "type": "frame", "price": 200, "file": "двоичная.png"},
]

THEMES: list[dict[str, Any]] = [
    {"key": "light",    "name": "Классическая",  "type": "theme", "price": 0,   "preview": ["#f8fbff", "#4a90d9"]},
    {"key": "dark",     "name": "Тёмная",        "type": "theme", "price": 0,   "preview": ["#0d1117", "#2f81f7"]},
    {"key": "sky",      "name": "Небесная",      "type": "theme", "price": 100, "preview": ["#e0f2fe", "#0ea5e9"]},
    {"key": "forest",   "name": "Лесная",        "type": "theme", "price": 100, "preview": ["#dcfce7", "#16a34a"]},
    {"key": "sunset",   "name": "Закат",         "type": "theme", "price": 150, "preview": ["#fff7ed", "#f97316"]},
    {"key": "lavender", "name": "Лавандовая",    "type": "theme", "price": 150, "preview": ["#f3e8ff", "#7c3aed"]},
    {"key": "sakura",   "name": "Сакура",        "type": "theme", "price": 200, "preview": ["#fdf2f8", "#ec4899"]},
    {"key": "mint",     "name": "Мятная",        "type": "theme", "price": 200, "preview": ["#f0fdfa", "#0d9488"]},
]

CATALOG: list[dict[str, Any]] = AVATARS + FRAMES + THEMES
CATALOG_BY_KEY: dict[str, dict[str, Any]] = {item["key"]: item for item in CATALOG}
