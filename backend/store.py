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
        self._hooks: dict[str, dict[str, Any]] = {}  # hook_token -> {user_key, repo, hook_id, secret(enc)}
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

    # --- Per-repo auto-review webhooks (multi-tenant PR review) ---
    def put_repo_hook(self, hook_token: str, user_key: str, repo: str, hook_id: int, secret: str) -> None:
        with self._lock:
            self._hooks[hook_token] = {"user_key": user_key, "repo": repo, "hook_id": hook_id, "secret": encrypt(secret)}

    def get_repo_hook(self, hook_token: str) -> dict[str, Any] | None:
        with self._lock:
            rec = self._hooks.get(hook_token)
            if not rec:
                return None
            return {**rec, "secret": _safe_decrypt(rec.get("secret"))}

    def delete_repo_hook(self, hook_token: str) -> None:
        with self._lock:
            self._hooks.pop(hook_token, None)

    def find_repo_hook(self, user_key: str, repo: str) -> dict[str, Any] | None:
        with self._lock:
            for token, rec in self._hooks.items():
                if rec.get("user_key") == user_key and rec.get("repo") == repo:
                    return {"hook_token": token, "hook_id": rec.get("hook_id")}
            return None

    def list_repo_hooks_for_user(self, user_key: str) -> list[str]:
        with self._lock:
            return sorted({rec["repo"] for rec in self._hooks.values() if rec.get("user_key") == user_key})


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

    # --- Per-repo auto-review webhooks (multi-tenant PR review) ---
    def put_repo_hook(self, hook_token: str, user_key: str, repo: str, hook_id: int, secret: str) -> None:
        self._db.collection("repo_hooks").document(hook_token).set(
            {"user_key": user_key, "repo": repo, "hook_id": hook_id, "secret": encrypt(secret), "created_at": _now()}
        )

    def get_repo_hook(self, hook_token: str) -> dict[str, Any] | None:
        snap = self._db.collection("repo_hooks").document(hook_token).get()
        if not snap.exists:
            return None
        rec = snap.to_dict() or {}
        return {"user_key": rec.get("user_key"), "repo": rec.get("repo"), "hook_id": rec.get("hook_id"), "secret": _safe_decrypt(rec.get("secret"))}

    def delete_repo_hook(self, hook_token: str) -> None:
        self._db.collection("repo_hooks").document(hook_token).delete()

    def find_repo_hook(self, user_key: str, repo: str) -> dict[str, Any] | None:
        query = self._db.collection("repo_hooks").where("user_key", "==", user_key).where("repo", "==", repo).limit(1)
        for doc in query.stream():
            rec = doc.to_dict() or {}
            return {"hook_token": doc.id, "hook_id": rec.get("hook_id")}
        return None

    def list_repo_hooks_for_user(self, user_key: str) -> list[str]:
        query = self._db.collection("repo_hooks").where("user_key", "==", user_key)
        return sorted({(doc.to_dict() or {}).get("repo") for doc in query.stream() if (doc.to_dict() or {}).get("repo")})


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
