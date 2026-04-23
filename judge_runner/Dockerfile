# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Image pinning REQUIRED for production.
# This Dockerfile keeps a floating tag for local/dev builds. For production,
# replace the FROM line with an explicit digest, e.g.:
#   FROM python:3.12-slim@sha256:<digest>
# See docs/operations/image-pinning.md and scripts/pin-images.sh for the
# exact commands used to compute and track digests.
# ---------------------------------------------------------------------------
# Also: the NodeSource / Debian `nodejs` package below is *not* version-pinned.
# For production the operator SHOULD pin an exact package version by supplying
# --build-arg NODEJS_APT_VERSION=<version>. The default leaves the apt resolver
# to pick bookworm's current nodejs. Trade-off documented in
# docs/operations/sandbox.md (P0-4 notes).
# ---------------------------------------------------------------------------

FROM python:3.12-slim
# pin: python:3.12-slim  (replace with @sha256:<digest> before prod build)

WORKDIR /app

ARG NODEJS_APT_VERSION=""
RUN set -eux; \
    apt-get update; \
    if [ -n "$NODEJS_APT_VERSION" ]; then \
        apt-get install -y --no-install-recommends \
            "nodejs=${NODEJS_APT_VERSION}" \
            ca-certificates; \
    else \
        apt-get install -y --no-install-recommends \
            nodejs \
            ca-certificates; \
    fi; \
    rm -rf /var/lib/apt/lists/*

# Create a dedicated non-root user with an explicit UID/GID so that
# docker-compose security policies (read_only, user namespaces) can refer to
# it deterministically. 1001 intentionally sits outside the default Debian
# "users" range and avoids collision with the host's primary user (1000).
RUN groupadd --system --gid 1001 judgeuser \
    && useradd --system --uid 1001 --gid 1001 \
        --home-dir /home/judgeuser --create-home \
        --shell /usr/sbin/nologin judgeuser

COPY judge_runner /app/judge_runner
COPY shared /app/shared

RUN chown -R judgeuser:judgeuser /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    JUDGE_RUNNER_HOST=0.0.0.0 \
    JUDGE_RUNNER_PORT=8090

USER 1001

CMD ["python", "judge_runner/app.py"]