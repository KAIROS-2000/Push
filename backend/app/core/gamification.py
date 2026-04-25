from __future__ import annotations


def level_from_xp(xp: int) -> int:
    thresholds = [0, 200, 1000, 3000, 7000, 15000]
    if xp < thresholds[1]:
        return 1
    if xp < thresholds[2]:
        return 2
    if xp < thresholds[3]:
        return 5
    if xp < thresholds[4]:
        return 10
    if xp < thresholds[5]:
        return 15
    return 21


def rank_title(level: int) -> str:
    if level >= 21:
        return 'Легенда'
    if level >= 15:
        return 'Мастер кода'
    if level >= 10:
        return 'Программист'
    if level >= 5:
        return 'Кодер'
    if level >= 2:
        return 'Ученик'
    return 'Новичок'


def xp_to_next_level(xp: int) -> int:
    milestones = [200, 1000, 3000, 7000, 15000]
    for point in milestones:
        if xp < point:
            return point - xp
    return 0
