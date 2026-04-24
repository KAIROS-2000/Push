# ---------------------------------------------------------------------------
# Image pinning REQUIRED for production.
# Replace the FROM line with an explicit digest, e.g.:
#   FROM python:3.12-slim@sha256:<digest>
# See docs/operations/image-pinning.md and scripts/pin-images.sh.
# ---------------------------------------------------------------------------

FROM python:3.12-slim
# pin: python:3.12-slim  (replace with @sha256:<digest> before prod build)

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

COPY backend/requirements.txt /tmp/requirements.txt

RUN pip install --no-cache-dir -r /tmp/requirements.txt \
    && useradd --create-home --shell /usr/sbin/nologin appuser

COPY backend /app/backend
COPY shared /app/shared

WORKDIR /app/backend

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2).read()"

CMD ["gunicorn", "--bind", "0.0.0.0:8000", "run:app"]