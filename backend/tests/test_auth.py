import types

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import github as pygithub  # PyGithub top-level package

from backend import auth
from backend.agents.janitor import Janitor
from backend.agents.watchman import Watchman
from backend.integrations import github as gh
from backend.main import app
from backend.store import _MemoryStore

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


def test_list_user_repos_filters_private(monkeypatch):
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
        def __init__(self, _token):
            pass

        def get_user(self):
            return FakeUser()

    monkeypatch.setattr(pygithub, "Github", FakeGithub)
    repos = gh.list_user_repos("tok")
    assert [r["name"] for r in repos] == ["public-one"]
    assert repos[0]["full_name"] == "u/public-one" and repos[0]["stars"] == 7


def test_memory_store_roundtrip():
    store = _MemoryStore()
    store.get_or_create_user("github:1", {"name": "A", "provider": "github"})
    store.put_github_token("github:1", "tok")
    assert store.get_github_token("github:1") == "tok"
    store.save_scan("github:1", {"repo_full_name": "u/r", "umbra_score": 80})
    scans = store.list_scans("github:1")
    assert scans and scans[0]["repo_full_name"] == "u/r" and "ran_at" in scans[0]
