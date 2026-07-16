"""GitHub App (install-once PR auto-review): token minting, the single app-level
webhook, and installation tracking."""
import hashlib
import hmac as _hmac
import json

from fastapi.testclient import TestClient

from backend.main import app
from backend.store import _MemoryStore, set_store

client = TestClient(app)

_PEM = "-----BEGIN RSA PRIVATE KEY-----\nSUPERSECRETKEYMATERIAL\n-----END RSA PRIVATE KEY-----"
_SECRET = "whsec-test"


def _configure(monkeypatch):
    monkeypatch.setenv("GITHUB_APP_ID", "12345")
    monkeypatch.setenv("GITHUB_APP_SLUG", "umbra-engineer")
    monkeypatch.setenv("GITHUB_APP_WEBHOOK_SECRET", _SECRET)
    monkeypatch.setenv("GITHUB_APP_PRIVATE_KEY", _PEM)


def _sign(body: bytes, secret: str = _SECRET) -> str:
    return "sha256=" + _hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def test_installation_token_mints_and_scrubs_key(monkeypatch):
    """The token is minted from the App private key; if GitHub errors, the private
    key must NOT appear in the raised message."""
    _configure(monkeypatch)
    import github as pygithub

    class FakeToken:
        token = "ghs_installation_token"

    class FakeIntegration:
        def __init__(self, **_):
            pass

        def get_access_token(self, _installation_id):
            return FakeToken()

    monkeypatch.setattr(pygithub, "GithubIntegration", FakeIntegration)
    monkeypatch.setattr(pygithub.Auth, "AppAuth", lambda *a, **k: object())
    from backend.integrations.github_app import installation_token

    assert installation_token(777) == "ghs_installation_token"

    # Now make GitHub raise with the key in the message → RuntimeError must scrub it.
    class BoomIntegration:
        def __init__(self, **_):
            pass

        def get_access_token(self, _id):
            raise RuntimeError(f"auth failed for key {_PEM}")

    monkeypatch.setattr(pygithub, "GithubIntegration", BoomIntegration)
    try:
        installation_token(777)
        raise AssertionError("expected RuntimeError")
    except RuntimeError as exc:
        assert "SUPERSECRETKEYMATERIAL" not in str(exc)


def test_app_webhook_unconfigured_returns_503(monkeypatch):
    for var in ("GITHUB_APP_ID", "GITHUB_APP_WEBHOOK_SECRET", "GITHUB_APP_PRIVATE_KEY"):
        monkeypatch.delenv(var, raising=False)
    r = client.post("/api/github/app/webhook", content=b"{}", headers={"X-GitHub-Event": "ping"})
    assert r.status_code == 503


def test_app_webhook_bad_signature_401(monkeypatch):
    _configure(monkeypatch)
    r = client.post("/api/github/app/webhook", content=b"{}", headers={"X-GitHub-Event": "ping", "X-Hub-Signature-256": "sha256=bad"})
    assert r.status_code == 401


def test_app_webhook_ping_ignored_200(monkeypatch):
    _configure(monkeypatch)
    body = b'{"zen":"hi"}'
    r = client.post("/api/github/app/webhook", content=body, headers={"X-GitHub-Event": "ping", "X-Hub-Signature-256": _sign(body)})
    assert r.status_code == 200 and r.json().get("ignored_event") == "ping"


def test_app_webhook_pull_request_queues_review(monkeypatch):
    _configure(monkeypatch)
    seen: list[tuple] = []

    async def _fake_run(installation_id, repo_url, pr_number):
        seen.append((installation_id, repo_url, pr_number))

    monkeypatch.setattr("backend.main._run_app_review", _fake_run)
    payload = {
        "action": "opened",
        "installation": {"id": 555},
        "repository": {"html_url": "https://github.com/o/r"},
        "pull_request": {"number": 9},
    }
    body = json.dumps(payload).encode()
    r = client.post("/api/github/app/webhook", content=body, headers={"X-GitHub-Event": "pull_request", "X-Hub-Signature-256": _sign(body)})
    assert r.status_code == 200 and r.json().get("queued") == {"pr": 9}
    assert seen == [(555, "https://github.com/o/r", 9)]


def test_app_webhook_installation_event_stores_mapping(monkeypatch):
    _configure(monkeypatch)
    store = _MemoryStore()
    set_store(store)
    try:
        payload = {
            "action": "created",
            "installation": {"id": 321, "account": {"login": "octo-org", "type": "Organization"}},
            "repositories": [{"full_name": "octo-org/api"}, {"full_name": "octo-org/web"}],
        }
        body = json.dumps(payload).encode()
        r = client.post("/api/github/app/webhook", content=body, headers={"X-GitHub-Event": "installation", "X-Hub-Signature-256": _sign(body)})
        assert r.status_code == 200
        rec = store.get_installation(321)
        assert rec["account_login"] == "octo-org" and rec["repos"] == ["octo-org/api", "octo-org/web"]
    finally:
        set_store(_MemoryStore())


def test_app_installations_store_roundtrip():
    s = _MemoryStore()
    s.put_installation(10, "octocat", "User", ["octocat/a"], user_key="github:1")
    s.set_installation_repos(10, ["octocat/a", "octocat/b"])
    s.link_installation_user(10, "github:1")
    listed = s.list_installations_for_user("github:1")
    assert listed == [{"installation_id": 10, "account_login": "octocat", "repos": ["octocat/a", "octocat/b"]}]
    assert s.list_installations_for_user("github:2") == []
    s.delete_installation(10)
    assert s.get_installation(10) is None and s.list_installations_for_user("github:1") == []


def test_github_app_info_reflects_config(monkeypatch):
    _configure(monkeypatch)
    body = client.get("/api/github/app").json()
    assert body["configured"] is True
    assert body["install_url"] == "https://github.com/apps/umbra-engineer/installations/new"
