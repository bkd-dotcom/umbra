"""Signed Remediation Receipt — a proof-carrying record of one AI-proposed change.

An Evidence Pack shows *what* Umbra did; a Remediation Receipt makes that record
**independently verifiable**. It gathers the accountability chain for a single
proposed change — repository + base commit, the policy/contract that applied, the
advisory evidence, the exact diff, the independent verifier result, the earned
authority, and the human decision — canonicalizes it, and signs it with an
Ed25519 key held by the server. Anyone can fetch the public key from
``/api/verify-key`` and verify the signature offline.

Why signing (not just a hash): a bare SHA-256 proves a document wasn't *accidentally*
altered, but anyone can recompute it after editing. An Ed25519 signature proves the
receipt was produced by the holder of Umbra's private key and has not changed since.

Honesty: the receipt records whether the signing key is the managed production key
or the deterministic dev fallback (``key_ephemeral``), so a reviewer never
over-trusts a dev-signed receipt. Invariant: ``auto_merge`` is always false.
"""
from __future__ import annotations

import base64
import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from backend.settings import signing_key_is_ephemeral, signing_seed


def _sha256(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def _canonical(payload: dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str, ensure_ascii=False)


def _private_key():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    return Ed25519PrivateKey.from_private_bytes(signing_seed())


def public_key_b64() -> str:
    """Base64 of the raw 32-byte Ed25519 public key — served at /api/verify-key."""
    from cryptography.hazmat.primitives import serialization

    pub = _private_key().public_key()
    raw = pub.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return base64.b64encode(raw).decode()


def sign(canonical_text: str) -> str:
    """Ed25519 signature of ``canonical_text``, base64-encoded."""
    return base64.b64encode(_private_key().sign(canonical_text.encode("utf-8"))).decode()


def verify_signature(canonical_text: str, signature_b64: str, public_key_b64_str: str | None = None) -> bool:
    """Verify an Ed25519 signature over ``canonical_text`` against a public key
    (defaults to this server's current public key). Never raises."""
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    try:
        raw = base64.b64decode(public_key_b64_str or public_key_b64())
        sig = base64.b64decode(signature_b64)
        Ed25519PublicKey.from_public_bytes(raw).verify(sig, canonical_text.encode("utf-8"))
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


def build_receipt(
    *,
    repo: str,
    base_commit: str | None,
    contract: dict[str, Any],
    contract_result: dict[str, Any],
    verifier: dict[str, Any] | None,
    trust_boundary: dict[str, Any] | None,
    proposed_change: dict[str, Any] | None,
    providers: dict[str, str] | None,
    authority_level: int,
    authority: str,
    diff: str | None = None,
    advisory_raw: Any | None = None,
    human_decision: str | None = None,
    pr_url: str | None = None,
    outcome: str | None = None,
) -> dict[str, Any]:
    """Assemble and sign a Remediation Receipt.

    Returns ``{receipt, canonical_hash, signature, public_key, algorithm,
    key_ephemeral}``. The signature covers the canonical JSON of ``receipt`` (which
    itself includes content hashes of the diff and raw advisory, so signing the
    receipt transitively binds those artifacts)."""
    receipt: dict[str, Any] = {
        "kind": "umbra.remediation-receipt",
        "version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "repo": repo,
        "base_commit": base_commit,
        "policy_hash": contract_result.get("contract_hash"),
        "contract": contract,
        "contract_result": contract_result,
        "trust_boundary": trust_boundary,
        "verifier": verifier,
        "proposed_change": proposed_change,
        "provider_ledger": providers or {},
        "diff_hash": _sha256(diff) if diff else None,
        "advisory_hash": _sha256(_canonical(advisory_raw)) if advisory_raw is not None else None,
        "authority_level": authority_level,
        "authority": authority,
        "human_decision": human_decision,
        "pr_url": pr_url,
        "outcome": outcome,
        # Invariants, stated in the signed payload so they can't be quietly dropped.
        "auto_merge": False,
        "human_review_required": True,
    }
    canonical = _canonical(receipt)
    canonical_hash = _sha256(canonical)
    signature = sign(canonical)
    return {
        "receipt": receipt,
        "canonical_hash": canonical_hash,
        "signature": signature,
        "public_key": public_key_b64(),
        "algorithm": "Ed25519",
        "key_ephemeral": signing_key_is_ephemeral(),
    }


def verify_receipt(envelope: dict[str, Any]) -> dict[str, Any]:
    """Independently verify a signed receipt envelope.

    Recomputes the canonical hash of ``envelope['receipt']`` and checks the
    Ed25519 signature against the provided (or server) public key. Returns
    ``{verified, hash_matches, signature_valid, computed_hash, ...}``."""
    receipt = envelope.get("receipt")
    signature = envelope.get("signature")
    claimed_hash = envelope.get("canonical_hash")
    public_key = envelope.get("public_key")
    if not isinstance(receipt, dict) or not signature:
        return {"verified": False, "hash_matches": False, "signature_valid": False, "reason": "Receipt or signature missing."}
    canonical = _canonical(receipt)
    computed_hash = _sha256(canonical)
    hash_matches = bool(claimed_hash) and claimed_hash == computed_hash
    signature_valid = verify_signature(canonical, str(signature), public_key)
    return {
        "verified": bool(signature_valid and (hash_matches or not claimed_hash)),
        "hash_matches": hash_matches,
        "signature_valid": signature_valid,
        "computed_hash": computed_hash,
        "claimed_hash": claimed_hash,
        "algorithm": envelope.get("algorithm", "Ed25519"),
        "key_ephemeral": envelope.get("key_ephemeral"),
    }
