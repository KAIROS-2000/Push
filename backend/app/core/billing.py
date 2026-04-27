from __future__ import annotations

from ..models.user import User


def parent_billing_placeholder(user: User) -> dict:
    """Real payment provider integration hooks live here; no fake charges."""
    return {
        "status": "not_connected",
        "message": "Оплата пока не подключена.",
        "current_plan": None,
        "invoices": [],
        "payment_history": [],
    }
