# syntax=docker/dockerfile:1
# --- Stage 1: build the dashboard into a static bundle ----------------------
FROM node:20-slim AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
# Empty API base => the dashboard calls /api/... on its own origin (this app),
# so the single-service deploy needs no cross-origin config and no CORS.
ENV NEXT_PUBLIC_API_URL=""
RUN npm run build   # `output: export` writes the static site to /fe/out

# --- Stage 2: serve the API + the built dashboard from one process ----------
FROM python:3.11-slim
WORKDIR /app
# git: disposable public/private repo clones (cloud-scan mode).
# Node 20 + @openai/codex: live Codex CLI for the founder account only (gated by
# UMBRA_FOUNDER_IDS at request time; never invoked for other users).
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g @openai/codex \
    && apt-get purge -y curl && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml README.md ./
COPY backend ./backend
# [cloud] adds google-cloud-firestore for durable per-user storage.
RUN pip install --no-cache-dir ".[cloud]"
COPY --from=frontend /fe/out ./frontend/out
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

ENV PYTHONUNBUFFERED=1 \
    UMBRA_DEMO_MODE=true \
    UMBRA_STATIC_DIR=/app/frontend/out \
    CODEX_HOME=/app/.codex
EXPOSE 8000
# Entrypoint copies the (read-only) mounted founder Codex credential into a
# writable CODEX_HOME, then binds uvicorn to the platform-injected $PORT.
CMD ["./docker-entrypoint.sh"]
