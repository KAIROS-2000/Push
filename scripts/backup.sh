#!/bin/sh
# ---------------------------------------------------------------------------
# ProgHUB / Progyx nightly Postgres backup script.
#
# Runs inside the `db-backup` compose service. Uses `pg_dump --format=custom`
# which is compatible with `pg_restore` and supports selective/parallel
# restore. Output is gzip-compressed and written atomically (write to .tmp,
# then rename) so a crash mid-dump never yields a half-file that looks valid.
#
# Required env vars:
#   PGHOST, PGDATABASE, PGUSER, PGPASSWORD  (standard libpq)
# Optional:
#   BACKUP_DIR              (default /backups)
#   BACKUP_RETENTION_DAYS   (default 14)
#
# Retention: files older than BACKUP_RETENTION_DAYS are deleted. The newest
# file is ALWAYS kept regardless of age, so an idle system does not delete
# its only backup.
# ---------------------------------------------------------------------------
set -eu
# POSIX `sh` does not inherit pipe-failure by default, so a `pg_dump | gzip`
# pipeline would silently succeed even if pg_dump died. BusyBox ash (Alpine)
# supports `set -o pipefail`; enable it if available, and in any case split
# the pipeline into two stages with explicit exit-status checks for portability.
( set -o pipefail ) 2>/dev/null && set -o pipefail || true

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/progyx-${TS}.sql.custom.gz"
TMP="${OUT}.tmp"
RAW="${OUT}.raw.tmp"

cleanup_tmp() {
    rm -f "${TMP}" "${RAW}" 2>/dev/null || true
}
trap cleanup_tmp EXIT INT TERM

mkdir -p "${BACKUP_DIR}"

echo "[$(date -u +%FT%TZ)] starting pg_dump host=${PGHOST:-?} db=${PGDATABASE:-?}"

# Two-stage write so we can verify pg_dump exit code explicitly. --format=custom
# already produces a compressed binary dump, but we gzip for sidecar parity and
# smaller on-disk footprint.
if ! pg_dump \
        --format=custom \
        --no-owner \
        --no-privileges \
        --compress=0 \
        --file="${RAW}"; then
    echo "[$(date -u +%FT%TZ)] ERROR: pg_dump failed" >&2
    exit 1
fi

if [ ! -s "${RAW}" ]; then
    echo "[$(date -u +%FT%TZ)] ERROR: pg_dump produced empty output" >&2
    exit 1
fi

if ! gzip -9 -c "${RAW}" > "${TMP}"; then
    echo "[$(date -u +%FT%TZ)] ERROR: gzip failed" >&2
    exit 1
fi

rm -f "${RAW}"
mv "${TMP}" "${OUT}"
trap - EXIT INT TERM

# Compute + store a checksum next to the file for integrity verification.
if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${OUT}" > "${OUT}.sha256"
fi

echo "[$(date -u +%FT%TZ)] wrote ${OUT} ($(wc -c <"${OUT}") bytes)"

# Retention: delete old dumps + their sidecar checksum files, but keep at
# least the most recent one.
NEWEST="$(ls -1t "${BACKUP_DIR}"/progyx-*.sql.custom.gz 2>/dev/null | head -n1 || true)"
find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'progyx-*.sql.custom.gz' \
    -mtime "+${RETENTION_DAYS}" \
    ! -path "${NEWEST}" \
    -print -delete || true
find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'progyx-*.sql.custom.gz.sha256' \
    -mtime "+${RETENTION_DAYS}" \
    -print -delete || true

echo "[$(date -u +%FT%TZ)] backup complete; retention=${RETENTION_DAYS}d"