import asyncio
import types
from contextlib import contextmanager

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import github as pygithub  # PyGithub top-level package

from backend import auth, settings
from backend.agents.janitor import Janitor
from backend.agents.watchman import Watchman
from backend.integrations import github as gh
from backend.integrations.repository import _scrub
from backend.main import _user_context, app
from backend.reasoning import ReasoningResult
from backend.store import _MemoryStore, set_store

client = TestClient(app)


def test_api_me_requires_auth():
    assert client.get("/api/me").status_code == 401


def test_my_repos_requires_auth():
    assert client.get("/api/my/repos").status_code == 401


def test_my_scans_requires_auth():
    assert client.get("/api/my/scans").status_code == 401


def test_get_current_user_reads_session():
    req = types.SimpleNamespace(session={"user": {"sub": "1", "provider": "github", "name": "Dev"}})
    assert auth.get_current_user(req)["name"] == "Dev"
    with pytest.raises(HTTPException):
        auth.get_current_user(types.SimpleNamespace(session={}))


def test_login_unknown_provider_is_404():
    assert client.get("/auth/login/twitter", follow_redirects=False).status_code == 404


def test_login_github_redirects_to_github(monkeypatch):
    monkeypatch.setenv("GITHUB_CLIENT_ID", "test-id")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "test-secret")
    auth._registered.discard("github")  # force re-registration with test creds
    response = client.get("/auth/login/github", follow_redirects=False)
    assert response.status_code in (302, 307)
    assert "github.com/login/oauth/authorize" in response.headers["location"]


def test_denied_consent_falls_back_to_landing(monkeypatch):
    monkeypatch.setenv("GITHUB_CLIENT_ID", "test-id")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "test-secret")
    auth._registered.discard("github")
    response = client.get("/auth/callback/github?error=access_denied", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"].endswith("/")


def test_cloud_scan_relaxes_gate_without_codex(monkeypatch):
    monkeypatch.setenv("UMBRA_DEMO_MODE", "false")
    monkeypatch.setenv("UMBRA_ENABLE_LIVE_REPOS", "true")
    monkeypatch.setenv("UMBRA_ENABLE_CLOUD_SCAN", "true")
    monkeypatch.delenv("UMBRA_ENABLE_CODEX_CLI", raising=False)
    assert Watchman._live_enabled() is True  # real OSV findings, no Codex
    assert Janitor._live_enabled() is False  # Codex-only, deliberately stays demo


def test_demo_mode_overrides_cloud_scan(monkeypatch):
    monkeypatch.setenv("UMBRA_DEMO_MODE", "true")
    monkeypatch.setenv("UMBRA_ENABLE_LIVE_REPOS", "true")
    monkeypatch.setenv("UMBRA_ENABLE_CLOUD_SCAN", "true")
    assert Watchman._live_enabled() is False  # demo stays pure


def test_list_user_repos_includes_private_with_flag(monkeypatch):
    class FakeRepo:
        def __init__(self, name, private):
            self.name = name
            self.full_name = f"u/{name}"
            self.html_url = f"https://github.com/u/{name}"
            self.private = private
            self.stargazers_count = 7

    class FakeUser:
        def get_repos(self, **_kw):
            return [FakeRepo("public-one", False), FakeRepo("secret", True)]

    class FakeGithub:
        def __init__(self, _token, **_kwargs):  # tolerate per_page/retry kwargs
            pass

        def get_user(self):
            return FakeUser()

    monkeypatch.setattr(pygithub, "Github", FakeGithub)
    repos = gh.list_user_repos("tok")
    # Private repos are now INCLUDED (users scan their own code) with a flag the
    # UI uses to show a lock badge.
    assert [r["name"] for r in repos] == ["public-one", "secret"]
    assert repos[1]["private"] is True and repos[0]["private"] is False


def test_list_user_repos_retries_without_filters(monkeypatch):
    # Some tokens/orgs reject visibility/affiliation filters; the list must still
    # come back via the unfiltered retry rather than failing outright.
    class FakeRepo:
        def __init__(self, name):
            self.name = name
            self.full_name = f"u/{name}"
            self.html_url = f"https://github.com/u/{name}"
            self.private = False
            self.stargazers_count = 0

    class FakeUser:
        def get_repos(self, **kw):
            if "visibility" in kw or "affiliation" in kw:
                raise Exception("422 filters not allowed for this token")
            return [FakeRepo("only-one")]

    class FakeGithub:
        def __init__(self, _token, **_kwargs):  # tolerate per_page/retry kwargs
            pass

        def get_user(self):
            return FakeUser()

    monkeypatch.setattr(pygithub, "Github", FakeGithub)
    assert [r["name"] for r in gh.list_user_repos("tok")] == ["only-one"]


def test_list_user_repos_degrades_to_owner_only_on_503(monkeypatch):
    # The expensive visibility=all+affiliation enumeration is what GitHub 503s on;
    # a failure there must degrade to the cheap owner-only query, not error out.
    class FakeRepo:
        def __init__(self, name):
            self.name = name
            self.full_name = f"u/{name}"
            self.html_url = f"https://github.com/u/{name}"
            self.private = False
            self.stargazers_count = 0

    class FakeUser:
        def get_repos(self, **kw):
            if kw.get("visibility") == "all":  # the broad query GitHub 503s on
                raise Exception("Max retries exceeded (too many 503 error responses)")
            if kw.get("affiliation") == "owner":
                return [FakeRepo("my-repo")]
            raise AssertionError("should have succeeded on the owner-only query")

    class FakeGithub:
        def __init__(self, _token, **_kwargs):
            pass

        def get_user(self):
            return FakeUser()

    monkeypatch.setattr(pygithub, "Github", FakeGithub)
    assert [r["name"] for r in gh.list_user_repos("tok")] == ["my-repo"]


def test_memory_store_roundtrip():
    store = _MemoryStore()
    store.get_or_create_user("github:1", {"name": "A", "provider": "github"})
    store.put_github_token("github:1", "tok")
    assert store.get_github_token("github:1") == "tok"
    store.save_scan("github:1", {"repo_full_name": "u/r", "umbra_score": 80})
    scans = store.list_scans("github:1")
    assert scans and scans[0]["repo_full_name"] == "u/r" and "ran_at" in scans[0]
    # Every saved scan gets a stable id so the UI can delete individual scans.
    assert scans[0].get("scan_id")


def test_delete_scans_removes_only_selected():
    store = _MemoryStore()
    store.save_scan("github:1", {"repo_full_name": "u/a"})
    store.save_scan("github:1", {"repo_full_name": "u/b"})
    scans = store.list_scans("github:1")
    target = scans[0]["scan_id"]
    store.delete_scans("github:1", [target])
    remaining = store.list_scans("github:1")
    assert len(remaining) == 1 and remaining[0]["scan_id"] != target


def test_remediation_dismissals_roundtrip():
    store = _MemoryStore()
    store.dismiss_remediations("github:1", ["u/a:lodash@1:CVE-1", "u/a:x@2:CVE-2"])
    assert set(store.list_dismissed_remediations("github:1")) == {"u/a:lodash@1:CVE-1", "u/a:x@2:CVE-2"}
    store.restore_remediations("github:1", ["u/a:x@2:CVE-2"])
    assert store.list_dismissed_remediations("github:1") == ["u/a:lodash@1:CVE-1"]
    # Scoped strictly to the caller — another user sees nothing.
    assert store.list_dismissed_remediations("github:2") == []


def test_selective_clear_and_dismissal_endpoints_require_auth():
    assert client.post("/api/my/scans/delete", json={"scan_ids": ["x"]}).status_code == 401
    assert client.get("/api/my/remediation-dismissals").status_code == 401
    assert client.post("/api/my/remediation-dismissals", json={"keys": ["x"]}).status_code == 401
    assert client.post("/api/my/remediation-dismissals/restore", json={"keys": ["x"]}).status_code == 401


# --- v2: encryption, BYO key, founder gate, private-repo token handling -------

def test_encrypt_decrypt_roundtrip():
    ciphertext = settings.encrypt("s3cret-token")
    assert ciphertext != "s3cret-token"
    assert settings.decrypt(ciphertext) == "s3cret-token"


def test_store_encrypts_secrets_at_rest():
    store = _MemoryStore()
    store.put_github_token("github:1", "ghp_realtoken")
    store.put_openai_key("github:1", "sk-openaikey")
    # Raw stored values are ciphertext, never the plaintext secret.
    assert store._tokens["github:1"] != "ghp_realtoken"
    assert store._openai_keys["github:1"] != "sk-openaikey"
    # Accessors return the plaintext.
    assert store.get_github_token("github:1") == "ghp_realtoken"
    assert store.get_openai_key("github:1") == "sk-openaikey"
    store.clear_openai_key("github:1")
    assert store.get_openai_key("github:1") is None


def test_founder_ids_parsing(monkeypatch):
    monkeypatch.setenv("UMBRA_FOUNDER_IDS", "github:1, google:abc ,")
    assert settings.founder_ids() == {"github:1", "google:abc"}
    monkeypatch.delenv("UMBRA_FOUNDER_IDS", raising=False)
    assert settings.founder_ids() == set()


def test_user_context_founder_gate(monkeypatch):
    set_store(_MemoryStore())
    monkeypatch.setenv("UMBRA_FOUNDER_IDS", "github:42")
    monkeypatch.setenv("UMBRA_ENABLE_CODEX_CLI", "true")
    founder = types.SimpleNamespace(session={"user": {"provider": "github", "sub": "42"}})
    other = types.SimpleNamespace(session={"user": {"provider": "github", "sub": "99"}})
    anon = types.SimpleNamespace(session={})
    assert _user_context(founder)["allow_codex"] is True   # founder → may spend server Codex credits
    assert _user_context(other)["allow_codex"] is False    # other signed-in user → blocked
    assert _user_context(anon)["allow_codex"] is False      # anonymous on hosted deploy → blocked
    set_store(_MemoryStore())  # reset global for other tests


def test_user_context_local_dev_is_permissive(monkeypatch):
    monkeypatch.delenv("UMBRA_FOUNDER_IDS", raising=False)
    anon = types.SimpleNamespace(session={})
    # No allowlist configured (local dev) → None so the CLI's own env gate applies.
    assert _user_context(anon)["allow_codex"] is None


def test_clone_error_scrubs_token():
    scrubbed = _scrub("fatal: unable to access https://x-access-token:ghp_secret@github.com/x", "ghp_secret")
    assert "ghp_secret" not in scrubbed and "***" in scrubbed


def test_openai_key_endpoints_require_auth():
    assert client.post("/api/my/openai-key", json={"api_key": "sk-" + "x" * 24}).status_code == 401
    assert client.delete("/api/my/openai-key").status_code == 401


def test_connect_github_requires_auth():
    assert client.get("/auth/connect/github", follow_redirects=False).status_code == 401


def test_clear_scans_removes_only_that_users_history():
    store = _MemoryStore()
    store.save_scan("github:1", {"repo_full_name": "u/r1"})
    store.save_scan("github:2", {"repo_full_name": "u/r2"})
    store.clear_scans("github:1")
    assert store.list_scans("github:1") == []  # gone
    kept = store.list_scans("github:2")
    assert kept and kept[0]["repo_full_name"] == "u/r2"  # other users untouched


def test_clear_scans_endpoint_requires_auth():
    assert client.delete("/api/my/scans").status_code == 401


def test_agent_reuses_propose_summary_as_reasoning_without_key(monkeypatch, tmp_path):
    # Fast path: a successful live propose supplies the reasoning, so the agent
    # makes exactly ONE Codex call (analyze must not run) when there is no BYO key.
    from datetime import UTC, datetime

    from backend.codex_client import CodexOperation

    monkeypatch.setenv("UMBRA_DEMO_MODE", "false")
    monkeypatch.setenv("UMBRA_ENABLE_LIVE_REPOS", "true")
    monkeypatch.setenv("UMBRA_ENABLE_CODEX_CLI", "true")

    @contextmanager
    def checkout(_, __=None):
        yield tmp_path

    class OneCallCodex:
        def __init__(self):
            self.analyze_calls = 0

        def propose(self, *_a, **_k):
            return CodexOperation("cleanup", "Removed an unused import in a.py; ran tests.", "diff", True, ["a.py"], "codex-cli", datetime.now(UTC).isoformat())

        def analyze(self, *_a, **_k):
            self.analyze_calls += 1
            raise AssertionError("analyze must not run on the reuse fast path")

    monkeypatch.setattr("backend.agents.janitor.checkout_public_repo", checkout)
    codex = OneCallCodex()
    agent = Janitor(codex=codex)
    monkeypatch.setattr(agent, "_live_enabled", lambda: True)
    result = asyncio.run(agent.run("https://github.com/a/b"))
    assert codex.analyze_calls == 0
    assert result.replay.providers["reasoning"] == "codex-cli"
    assert result.replay.reasoning == "Removed an unused import in a.py; ran tests."


def test_watchman_allow_codex_false_never_spends_founder_codex(monkeypatch, tmp_path):
    (tmp_path / "package.json").write_text('{"dependencies":{"express":"5.1.0"}}')

    @contextmanager
    def checkout(_, __=None):
        yield tmp_path

    class FakeOSV:
        async def query(self, *_):
            return []

    class BoomCodex:
        def propose(self, *a, **k):
            raise AssertionError("Codex must not run when allow_codex is False")

    monkeypatch.setattr("backend.agents.watchman.checkout_public_repo", checkout)
    monkeypatch.setattr("backend.agents.watchman.reason", lambda *a: ReasoningResult("ok", "m", "high", "responses-api"))
    agent = Watchman(codex=BoomCodex(), osv=FakeOSV())
    monkeypatch.setattr(agent, "_live_enabled", lambda: True)
    result = asyncio.run(agent.run("https://github.com/a/b", allow_codex=False))
    assert result.replay.providers["engineering"] == "unavailable"
