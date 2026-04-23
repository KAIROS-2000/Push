# Image pinning (P0-6)

Production builds MUST pin every base image by digest (`@sha256:<digest>`)
rather than by mutable tag. Floating tags (`postgres:17`, `python:3.12-slim`,
`node:22-alpine`, ...) can silently change base OS packages under us, which
defeats reproducible builds and SBOM/CVE tracking.

## Images tracked by this repo

| Image              | Used by                                             |
| ------------------ | --------------------------------------------------- |
| `postgres:17`      | `docker-compose.yml` services `db`, `db-backup`     |
| `python:3.12-slim` | `backend/Dockerfile`, `judge_runner/Dockerfile`     |
| `node:22-alpine`   | `frontend/Dockerfile` (three stages: deps/builder/runner) |
| `alpine:3.21`      | (reserved — not currently used by any runtime stage) |

Any change to this list MUST be reflected in `scripts/pin-images.sh`.

## Resolving digests

```sh
./scripts/pin-images.sh
```

This pulls each image from its configured registry and prints its current
`<repo>@sha256:<digest>` to stdout. Example output:

```
python@sha256:1234...abcd  # pinned from python:3.12-slim
node@sha256:5678...ef01    # pinned from node:22-alpine
postgres@sha256:9abc...def0  # pinned from postgres:17
```

Equivalent manual commands (run one per image):

```sh
docker pull python:3.12-slim
docker inspect --format='{{index .RepoDigests 0}}' python:3.12-slim
```

## Applying digests

1. Run `scripts/pin-images.sh` and capture the output.
2. Replace each occurrence in the files listed in the table above:
   - `FROM python:3.12-slim` → `FROM python:3.12-slim@sha256:<digest>`
   - `image: postgres:17`    → `image: postgres:17@sha256:<digest>`
   - `FROM node:22-alpine AS deps` → `FROM node:22-alpine@sha256:<digest> AS deps`
     (and identically for the `builder` and `runner` stages — they MUST share
     the same digest so that the multi-stage build is coherent).
3. Commit the change with a message like
   `chore(deps): pin container images (YYYY-MM-DD)` and record the digests in
   the commit body for audit.
4. Rebuild locally and run the full test suite before merging.

## Cadence

- **Monthly** renewal: re-run `scripts/pin-images.sh` and bump to the latest
  tag digests; inspect release notes for breaking changes.
- **Ad-hoc** renewal: whenever a CVE affecting a pinned image is announced,
  rotate immediately. Track the rotation in the security log.

## Judge-runner `nodejs` package

`judge_runner/Dockerfile` additionally installs the Debian `nodejs` package
for Node execution support. Debian's default (bookworm) nodejs is currently
version 18.x, which is older than `node:22-alpine` used by the frontend. This
is an intentional split — the judge-runner does not need the latest Node
features, only a stable, reproducible runtime for student submissions.

To pin the exact Debian package version, pass a build arg:

```sh
docker build \
    --build-arg NODEJS_APT_VERSION=18.19.0+dfsg-6~deb12u1 \
    -f judge_runner/Dockerfile -t proghub/judge-runner .
```

Look up the currently-available version with
`apt-cache policy nodejs` inside a throwaway `python:3.12-slim` container.
Track the pinned version the same way as base-image digests (see `Cadence`).

## Trade-offs & notes

- Pinning by digest means the CI runner and operators must `docker pull`
  before every build (or have a warm cache). Mirroring images to an internal
  registry is recommended for production but out of scope for this repo.
- `scripts/pin-images.sh` does NOT rewrite files automatically — by design,
  so that a human reviewer sees the digest bump in the diff.