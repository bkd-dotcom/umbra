"""Per-user persistence.

Firestore in the cloud (GCP-native, serverless, encrypted at rest), with an
in-memory fallback so local dev and tests need no GCP. The GitHub OAuth token
is stored server-side here (never in the session cookie).
"""
from __future__ import annotations

import os
import threading
import uuid
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
        self._dismissed: dict[str, set[str]] = {}  # user_key -> set of dismissed remediation keys
        self._installations: dict[str, dict[str, Any]] = {}  # installation_id -> {account_login, account_type, repos, user_key}
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
            # A stable id lets the UI delete individual scans (not just clear-all).
            self._scans.setdefault(key, []).insert(0, {**summary, "scan_id": uuid.uuid4().hex, "ran_at": _now()})
            self._scans[key] = self._scans[key][:50]

    def list_scans(self, key: str, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(s) for s in self._scans.get(key, [])[:limit]]

    def clear_scans(self, key: str) -> None:
        with self._lock:
            self._scans.pop(key, None)

    def delete_scans(self, key: str, scan_ids: list[str]) -> None:
        """Delete only the named scans (selective clear); unknown ids are ignored."""
        ids = set(scan_ids)
        with self._lock:
            if key in self._scans:
                self._scans[key] = [s for s in self._scans[key] if s.get("scan_id") not in ids]

    # --- Remediation-queue dismissals ---
    # A per-user set of dismissed advisory keys (repo:package@version:cve). The
    # queue itself is derived client-side from saved scans; this lets a user hide
    # individual items without deleting the underlying scan.
    def dismiss_remediations(self, key: str, item_keys: list[str]) -> None:
        with self._lock:
            self._dismissed.setdefault(key, set()).update(item_keys)

    def restore_remediations(self, key: str, item_keys: list[str]) -> None:
        with self._lock:
            if key in self._dismissed:
                self._dismissed[key].difference_update(item_keys)

    def list_dismissed_remediations(self, key: str) -> list[str]:
        with self._lock:
            return sorted(self._dismissed.get(key, set()))

    # --- GitHub App installations (install-once PR auto-review) ---
    # Keyed by installation_id (str). No secrets stored here — the App webhook
    # secret is a single env var, verified per delivery.
    def put_installation(self, installation_id: int, account_login: str, account_type: str, repos: list[str], user_key: str | None = None) -> None:
        with self._lock:
            key = str(installation_id)
            existing = self._installations.get(key, {})
            self._installations[key] = {
                "account_login": account_login,
                "account_type": account_type,
                "repos": sorted(set(repos)),
                # keep an existing user_key link unless a new one is supplied
                "user_key": user_key or existing.get("user_key"),
            }

    def get_installation(self, installation_id: int) -> dict[str, Any] | None:
        with self._lock:
            rec = self._installations.get(str(installation_id))
            return dict(rec) if rec else None

    def delete_installation(self, installation_id: int) -> None:
        with self._lock:
            self._installations.pop(str(installation_id), None)

    def set_installation_repos(self, installation_id: int, repos: list[str]) -> None:
        with self._lock:
            rec = self._installations.get(str(installation_id))
            if rec is not None:
                rec["repos"] = sorted(set(repos))

    def link_installation_user(self, installation_id: int, user_key: str) -> None:
        with self._lock:
            rec = self._installations.get(str(installation_id))
            if rec is not None:
                rec["user_key"] = user_key

    def list_installations_for_user(self, user_key: str) -> list[dict[str, Any]]:
        with self._lock:
            return [
                {"installation_id": int(iid), "account_login": rec.get("account_login"), "repos": rec.get("repos", [])}
                for iid, rec in self._installations.items()
                if rec.get("user_key") == user_key
            ]


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
        # Surface the Firestore doc id as scan_id so the UI can delete individual scans.
        return [{**(doc.to_dict() or {}), "scan_id": doc.id} for doc in query.stream()]

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

    def delete_scans(self, key: str, scan_ids: list[str]) -> None:
        """Delete only the named scans by their Firestore doc id (selective clear)."""
        collection = self._user(key).collection("scans")
        batch = self._db.batch()
        pending = 0
        for sid in scan_ids:
            batch.delete(collection.document(sid))
            pending += 1
            if pending == 400:
                batch.commit()
                batch = self._db.batch()
                pending = 0
        if pending:
            batch.commit()

    # --- Remediation-queue dismissals ---
    # Stored as an array field on the user doc (no secrets, small, per-user).
    def dismiss_remediations(self, key: str, item_keys: list[str]) -> None:
        from google.cloud.firestore import ArrayUnion

        self._user(key).set({"dismissed_remediations": ArrayUnion(list(item_keys)), "updated_at": _now()}, merge=True)

    def restore_remediations(self, key: str, item_keys: list[str]) -> None:
        from google.cloud.firestore import ArrayRemove

        self._user(key).set({"dismissed_remediations": ArrayRemove(list(item_keys)), "updated_at": _now()}, merge=True)

    def list_dismissed_remediations(self, key: str) -> list[str]:
        snap = self._user(key).get()
        return list((snap.to_dict() or {}).get("dismissed_remediations", [])) if snap.exists else []

    # --- GitHub App installations (install-once PR auto-review) ---
    # Top-level collection keyed by installation_id; no secrets stored (the App
    # webhook secret is a single env var, verified per delivery).
    def _installations(self):
        return self._db.collection("app_installations")

    def put_installation(self, installation_id: int, account_login: str, account_type: str, repos: list[str], user_key: str | None = None) -> None:
        doc = self._installations().document(str(installation_id))
        payload = {"account_login": account_login, "account_type": account_type, "repos": sorted(set(repos)), "updated_at": _now()}
        if user_key is not None:
            payload["user_key"] = user_key
        # merge so an installation event does not clobber a user_key set at setup
        doc.set(payload, merge=True)

    def get_installation(self, installation_id: int) -> dict[str, Any] | None:
        snap = self._installations().document(str(installation_id)).get()
        return (snap.to_dict() or {}) if snap.exists else None

    def delete_installation(self, installation_id: int) -> None:
        self._installations().document(str(installation_id)).delete()

    def set_installation_repos(self, installation_id: int, repos: list[str]) -> None:
        self._installations().document(str(installation_id)).set({"repos": sorted(set(repos)), "updated_at": _now()}, merge=True)

    def link_installation_user(self, installation_id: int, user_key: str) -> None:
        self._installations().document(str(installation_id)).set({"user_key": user_key, "updated_at": _now()}, merge=True)

    def list_installations_for_user(self, user_key: str) -> list[dict[str, Any]]:
        query = self._installations().where("user_key", "==", user_key)
        out = []
        for doc in query.stream():
            rec = doc.to_dict() or {}
            out.append({"installation_id": int(doc.id), "account_login": rec.get("account_login"), "repos": rec.get("repos", [])})
        return out


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
