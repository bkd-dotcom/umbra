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

from backend.settings import decrypt, encrypt


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_decrypt(value: str | None) -> str | None:
    """Decrypt a stored secret, tolerating legacy plaintext / bad ciphertext."""
    if not value:
        return None
    try:
        return decrypt(value)
    except Exception:  # noqa: BLE001 - corrupt/foreign ciphertext → treat as absent
        return None


class _MemoryStore:
    """Process-local fallback. Not durable (fine for dev/tests)."""

    def __init__(self) -> None:
        self._users: dict[str, dict[str, Any]] = {}
        self._tokens: dict[str, str] = {}
        self._openai_keys: dict[str, str] = {}
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
            self._tokens[key] = encrypt(token)

    def get_github_token(self, key: str) -> str | None:
        with self._lock:
            return _safe_decrypt(self._tokens.get(key))

    def put_openai_key(self, key: str, api_key: str) -> None:
        with self._lock:
            self._openai_keys[key] = encrypt(api_key)

    def get_openai_key(self, key: str) -> str | None:
        with self._lock:
            return _safe_decrypt(self._openai_keys.get(key))

    def clear_openai_key(self, key: str) -> None:
        with self._lock:
            self._openai_keys.pop(key, None)

    def save_scan(self, key: str, summary: dict[str, Any]) -> None:
        with self._lock:
            self._scans.setdefault(key, []).insert(0, {**summary, "ran_at": _now()})
            self._scans[key] = self._scans[key][:50]

    def list_scans(self, key: str, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(s) for s in self._scans.get(key, [])[:limit]]

    def clear_scans(self, key: str) -> None:
        with self._lock:
            self._scans.pop(key, None)


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
        self._user(key).set({"github_token": encrypt(token), "updated_at": _now()}, merge=True)

    def get_github_token(self, key: str) -> str | None:
        snap = self._user(key).get()
        return _safe_decrypt((snap.to_dict() or {}).get("github_token")) if snap.exists else None

    def put_openai_key(self, key: str, api_key: str) -> None:
        self._user(key).set({"openai_key": encrypt(api_key), "updated_at": _now()}, merge=True)

    def get_openai_key(self, key: str) -> str | None:
        snap = self._user(key).get()
        return _safe_decrypt((snap.to_dict() or {}).get("openai_key")) if snap.exists else None

    def clear_openai_key(self, key: str) -> None:
        self._user(key).set({"openai_key": None, "updated_at": _now()}, merge=True)

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

    def clear_scans(self, key: str) -> None:
        # Firestore has no subcollection-level delete; remove each doc. Batched to
        # keep it to a few round-trips even for the capped ~50-scan history.
        collection = self._user(key).collection("scans")
        batch = self._db.batch()
        pending = 0
        for doc in collection.stream():
            batch.delete(doc.reference)
            pending += 1
            if pending == 400:
                batch.commit()
                batch = self._db.batch()
                pending = 0
        if pending:
            batch.commit()


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
