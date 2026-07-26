"""Slack notification delivery — honest states + fail-closed webhook validation.

The notifier never raises, never fakes success, and only posts to a Slack-hosted
webhook. Governed data (verdict, receipt facts) is restated, never over-claimed.
"""
import httpx

from backend.notifications import (
    DELIVERY_ACCEPTED,
    DELIVERY_EMAIL_REJECTED,
    DELIVERY_EMAIL_UNAVAILABLE,
    build_admission_slack_blocks,
    build_brake_slack_blocks,
    notify_slack,
)
from backend.settings import slack_webhook_url


def test_slack_unavailable_without_webhook(monkeypatch):
    monkeypatch.delenv("UMBRA_SLACK_WEBHOOK_URL", raising=False)
    assert notify_slack({"text": "hi"}) == DELIVERY_EMAIL_UNAVAILABLE


def test_slack_webhook_must_be_slack_hosted(monkeypatch):
    # Fail-closed: a non-Slack URL is ignored so governed data can't be POSTed elsewhere.
    monkeypatch.setenv("UMBRA_SLACK_WEBHOOK_URL", "https://evil.example.com/hook")
    assert slack_webhook_url() is None
    assert notify_slack({"text": "hi"}) == DELIVERY_EMAIL_UNAVAILABLE

    monkeypatch.setenv("UMBRA_SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/xxx")
    assert slack_webhook_url() == "https://hooks.slack.com/services/T/B/xxx"


def test_slack_accepted_on_200(monkeypatch):
    monkeypatch.setenv("UMBRA_SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/xxx")

    class _Resp:
        status_code = 200
        text = "ok"

    posted = {}

    def _post(url, json=None, timeout=None):
        posted["url"] = url
        posted["json"] = json
        return _Resp()

    monkeypatch.setattr(httpx, "post", _post)
    assert notify_slack({"text": "hi"}) == DELIVERY_ACCEPTED
    assert posted["url"].startswith("https://hooks.slack.com/")


def test_slack_rejected_on_error(monkeypatch):
    monkeypatch.setenv("UMBRA_SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/xxx")

    class _Resp:
        status_code = 500
        text = "boom"

    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp())
    assert notify_slack({"text": "hi"}) == DELIVERY_EMAIL_REJECTED


def test_slack_never_raises(monkeypatch):
    monkeypatch.setenv("UMBRA_SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/xxx")

    def _boom(*a, **k):
        raise RuntimeError("network down")

    monkeypatch.setattr(httpx, "post", _boom)
    assert notify_slack({"text": "hi"}) == DELIVERY_EMAIL_REJECTED  # caught, honest state


def test_admission_blocks_restate_the_pack():
    report = {
        "repo": "acme/app", "executor": "codex-cli", "authority_level": 2,
        "contract_result": {"passed": True}, "trust_boundary": {"clean": True, "quarantined_count": 0},
        "verifier": {"blocked": False, "hijack_signal": False}, "outcome": "ADMITTED (branch PR)",
    }
    payload = build_admission_slack_blocks(report, view_url="https://umbra.engineer/dashboard/")
    text = payload["text"]
    assert "acme/app" in text and "Branch-PR (L2)" in text
    assert "auto_merge is false" in text
    assert payload["blocks"][-1]["elements"][0]["url"].startswith("https://umbra.engineer")


def test_admission_blocks_surface_hijack_signal():
    report = {
        "repo": "acme/app", "executor": "codex-cli", "authority_level": 1,
        "contract_result": {"passed": True}, "trust_boundary": {"clean": False, "quarantined_count": 2},
        "verifier": {"blocked": False, "hijack_signal": True}, "outcome": "ADMITTED (analyze)",
    }
    text = build_admission_slack_blocks(report)["text"]
    assert "hijack signal" in text
    assert "2 quarantined" in text


def test_brake_block():
    text = build_brake_slack_blocks("acme/app", "looked wrong at 2am", actor="binay")["text"]
    assert "emergency brake" in text.lower()
    assert "acme/app" in text and "binay" in text and "re-run" in text
