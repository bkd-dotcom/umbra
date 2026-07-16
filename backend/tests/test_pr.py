import asyncio
from contextlib import contextmanager

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.orchestrator import orchestrator

client = TestClient(app)


def test_open_pr_requires_auth():
    resp = client.post("/api/my/pr", json={"repo_url": "https://github.com/a/b", "mode": "bump", "package": "x"})
    assert resp.status_code == 401


def test_codex_pr_blocked_for_non_founder():
    # Static gate: a request that is not permitted to spend founder Codex credits
    # must never invoke the CLI or open a Codex-authored PR.
    with pytest.raises(PermissionError):
        orchestrator._codex_pr("https://github.com/a/b", "a/b", "tok", allow_codex=False)


def test_open_fix_pr_bump_edits_manifest_and_names_branch(monkeypatch, tmp_path):
    (tmp_path / "package.json").write_text('{"dependencies": {"lodash": "^4.17.20"}}')

    @contextmanager
    def checkout(_url, _token=None):
        yield tmp_path

    monkeypatch.setattr("backend.integrations.repository.checkout_public_repo", checkout)

    class FakeResp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"vulns": [{"affected": [{"ranges": [{"events": [{"fixed": "4.17.21"}]}]}]}]}

    monkeypatch.setattr(httpx, "post", lambda *a, **k: FakeResp())

    captured: dict = {}

    def fake_open_pr(owner_repo, token, branch, title, body, file_changes, base=None):
        captured.update(owner_repo=owner_repo, token=token, branch=branch, files=file_changes)
        return {"url": "https://github.com/a/b/pull/1", "number": 1, "branch": branch, "base": "main"}

    monkeypatch.setattr("backend.integrations.github_write.open_pull_request", fake_open_pr)

    result = asyncio.run(orchestrator.open_fix_pr("https://github.com/a/b", "tok", "bump", "lodash", "4.17.20", "CVE-1"))
    assert result["number"] == 1
    assert captured["owner_repo"] == "a/b"
    assert captured["branch"] == "umbra/fix-lodash-4.17.21"
    assert '"lodash": "^4.17.21"' in captured["files"]["package.json"]


def test_open_fix_pr_bump_requires_a_fix_version(monkeypatch, tmp_path):
    (tmp_path / "package.json").write_text('{"dependencies": {"lodash": "^4.17.20"}}')

    @contextmanager
    def checkout(_url, _token=None):
        yield tmp_path

    monkeypatch.setattr("backend.integrations.repository.checkout_public_repo", checkout)

    class FakeResp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"vulns": []}  # no advisory / no fixed version

    monkeypatch.setattr(httpx, "post", lambda *a, **k: FakeResp())

    with pytest.raises(ValueError):
        asyncio.run(orchestrator.open_fix_pr("https://github.com/a/b", "tok", "bump", "lodash", "4.17.20", None))
