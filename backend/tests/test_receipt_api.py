"""Receipt + verify-key API (Phase 2.6)."""
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_verify_key_endpoint_returns_public_key():
    r = client.get("/api/verify-key")
    assert r.status_code == 200
    body = r.json()
    assert body["algorithm"] == "Ed25519" and body["public_key"]
    assert "ephemeral" in body


def test_admission_emits_verifiable_receipt():
    admit = client.post("/api/admit", json={"fixture": "permitted-dependency-fix"}).json()
    assert "receipt" in admit
    env = admit["receipt"]
    assert env["algorithm"] == "Ed25519" and env["signature"]
    # The receipt is independently verifiable through the public endpoint.
    verified = client.post("/api/receipt/verify", json={"envelope": env}).json()
    assert verified["verified"] is True and verified["signature_valid"] is True


def test_receipt_verify_detects_tamper_over_api():
    admit = client.post("/api/admit", json={"fixture": "permitted-dependency-fix"}).json()
    env = admit["receipt"]
    env["receipt"]["authority_level"] = 3  # tamper
    verified = client.post("/api/receipt/verify", json={"envelope": env}).json()
    assert verified["verified"] is False
