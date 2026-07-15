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
COPY pyproject.toml README.md ./
COPY backend ./backend
RUN pip install --no-cache-dir .
COPY --from=frontend /fe/out ./frontend/out

ENV PYTHONUNBUFFERED=1 \
    UMBRA_DEMO_MODE=true \
    UMBRA_STATIC_DIR=/app/frontend/out
EXPOSE 8000
# Bind to the platform-injected $PORT (Render, Fly, etc.); fall back to 8000
# locally. Shell form is required so ${PORT} is expanded at runtime.
CMD uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}
