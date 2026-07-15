"""Per-user persistence.

Firestore in the cloud (GCP-native, serverless, encrypted at rest), with an
in-memory fallback so local dev and tests need no GCP. The GitHub OAuth token
is stored server-side here (never in the session cookie).
"""
from __future__ import annotations

import os
import threading
from datetime import datetime, timezone
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class _MemoryStore:
    """Process-local fallback. Not durable (fine for dev/tests)."""

    def __init__(self) -> None:
        self._users: dict[str, dict[str, Any]] = {}
        self._tokens: dict[str, str] = {}
        self._scans: dict[str, list[dict[str, Any]]] = {}
        self._lock = threading.Lock()

    def get_or_create_user(self, key: str, profile: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            existing = self._users.get(key)
            if existing:
                existing.update({**profile, "updated_at": _now()})
            else:
                self._users[key] = {**profile, "created_at": _now(), "updated_at": _now()}
            return dict(self._users[key])

    def put_github_token(self, key: str, token: str) -> None:
        with self._lock:
            self._tokens[key] = token

    def get_github_token(self, key: str) -> str | None:
        with self._lock:
            return self._tokens.get(key)

    def save_scan(self, key: str, summary: dict[str, Any]) -> None:
        with self._lock:
            self._scans.setdefault(key, []).insert(0, {**summary, "ran_at": _now()})
            self._scans[key] = self._scans[key][:50]

    def list_scans(self, key: str, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(s) for s in self._scans.get(key, [])[:limit]]


class _FirestoreStore:
    """Durable store backed by Firestore (native mode)."""

    def __init__(self, client: Any) -> None:
        self._db = client

    def _user(self, key: str):
        return self._db.collection("users").document(key)

    def get_or_create_user(self, key: str, profile: dict[str, Any]) -> dict[str, Any]:
        ref = self._user(key)
        snap = ref.get()
        if snap.exists:
            ref.set({**profile, "updated_at": _now()}, merge=True)
        else:
            ref.set({**profile, "created_at": _now(), "updated_at": _now()})
        return ref.get().to_dict() or {}

    def put_github_token(self, key: str, token: str) -> None:
        self._user(key).set({"github_token": token, "updated_at": _now()}, merge=True)

    def get_github_token(self, key: str) -> str | None:
        snap = self._user(key).get()
        return (snap.to_dict() or {}).get("github_token") if snap.exists else None

    def save_scan(self, key: str, summary: dict[str, Any]) -> None:
        self._user(key).collection("scans").add({**summary, "ran_at": _now()})

    def list_scans(self, key: str, limit: int = 20) -> list[dict[str, Any]]:
        from google.cloud.firestore import Query

        query = (
            self._user(key)
            .collection("scans")
            .order_by("ran_at", direction=Query.DESCENDING)
            .limit(limit)
        )
        return [doc.to_dict() for doc in query.stream()]


_store: Any = None
_store_lock = threading.Lock()


def _build_store() -> Any:
    if os.getenv("UMBRA_USE_FIRESTORE", "false").lower() == "true":
        try:
            from google.cloud import firestore

            return _FirestoreStore(firestore.Client())
        except Exception:  # noqa: BLE001 - fall back rather than crash the app
            pass
    return _MemoryStore()


def get_store() -> Any:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = _build_store()
    return _store


def set_store(store: Any) -> None:
    """Test hook to inject a store."""
    global _store
    _store = store
