"""Scheduler authentication for POST /api/cron/run-due-scans.

Production authenticates the scheduler with a Google OIDC token from a dedicated
service account (verified via google-auth against Google's certs); a legacy shared
key remains only as a local-dev / backwards-compat fallback. These tests mock the
google-auth token verification — nothing here touches the network or Google.
"""
import pytest

from backend import scheduler_auth


def _patch_verify(monkeypatch, claims=None, raises=None):
    """Patch google.oauth2.id_token.verify_oauth2_token used inside
    _verify_google_oidc (imported lazily there, so patch the source module)."""
    from google.oauth2 import id_token as g_id_token

    def fake(token, request, audience=None):
        if raises:
            raise raises
        return claims or {}

    monkeypatch.setattr(g_id_token, "verify_oauth2_token", fake)


SA = "umbra-scheduler@proj.iam.gserviceaccount.com"


# --- OIDC (production) -------------------------------------------------------
def test_oidc_valid_scheduler_identity_accepted(monkeypatch):
    monkeypatch.setenv("UMBRA_SCHEDULER_SERVICE_ACCOUNT", SA)
    monkeypatch.setenv("UMBRA_SCHEDULER_OIDC_AUDIENCE", "https://umbra.example")
    monkeypatch.delenv("UMBRA_CRON_KEY", raising=False)
    _patch_verify(monkeypatch, claims={"iss": "https://accounts.google.com", "email": SA, "email_verified": True})

    res = scheduler_auth.authenticate_scheduler(f"Bearer good.token", "")
    assert res.ok and res.method == "oidc"


def test_oidc_wrong_service_account_rejected(monkeypatch):
    monkeypatch.setenv("UMBRA_SCHEDULER_SERVICE_ACCOUNT", SA)
    monkeypatch.setenv("UMBRA_SCHEDULER_OIDC_AUDIENCE", "https://umbra.example")
    monkeypatch.delenv("UMBRA_CRON_KEY", raising=False)
    _patch_verify(monkeypatch, claims={"iss": "https://accounts.google.com", "email": "attacker@evil.iam.gserviceaccount.com", "email_verified": True})

    res = scheduler_auth.authenticate_scheduler("Bearer other.token", "")
    assert not res.ok and res.reason == "oidc-wrong-identity"


def test_oidc_unverified_email_rejected(monkeypatch):
    monkeypatch.setenv("UMBRA_SCHEDULER_SERVICE_ACCOUNT", SA)
    monkeypatch.setenv("UMBRA_SCHEDULER_OIDC_AUDIENCE", "https://umbra.example")
    monkeypatch.delenv("UMBRA_CRON_KEY", raising=False)
    _patch_verify(monkeypatch, claims={"iss": "https://accounts.google.com", "email": SA, "email_verified": False})

    res = scheduler_auth.authenticate_scheduler("Bearer x", "")
    assert not res.ok and res.reason == "oidc-email-unverified"


def test_oidc_bad_issuer_rejected(monkeypatch):
    monkeypatch.setenv("UMBRA_SCHEDULER_SERVICE_ACCOUNT", SA)
    monkeypatch.setenv("UMBRA_SCHEDULER_OIDC_AUDIENCE", "https://umbra.example")
    monkeypatch.delenv("UMBRA_CRON_KEY", raising=False)
    _patch_verify(monkeypatch, claims={"iss": "https://evil.example", "email": SA, "email_verified": True})

    res = scheduler_auth.authenticate_scheduler("Bearer x", "")
    assert not res.ok and res.reason == "oidc-bad-issuer"


def test_oidc_invalid_token_rejected(monkeypatch):
    monkeypatch.setenv("UMBRA_SCHEDULER_SERVICE_ACCOUNT", SA)
    monkeypatch.setenv("UMBRA_SCHEDULER_OIDC_AUDIENCE", "https://umbra.example")
    monkeypatch.delenv("UMBRA_CRON_KEY", raising=False)
    _patch_verify(monkeypatch, raises=ValueError("bad signature / expired / wrong audience"))

    res = scheduler_auth.authenticate_scheduler("Bearer tampered", "")
    assert not res.ok and res.reason == "oidc-invalid"


def test_oidc_missing_token_rejected(monkeypatch):
    monkeypatch.setenv("UMBRA_SCHEDULER_SERVICE_ACCOUNT", SA)
    monkeypatch.setenv("UMBRA_SCHEDULER_OIDC_AUDIENCE", "https://umbra.example")
    monkeypatch.delenv("UMBRA_CRON_KEY", raising=False)
    # No Authorization header, OIDC-only → hard reject (not publicly triggerable).
    res = scheduler_auth.authenticate_scheduler("", "")
    assert not res.ok and res.reason == "oidc-missing-token"


# --- legacy shared key (local dev / backwards-compat) -----------------------
def test_legacy_key_accepted_when_set(monkeypatch):
    monkeypatch.delenv("UMBRA_SCHEDULER_SERVICE_ACCOUNT", raising=False)
    monkeypatch.setenv("UMBRA_CRON_KEY", "local-secret")

    ok = scheduler_auth.authenticate_scheduler("", "local-secret")
    assert ok.ok and ok.method == "legacy-key"
    bad = scheduler_auth.authenticate_scheduler("", "wrong")
    assert not bad.ok and bad.reason == "legacy-key-mismatch"


def test_unconfigured_is_not_publicly_triggerable(monkeypatch):
    monkeypatch.delenv("UMBRA_SCHEDULER_SERVICE_ACCOUNT", raising=False)
    monkeypatch.delenv("UMBRA_CRON_KEY", raising=False)
    res = scheduler_auth.authenticate_scheduler("", "")
    assert not res.ok and res.reason == "unconfigured"


def test_oidc_preferred_but_legacy_key_still_works_when_both_set(monkeypatch):
    """With both configured, a valid legacy key still authorizes (backwards-compat),
    and a valid OIDC token also authorizes."""
    monkeypatch.setenv("UMBRA_SCHEDULER_SERVICE_ACCOUNT", SA)
    monkeypatch.setenv("UMBRA_SCHEDULER_OIDC_AUDIENCE", "https://umbra.example")
    monkeypatch.setenv("UMBRA_CRON_KEY", "local-secret")
    # No OIDC token, but a valid legacy key → accepted via fallback.
    res = scheduler_auth.authenticate_scheduler("", "local-secret")
    assert res.ok and res.method == "legacy-key"


# --- endpoint integration ---------------------------------------------------
def test_endpoint_401_on_bad_scheduler_auth(monkeypatch):
    from fastapi.testclient import TestClient
    from backend import main

    monkeypatch.setenv("UMBRA_SCHEDULER_SERVICE_ACCOUNT", SA)
    monkeypatch.setenv("UMBRA_SCHEDULER_OIDC_AUDIENCE", "https://umbra.example")
    monkeypatch.delenv("UMBRA_CRON_KEY", raising=False)
    client = TestClient(main.app)
    # No token → 401 (configured, but unauthenticated), never 200.
    r = client.post("/api/cron/run-due-scans")
    assert r.status_code == 401


def test_endpoint_503_when_unconfigured(monkeypatch):
    from fastapi.testclient import TestClient
    from backend import main

    monkeypatch.delenv("UMBRA_SCHEDULER_SERVICE_ACCOUNT", raising=False)
    monkeypatch.delenv("UMBRA_CRON_KEY", raising=False)
    client = TestClient(main.app)
    r = client.post("/api/cron/run-due-scans")
    assert r.status_code == 503


# --- OIDC fail-closed configuration -----------------------------------------
def test_oidc_service_account_only_is_unconfigured(monkeypatch):
    """SA without an audience is INCOMPLETE — not an enabled OIDC mode."""
    from backend import settings
    monkeypatch.setenv("UMBRA_SCHEDULER_SERVICE_ACCOUNT", SA)
    monkeypatch.delenv("UMBRA_SCHEDULER_OIDC_AUDIENCE", raising=False)
    monkeypatch.delenv("UMBRA_PUBLIC_URL", raising=False)  # audience must not resolve
    monkeypatch.delenv("UMBRA_CRON_KEY", raising=False)
    assert settings.scheduler_oidc_enabled() is False
    res = scheduler_auth.authenticate_scheduler("Bearer x", "")
    assert not res.ok and res.reason == "unconfigured"


def test_oidc_audience_only_is_unconfigured(monkeypatch):
    """Audience without a service account is INCOMPLETE."""
    from backend import settings
    monkeypatch.delenv("UMBRA_SCHEDULER_SERVICE_ACCOUNT", raising=False)
    monkeypatch.setenv("UMBRA_SCHEDULER_OIDC_AUDIENCE", "https://umbra.example")
    monkeypatch.delenv("UMBRA_CRON_KEY", raising=False)
    assert settings.scheduler_oidc_enabled() is False
    res = scheduler_auth.authenticate_scheduler("Bearer x", "")
    assert not res.ok and res.reason == "unconfigured"


def test_oidc_both_present_enables_verification_with_nonempty_audience(monkeypatch):
    """Both present → OIDC path runs AND verify_oauth2_token gets a non-empty aud."""
    from backend import settings
    from google.oauth2 import id_token as g_id_token
    monkeypatch.setenv("UMBRA_SCHEDULER_SERVICE_ACCOUNT", SA)
    monkeypatch.setenv("UMBRA_SCHEDULER_OIDC_AUDIENCE", "https://umbra.example")
    monkeypatch.delenv("UMBRA_CRON_KEY", raising=False)
    assert settings.scheduler_oidc_enabled() is True

    seen = {}
    def fake(token, request, audience=None):
        seen["audience"] = audience
        return {"iss": "https://accounts.google.com", "email": SA, "email_verified": True}
    monkeypatch.setattr(g_id_token, "verify_oauth2_token", fake)

    res = scheduler_auth.authenticate_scheduler("Bearer good", "")
    assert res.ok and res.method == "oidc"
    assert seen["audience"] == "https://umbra.example"  # never None/empty
    assert seen["audience"]  # non-empty


# --- scheduling_configured() drives the auth payload ------------------------
def test_scheduling_enabled_true_for_complete_oidc(monkeypatch):
    from backend import settings
    monkeypatch.setenv("UMBRA_SCHEDULER_SERVICE_ACCOUNT", SA)
    monkeypatch.setenv("UMBRA_SCHEDULER_OIDC_AUDIENCE", "https://umbra.example")
    monkeypatch.delenv("UMBRA_CRON_KEY", raising=False)
    assert settings.scheduling_configured() is True


def test_scheduling_enabled_false_for_incomplete_oidc_no_legacy(monkeypatch):
    from backend import settings
    monkeypatch.setenv("UMBRA_SCHEDULER_SERVICE_ACCOUNT", SA)  # SA only, no audience
    monkeypatch.delenv("UMBRA_SCHEDULER_OIDC_AUDIENCE", raising=False)
    monkeypatch.delenv("UMBRA_PUBLIC_URL", raising=False)
    monkeypatch.delenv("UMBRA_CRON_KEY", raising=False)
    assert settings.scheduling_configured() is False


def test_scheduling_enabled_true_for_legacy_key(monkeypatch):
    from backend import settings
    monkeypatch.delenv("UMBRA_SCHEDULER_SERVICE_ACCOUNT", raising=False)
    monkeypatch.setenv("UMBRA_CRON_KEY", "local-secret")
    assert settings.scheduling_configured() is True
