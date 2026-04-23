#!/bin/sh
# ---------------------------------------------------------------------------
# ProgHUB / Progyx Postgres restore helper.
#
# DESTRUCTIVE. Overwrites the target database. Run only inside a maintenance
# window or against a freshly-provisioned DR instance.
#
# Usage (from the `db-backup` container, or any host with `pg_restore` and
# network access to the DB):
#
#   PGHOST=db PGDATABASE=codequest PGUSER=codequest PGPASSWORD=... \
#     scripts/restore.sh /backups/progyx-20260101T030000Z.sql.custom.gz
#
# The script:
#   1. Verifies the file exists and, if a .sha256 sidecar is present,
#      verifies the checksum.
#   2. Pipes the gunzipped dump into `pg_restore --clean --if-exists`
#      against the target database.
# ---------------------------------------------------------------------------
set -eu

if [ $# -ne 1 ]; then
    echo "usage: $0 <backup.sql.custom.gz>" >&2
    exit 2
fi

FILE="$1"

if [ ! -f "${FILE}" ]; then
    echo "error: backup file not found: ${FILE}" >&2
    exit 1
fi

if [ -f "${FILE}.sha256" ] && command -v sha256sum >/dev/null 2>&1; then
    echo "[$(date -u +%FT%TZ)] verifying sha256 checksum"
    ( cd "$(dirname "${FILE}")" && sha256sum -c "$(basename "${FILE}")".sha256 )
fi

cat <<EOF
*** DESTRUCTIVE OPERATION ***
About to restore ${FILE}
into database: ${PGDATABASE:-?} on host ${PGHOST:-?} as user ${PGUSER:-?}
All existing objects in the target database will be dropped first.
EOF

if [ "${RESTORE_ASSUME_YES:-0}" != "1" ]; then
    printf 'Type YES to continue: '
    read -r confirm
    if [ "${confirm}" != "YES" ]; then
        echo "aborted."
        exit 1
    fi
fi

echo "[$(date -u +%FT%TZ)] starting pg_restore"

gunzip -c "${FILE}" | pg_restore \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --exit-on-error \
    --dbname="${PGDATABASE}"

echo "[$(date -u +%FT%TZ)] restore complete"