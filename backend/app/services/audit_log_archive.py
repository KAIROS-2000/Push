"""Daily export of `AdminAuditLog` rows to JSON files and clearing the table after a successful write."""

from __future__ import annotations

import json
import os
import re
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from flask import current_app

from ..core.db import db
from ..models.user import AdminAuditLog


def get_archive_dir() -> Path:
    """Resolved archive root; created if missing."""
    raw = current_app.config.get("AUDIT_LOG_ARCHIVE_DIR")
    if not raw:
        raise RuntimeError("AUDIT_LOG_ARCHIVE_DIR is not set")
    path = Path(str(raw))
    path.mkdir(parents=True, exist_ok=True)
    return path.resolve()


def list_archive_dates(archive_dir: Path) -> list[str]:
    out: list[str] = []
    for p in sorted(archive_dir.glob("admin_audit_*.json"), key=lambda x: x.name, reverse=True):
        stem = p.stem
        if not stem.startswith("admin_audit_"):
            continue
        d = stem[len("admin_audit_") :]
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
            out.append(d)
    return out


def resolve_archive_file(archive_dir: Path, date_key: str) -> Path | None:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_key):
        return None
    try:
        datetime.strptime(date_key, "%Y-%m-%d")
    except ValueError:
        return None
    base = archive_dir.resolve()
    candidate = (base / f"admin_audit_{date_key}.json").resolve()
    if candidate.parent != base:
        return None
    return candidate


def run_audit_log_export() -> dict:
    """
    Write all `AdminAuditLog` rows to `admin_audit_<UTC date today>.json`, then delete them.
    If the table is empty, does nothing. Atomic rename after full JSON is written to a temp file.
    """
    rows = AdminAuditLog.query.order_by(AdminAuditLog.id.asc()).all()
    if not rows:
        return {"status": "skipped", "row_count": 0, "reason": "empty_table"}

    archive_dir = get_archive_dir()
    now = datetime.now(UTC)
    date_key = now.date().isoformat()
    final_name = f"admin_audit_{date_key}.json"
    final_path = archive_dir / final_name

    payload = {
        "exported_at": now.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z"),
        "row_count": len(rows),
        "items": [row.to_dict() for row in rows],
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)

    fd, tmp_name = tempfile.mkstemp(
        prefix="admin_audit_",
        suffix=".json.tmp",
        dir=str(archive_dir),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, str(final_path))
    except OSError:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise

    ids = [row.id for row in rows]
    AdminAuditLog.query.filter(AdminAuditLog.id.in_(ids)).delete(synchronize_session=False)
    db.session.commit()
    return {
        "status": "ok",
        "row_count": len(payload["items"]),
        "path": str(final_path),
        "date": date_key,
    }
