FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /usr/sbin/nologin judge

COPY app.py .

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    JUDGE_RUNNER_HOST=0.0.0.0 \
    JUDGE_RUNNER_PORT=8090

USER judge

CMD ["python", "app.py"]
