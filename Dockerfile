FROM python:3.11-slim

WORKDIR /app
COPY pyproject.toml README.md ./
COPY backend ./backend
RUN pip install --no-cache-dir .

ENV PYTHONUNBUFFERED=1
EXPOSE 8000
# Bind to the platform-injected $PORT (Render, Fly, etc.); fall back to 8000 locally.
# Shell form is required so ${PORT} is expanded at runtime.
CMD uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}

