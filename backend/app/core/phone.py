from __future__ import annotations

import re

_PHONE_ERR = 'Укажите корректный российский номер телефона (например +7 912 345-67-89).'


def normalize_russian_phone(raw: str | None) -> str | None:
    if raw is None:
        return None
    digits = re.sub(r'\D', '', str(raw).strip())
    if not digits:
        return None
    if len(digits) == 11 and digits[0] == '8':
        digits = '7' + digits[1:]
    if len(digits) == 10:
        digits = '7' + digits
    if len(digits) == 11 and digits[0] == '7' and digits.isdigit():
        return digits
    return None


def is_valid_russian_phone(normalized: str | None) -> bool:
    if not normalized or len(normalized) != 11 or not normalized.isdigit():
        return False
    if normalized[0] != '7':
        return False
    return bool(re.fullmatch(r'7\d{10}', normalized))


def phone_validation_message() -> str:
    return _PHONE_ERR
