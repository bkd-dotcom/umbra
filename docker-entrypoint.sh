#!/bin/sh
# Cloud Run mounts secrets read-only. Codex refreshes its token and needs to
# write auth.json, so copy the mounted founder credential into a writable
# CODEX_HOME before starting. No-op when the secret isn't mounted (Codex stays
# disabled and every agent degrades honestly).
set -e
CODEX_HOME="${CODEX_HOME:-/app/.codex}"
export CODEX_HOME
SRC=/secrets/codex/auth.json

echo "[entrypoint] CODEX_HOME=$CODEX_HOME HOME=${HOME:-<unset>}"
if [ -f "$SRC" ]; then
  mkdir -p "$CODEX_HOME"
  # Cloud Run mounts the secret as an atomically-swapped symlink (projected
  # volume). `cp` races that swap and aborts with "replaced while being copied",
  # leaving CODEX_HOME empty and Codex logged out. Reading the bytes through an
  # open handle (`cat >`) reads a consistent inode and is immune to the swap.
  if cat "$SRC" > "$CODEX_HOME/auth.json" 2>/dev/null && [ -s "$CODEX_HOME/auth.json" ]; then
    chmod 600 "$CODEX_HOME/auth.json" 2>/dev/null || true
    echo "[entrypoint] loaded auth.json -> $CODEX_HOME/auth.json ($(wc -c < "$CODEX_HOME/auth.json" | tr -d ' ') bytes)"
  else
    echo "[entrypoint] WARNING: failed to load $SRC into CODEX_HOME"
  fi
  # Some codex builds resolve their home via $HOME/.codex rather than CODEX_HOME.
  # Mirror the credential there too so the login is found regardless of which
  # path the runtime uses. Harmless when HOME/.codex == CODEX_HOME.
  if [ -n "$HOME" ] && [ "$HOME/.codex" != "$CODEX_HOME" ]; then
    mkdir -p "$HOME/.codex"
    cat "$SRC" > "$HOME/.codex/auth.json" 2>/dev/null || true
    chmod 600 "$HOME/.codex/auth.json" 2>/dev/null || true
    echo "[entrypoint] mirrored auth.json -> $HOME/.codex/auth.json"
  fi
  # Zero-credit auth diagnostic (no model request): surfaces in Cloud Run logs
  # whether Codex actually sees the mounted ChatGPT login. If this prints
  # "Logged in using ChatGPT", live Codex is wired correctly; if "Not logged
  # in", the credential is not being loaded and every agent will degrade.
  echo "[entrypoint] codex login status:"
  codex login status 2>&1 | head -3 || echo "[entrypoint] (codex login status unavailable)"
else
  echo "[entrypoint] no mounted secret at $SRC -- Codex disabled; agents degrade honestly"
fi

exec uvicorn backend.main:app --host 0.0.0.0 --port "${PORT:-8000}"
