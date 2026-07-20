"""Signed Remediation Receipt (Phase 2.6): Ed25519 sign + independent verify.

Pins that a built receipt verifies, tamper is detected, a bad signature fails,
the invariants live inside the signed payload, and the admission pipeline emits a
verifiable receipt.
"""
from backend.receipt import build_receipt, public_key_b64, sign, verify_receipt, verify_signature


def _envelope():
    return build_receipt(
        repo="owner/repo",
        base_commit="abc123",
        contract={"task_type": "dependency-remediation", "allowed_paths": ["package.json"]},
        contract_result={"passed": True, "contract_hash": "sha256:deadbeef"},
        verifier={"status": "reviewable", "evidence_completeness": 80},
        trust_boundary={"clean": True, "quarantined_count": 0},
        proposed_change={"package": "next", "current": "14.2.5", "fixed": "14.2.33", "cve": "GHSA-x"},
        providers={"advisories": "osv-fixture"},
        authority_level=2,
        authority="branch_pr",
        diff="--- a/package.json\n+++ b/package.json\n",
        advisory_raw={"id": "GHSA-x"},
        outcome="ADMITTED",
    )


def test_receipt_verifies_end_to_end():
    env = _envelope()
    assert env["algorithm"] == "Ed25519" and env["signature"] and env["public_key"]
    result = verify_receipt(env)
    assert result["verified"] is True
    assert result["hash_matches"] is True and result["signature_valid"] is True


def test_receipt_detects_tamper():
    env = _envelope()
    env["receipt"]["authority_level"] = 99  # tamper AFTER signing
    result = verify_receipt(env)
    assert result["verified"] is False
    # The hash no longer matches, and the signature no longer covers the payload.
    assert result["hash_matches"] is False and result["signature_valid"] is False


def test_receipt_rejects_foreign_signature():
    env = _envelope()
    env["signature"] = sign("some other canonical text")  # valid sig, wrong payload
    result = verify_receipt(env)
    assert result["verified"] is False and result["signature_valid"] is False


def test_verify_is_key_pinned_not_self_referential():
    """A self-consistent envelope signed by a FOREIGN key must NOT verify — the
    check pins Umbra's key, so 'some key signed this' is not enough."""
    import base64

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    from backend.receipt import _canonical, _sha256

    env = _envelope()
    # Re-sign the SAME receipt payload with an attacker keypair and swap in that
    # public key + canonical hash so the envelope is internally consistent.
    attacker = Ed25519PrivateKey.generate()
    canonical = _canonical(env["receipt"])
    env["signature"] = base64.b64encode(attacker.sign(canonical.encode())).decode()
    env["canonical_hash"] = _sha256(canonical)
    env["public_key"] = base64.b64encode(
        attacker.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    ).decode()

    result = verify_receipt(env)
    # Internally consistent, but NOT issued by Umbra → rejected.
    assert result["verified"] is False
    assert result["issued_by_umbra"] is False
    assert result["hash_matches"] is True          # the envelope is self-consistent…
    assert result["key_matches_server"] is False   # …but the key isn't Umbra's.



def test_receipt_embeds_invariants_and_hashes():
    env = _envelope()
    r = env["receipt"]
    assert r["auto_merge"] is False and r["human_review_required"] is True
    assert r["diff_hash"].startswith("sha256:") and r["advisory_hash"].startswith("sha256:")
    assert r["policy_hash"] == "sha256:deadbeef"


def test_verify_signature_against_server_key():
    text = "hello umbra"
    sig = sign(text)
    assert verify_signature(text, sig) is True
    assert verify_signature(text, sig, public_key_b64()) is True
    assert verify_signature("tampered", sig) is False
