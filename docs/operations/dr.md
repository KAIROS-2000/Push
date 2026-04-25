# Disaster recovery runbook (P0-8)

This runbook covers recovering the ProgHUB / Progyx Postgres database from
a nightly `pg_dump` backup. It assumes the backup architecture described in
[`backup.md`](./backup.md).

## Targets

| Metric | Target                         | Notes                             |
| ------ | ------------------------------ | --------------------------------- |
| RPO    | **24 hours**                    | Nightly `pg_dump`; worst-case loss = time since last successful dump. |
| RTO    | **2 hours** for full restore    | Assumes backup is already on the target host. Add transfer time if restoring from off-host. |
| MTTR   | **4 hours** including triage    | End-to-end from incident detection to service restored. |

If a tighter RPO is needed (e.g. 1 hour), move to continuous WAL archiving
(pgBackRest / WAL-G). Out of scope for the current phase.

## Prerequisites

- Access to the host running the compose stack (or to the target DR host).
- Docker + docker compose installed.
- Read access to a copy of the target backup file
  (`progyx-YYYYMMDDTHHMMSSZ.sql.custom.gz`) and its `.sha256` sidecar.
- The same `postgres:17` image digest used in production (see
  `docs/operations/image-pinning.md`).

## Full restore procedure

**This is destructive.** Run it only after declaring a recovery incident.

### 1. Stop writers

```sh
docker compose stop backend backend-init frontend
```

Leave `db` and `db-backup` running for now (we'll replace the data below).

### 2. Identify the target backup

```sh
docker compose exec db-backup sh -c 'ls -lh /backups | tail -n 20'
```

Pick the most recent dump older than the incident, or the specific dump
requested by the incident commander.

### 3. Verify checksum

```sh
docker compose exec db-backup sh -c \
    'cd /backups && sha256sum -c progyx-YYYYMMDDTHHMMSSZ.sql.custom.gz.sha256'
```

Must print `OK`. If it does not, abort and select the previous dump.

### 4. Drop and recreate the database

```sh
docker compose exec -T db psql -U codequest -d postgres <<SQL
    REVOKE CONNECT ON DATABASE codequest FROM PUBLIC;
    SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = 'codequest' AND pid <> pg_backend_pid();
    DROP DATABASE IF EXISTS codequest;
    CREATE DATABASE codequest OWNER codequest;
SQL
```

### 5. Restore

```sh
docker compose exec \
    -e RESTORE_ASSUME_YES=1 \
    -e PGHOST=db \
    -e PGDATABASE=codequest \
    -e PGUSER=codequest \
    -e PGPASSWORD=codequest \
    db-backup \
    /usr/local/bin/restore.sh /backups/progyx-YYYYMMDDTHHMMSSZ.sql.custom.gz
```

Watch for `restore complete` in the output. Any `pg_restore` error line
aborts the process (`--exit-on-error`).

### 6. Run the backend bootstrap step

The backend has a migration/bootstrap step wired into `backend-init`. Re-run
it to apply any migrations newer than the dump:

```sh
docker compose up backend-init
```

### 7. Bring writers back

```sh
docker compose start backend frontend
```

### 8. Post-restore verification

- `/api/health` returns `200`.
- Log in as a known administrator account and spot-check dashboards.
- Record the dump file name, checksum, and restore duration in the
  incident log.

## Weekly verification (MUST run)

A backup that has never been restored is not a backup. Every **Monday**
the on-call engineer MUST:

1. Pick the newest backup in `/backups`.
2. Verify its `.sha256` sidecar.
3. Spin up a throwaway Postgres 17 container in a side project and restore
   into it using `scripts/restore.sh`.
4. Run `SELECT count(*) FROM users; SELECT count(*) FROM lessons;` (or
   the equivalent core tables) and confirm the counts are plausible.
5. Tear the throwaway container down. Record the week's check in the ops
   log (green / red).

A failure at any step is a P1 — escalate via the contact chain below.

## Contact chain

| Role                 | Contact                                                    |
| -------------------- | ---------------------------------------------------------- |
| Primary on-call      | *fill in from team runbook*                                |
| Secondary on-call    | *fill in*                                                  |
| DBA / platform owner | *fill in*                                                  |
| Incident commander   | *fill in*                                                  |

## Dependencies & monitoring

- **Disk space** on the host volume backing `postgres_backups`. Alert at
  80% full; page at 90%.
- **Backup freshness.** Alert if no new `progyx-*.sql.custom.gz` has
  appeared in `/backups` in the last 30 hours. Simplest implementation: a
  cron job on the host that runs `find` with `-mmin -1800` on the volume.
- **Backup size.** Sudden large swings (>50% vs the 7-day rolling mean)
  often indicate either bulk data events or a corrupted dump. Investigate.
- **Off-host copy lag.** If you have configured off-host sync (strongly
  recommended), alert when the most recent off-host object is >48h old.

## Known limitations

- `pg_dump` takes a consistent snapshot at a single point in time but can
  take several minutes on large databases. During the dump the DB accepts
  writes normally, but replica / analytics consumers may see lock waits on
  specific large tables. A future move to `pg_basebackup` + WAL archiving
  removes this.
- The current compose file stores the backup volume on the same host as
  the primary data volume. A host loss loses both. Off-host sync is
  mandatory for any real deployment (see `backup.md`).