"""Daily export of admin audit logs and site activity logs to JSON files, then clearing the DB tables.

RETENTION POLICY (set by product owner, 2026-05-11):
    Audit and site-activity JSON archives are kept **forever** on the host
    that mounts AUDIT_LOG_ARCHIVE_DIR. No purge job runs on them — operators
    are expected to copy / rotate the directory to cold storage out of band.
    The only retention in this repo is on PostgreSQL backups (scripts/backup.sh,
    14 days), which is a separate concern.
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator

from flask import current_app
from sqlalchemy import delete, func, select

from ..core.db import db
from ..models.user import AdminAuditLog, SiteActivityLog, User

# ORM chunk size during export — avoids loading whole tables into RAM (gunicorn timeout / OOM).
_EXPORT_STREAM_YIELD_PER = 2000


def get_archive_dir() -> Path:
    """Resolved archive root; created if missing."""
    raw = current_app.config.get("AUDIT_LOG_ARCHIVE_DIR")
    if not raw:
        raise RuntimeError("AUDIT_LOG_ARCHIVE_DIR is not set")
    path = Path(str(raw))
    path.mkdir(parents=True, exist_ok=True)
    return path.resolve()


def _atomic_write_streaming_utf8_json_object(
    final_path: Path,
    leading_fields: dict[str, Any],
    items_iter: Iterator[dict[str, Any]],
) -> int:
    """
    Write {"...leading_fields, "items": [...], "row_count": n} atomically with bounded memory.
    `row_count` is emitted last so we can count rows in one streamed pass.

    Uses `default=str` so nested values (datetime, Decimal, etc.) never break dumps.
    """
    fd, tmp_name = tempfile.mkstemp(
        prefix=final_path.stem + "_",
        suffix=".json.tmp",
        dir=str(final_path.parent),
    )
    written = 0
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write("{\n")
            for key, val in leading_fields.items():
                handle.write(
                    f"  {json.dumps(key, ensure_ascii=False)}: "
                    f"{json.dumps(val, ensure_ascii=False, default=str)},\n"
                )
            handle.write(f'  {json.dumps("items", ensure_ascii=False)}: [\n')
            first = True
            for item in items_iter:
                written += 1
                if not first:
                    handle.write(",\n")
                first = False
                handle.write("    ")
                handle.write(json.dumps(item, ensure_ascii=False, default=str))
            handle.write("\n  ],\n")
            handle.write(
                f"  {json.dumps('row_count', ensure_ascii=False)}: "
                f"{json.dumps(written, ensure_ascii=False)}\n"
            )
            handle.write("}\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, str(final_path))
    except OSError:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
    return written


@contextmanager
def archive_export_lock(archive_dir: Path) -> Iterator[None]:
    """
    Prefer exclusive cross-process lock (fcntl) so multiple gunicorn workers do not
    export concurrently. Windows dev: no cross-process lock; use a single worker.
    """
    lock_path = archive_dir / ".daily_admin_log_export.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)

    fp = lock_path.open("a+b")
    try:
        if sys.platform != "win32":
            import fcntl

            fcntl.flock(fp.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        if sys.platform != "win32":
            import fcntl

            try:
                fcntl.flock(fp.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass
        fp.close()


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


def list_site_activity_archive_dates(archive_dir: Path) -> list[str]:
    out: list[str] = []
    for p in sorted(archive_dir.glob("site_activity_*.json"), key=lambda x: x.name, reverse=True):
        stem = p.stem
        if not stem.startswith("site_activity_"):
            continue
        d = stem[len("site_activity_") :]
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


def resolve_site_activity_archive_file(archive_dir: Path, date_key: str) -> Path | None:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_key):
        return None
    try:
        datetime.strptime(date_key, "%Y-%m-%d")
    except ValueError:
        return None
    base = archive_dir.resolve()
    candidate = (base / f"site_activity_{date_key}.json").resolve()
    if candidate.parent != base:
        return None
    return candidate


def _iter_admin_audit_export_dicts() -> Iterator[dict[str, Any]]:
    stmt = (
        select(AdminAuditLog)
        .order_by(AdminAuditLog.id.asc())
        .execution_options(
            yield_per=_EXPORT_STREAM_YIELD_PER,
            stream_results=True,
        )
    )
    for row in db.session.scalars(stmt):
        yield row.to_dict()


def _iter_site_activity_export_dicts() -> Iterator[dict[str, Any]]:
    stmt = (
        select(SiteActivityLog, User.email)
        .outerjoin(User, User.id == SiteActivityLog.user_id)
        .order_by(SiteActivityLog.id.asc())
        .execution_options(
            yield_per=_EXPORT_STREAM_YIELD_PER,
            stream_results=True,
        )
    )
    for site_log, email in db.session.execute(stmt):
        yield site_log.to_dict(user_email=email)


def _run_audit_log_export_unlocked() -> dict[str, Any]:
    cnt = db.session.scalar(select(func.count()).select_from(AdminAuditLog)) or 0
    if cnt == 0:
        return {"status": "skipped", "row_count": 0, "reason": "empty_table"}

    archive_dir = get_archive_dir()
    now = datetime.now(UTC)
    date_key = now.date().isoformat()
    final_path = archive_dir / f"admin_audit_{date_key}.json"

    leading = {
        "exported_at": now.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z"),
    }
    n = _atomic_write_streaming_utf8_json_object(
        final_path, leading, _iter_admin_audit_export_dicts()
    )
    db.session.execute(delete(AdminAuditLog))
    db.session.commit()
    return {
        "status": "ok",
        "row_count": n,
        "path": str(final_path),
        "date": date_key,
    }


def _run_site_activity_log_export_unlocked() -> dict[str, Any]:
    if not current_app.config.get("ENABLE_SITE_ACTIVITY_LOG", True):
        return {"status": "skipped", "row_count": 0, "reason": "site_activity_logging_disabled"}

    cnt = db.session.scalar(select(func.count()).select_from(SiteActivityLog)) or 0
    if cnt == 0:
        return {"status": "skipped", "row_count": 0, "reason": "empty_table"}

    archive_dir = get_archive_dir()
    now = datetime.now(UTC)
    date_key = now.date().isoformat()
    final_path = archive_dir / f"site_activity_{date_key}.json"

    leading = {
        "exported_at": now.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z"),
    }
    n = _atomic_write_streaming_utf8_json_object(
        final_path, leading, _iter_site_activity_export_dicts()
    )
    db.session.execute(delete(SiteActivityLog))
    db.session.commit()
    return {
        "status": "ok",
        "row_count": n,
        "path": str(final_path),
        "date": date_key,
    }


def run_audit_log_export() -> dict[str, Any]:
    """
    Export all AdminAuditLog rows to admin_audit_<UTC date>.json, then delete them.
    Locked for safe use from multiple worker processes.
    """
    archive_dir = get_archive_dir()
    with archive_export_lock(archive_dir):
        return _run_audit_log_export_unlocked()


def run_site_activity_log_export() -> dict[str, Any]:
    """Export SiteActivityLog rows similarly; gated by ENABLE_SITE_ACTIVITY_LOG."""
    archive_dir = get_archive_dir()
    with archive_export_lock(archive_dir):
        return _run_site_activity_log_export_unlocked()


def run_daily_admin_log_exports() -> dict[str, Any]:
    """
    One scheduled run: export audit logs, then site activity logs under a single lock.
    Avoids waiting on the outer lock twice and keeps ordering predictable.
    """
    archive_dir = get_archive_dir()
    with archive_export_lock(archive_dir):
        audit = _run_audit_log_export_unlocked()
        site_activity = _run_site_activity_log_export_unlocked()
        return {"audit": audit, "site_activity": site_activity}


def _manual_snapshot_key(now: datetime) -> str:
    """Server UTC filesystem-safe suffix: YYYY-MM-DD_HH-MM-SS."""
    adjusted = now if now.tzinfo is not None else now.replace(tzinfo=UTC)
    adjusted = adjusted.astimezone(UTC)
    return adjusted.strftime('%Y-%m-%d_%H-%M-%S')


def sanitize_client_manual_snapshot_key(raw: str | None) -> str | None:
    """
    Safe stem from the browser (local TZ). Strict pattern + real calendar/time validation.
    """
    if raw is None or not isinstance(raw, str):
        return None
    key = raw.strip()
    if not key or len(key) > 32:
        return None
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}', key):
        return None
    try:
        datetime.strptime(key, '%Y-%m-%d_%H-%M-%S')
    except ValueError:
        return None
    return key


def _run_audit_log_manual_export_unlocked(
    snapshot_key: str, exported_at: datetime, *, snapshot_timezone: str
) -> dict[str, Any]:
    cnt = db.session.scalar(select(func.count()).select_from(AdminAuditLog)) or 0
    if cnt == 0:
        return {'status': 'skipped', 'row_count': 0, 'reason': 'empty_table'}

    archive_dir = get_archive_dir()
    path = archive_dir / f'admin_audit_manual_{snapshot_key}.json'
    leading = {
        'export_kind': 'manual',
        'snapshot_key': snapshot_key,
        'snapshot_timezone': snapshot_timezone,
        'exported_at': exported_at.astimezone(UTC).isoformat().replace('+00:00', 'Z'),
    }

    n = _atomic_write_streaming_utf8_json_object(
        path, leading, _iter_admin_audit_export_dicts()
    )
    db.session.execute(delete(AdminAuditLog))
    db.session.commit()
    return {
        'status': 'ok',
        'row_count': n,
        'path': str(path),
        'filename': path.name,
    }


def _run_site_activity_log_manual_export_unlocked(
    snapshot_key: str, exported_at: datetime, *, snapshot_timezone: str
) -> dict[str, Any]:
    if not current_app.config.get('ENABLE_SITE_ACTIVITY_LOG', True):
        return {'status': 'skipped', 'row_count': 0, 'reason': 'site_activity_logging_disabled'}

    cnt = db.session.scalar(select(func.count()).select_from(SiteActivityLog)) or 0
    if cnt == 0:
        return {'status': 'skipped', 'row_count': 0, 'reason': 'empty_table'}

    archive_dir = get_archive_dir()
    path = archive_dir / f'site_activity_manual_{snapshot_key}.json'
    leading = {
        'export_kind': 'manual',
        'snapshot_key': snapshot_key,
        'snapshot_timezone': snapshot_timezone,
        'exported_at': exported_at.astimezone(UTC).isoformat().replace('+00:00', 'Z'),
    }

    n = _atomic_write_streaming_utf8_json_object(
        path, leading, _iter_site_activity_export_dicts()
    )
    db.session.execute(delete(SiteActivityLog))
    db.session.commit()
    return {
        'status': 'ok',
        'row_count': n,
        'path': str(path),
        'filename': path.name,
    }


def run_manual_admin_log_exports(client_snapshot_key: str | None = None) -> dict[str, Any]:
    """
    Immediate export with a timestamp in the filename stem.
    If `client_snapshot_key` is validated (sent from browser = user's local TZ), it is used;
    otherwise UTC server time suffix is used. Independent of nightly calendars.
    """
    archive_dir = get_archive_dir()
    with archive_export_lock(archive_dir):
        exported_at = datetime.now(UTC)
        approved_client = sanitize_client_manual_snapshot_key(client_snapshot_key)
        if approved_client is not None:
            snapshot_key = approved_client
            snapshot_timezone = 'browser_local'
        else:
            snapshot_key = _manual_snapshot_key(exported_at)
            snapshot_timezone = 'server_utc'
        audit = _run_audit_log_manual_export_unlocked(
            snapshot_key, exported_at, snapshot_timezone=snapshot_timezone
        )
        site_activity = _run_site_activity_log_manual_export_unlocked(
            snapshot_key, exported_at, snapshot_timezone=snapshot_timezone
        )
        return {
            'export_kind': 'manual',
            'snapshot_key': snapshot_key,
            'snapshot_timezone': snapshot_timezone,
            'exported_at': exported_at.isoformat().replace('+00:00', 'Z'),
            'audit': audit,
            'site_activity': site_activity,
        }
