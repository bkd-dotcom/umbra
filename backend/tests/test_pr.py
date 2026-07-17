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


def test_apply_diff_pr_opens_pr_from_reviewed_diff(monkeypatch, tmp_path):
    """The fast 'auto-patch' path: apply a diff Umbra already produced and open a
    PR from the result — no Codex run. The PR must carry exactly the patched file."""
    import subprocess as sp

    sp.run(["git", "init", "-q", "-b", "main"], cwd=tmp_path, check=True)
    sp.run(["git", "config", "user.email", "t@t.dev"], cwd=tmp_path, check=True)
    sp.run(["git", "config", "user.name", "t"], cwd=tmp_path, check=True)
    (tmp_path / "a.txt").write_text("hello\n")
    sp.run(["git", "add", "."], cwd=tmp_path, check=True)
    sp.run(["git", "commit", "-qm", "init"], cwd=tmp_path, check=True)
    # Produce a real unified diff, then revert so the checkout is pristine.
    (tmp_path / "a.txt").write_text("patched\n")
    diff = sp.run(["git", "diff"], cwd=tmp_path, capture_output=True, text=True, check=True).stdout
    sp.run(["git", "checkout", "--", "a.txt"], cwd=tmp_path, check=True)

    @contextmanager
    def checkout(_url, _token=None):
        yield tmp_path

    monkeypatch.setattr("backend.integrations.repository.checkout_public_repo", checkout)

    captured: dict = {}

    def fake_open_pr(owner_repo, token, branch, title, body, file_changes, base=None):
        captured.update(owner_repo=owner_repo, files=file_changes, branch=branch)
        return {"url": "https://github.com/a/b/pull/7", "number": 7, "branch": branch, "base": "main"}

    monkeypatch.setattr("backend.integrations.github_write.open_pull_request", fake_open_pr)

    out = asyncio.run(orchestrator.open_fix_pr("https://github.com/a/b", "tok", mode="apply_diff", diff=diff))
    assert out["number"] == 7
    assert captured["owner_repo"] == "a/b"
    assert captured["files"]["a.txt"] == "patched\n"
    assert captured["branch"].startswith("umbra/patch-")


def test_open_fix_pr_apply_diff_requires_a_diff():
    # An apply_diff PR with no diff is a clear client error, not a Codex run.
    with pytest.raises(ValueError):
        asyncio.run(orchestrator.open_fix_pr("https://github.com/a/b", "tok", mode="apply_diff", diff="   "))


def test_codex_pr_forwards_model_and_effort(monkeypatch, tmp_path):
    """The Codex PR must honour the caller's speed choice (today it dropped it)."""
    from datetime import UTC, datetime

    from backend.codex_client import CodexOperation

    (tmp_path / "x.py").write_text("print(1)\n")
    captured: dict = {}

    class FakeCodex:
        def __init__(self, model=None, reasoning_effort=None):
            captured["model"] = model
            captured["effort"] = reasoning_effort

        def propose(self, *_a, **_k):
            return CodexOperation("p", "fixed a bug", "diff", True, ["x.py"], "codex-cli", datetime.now(UTC).isoformat())

    @contextmanager
    def checkout(_url, _token=None):
        yield tmp_path

    monkeypatch.setattr("backend.codex_client.CodexClient", FakeCodex)
    monkeypatch.setattr("backend.integrations.repository.checkout_public_repo", checkout)
    monkeypatch.setattr("backend.integrations.github_write.open_pull_request", lambda *a, **k: {"url": "u", "number": 3, "branch": a[2], "base": "main"})

    out = orchestrator._codex_pr("https://github.com/a/b", "a/b", "tok", True, "gpt-5.6-luna", "low")
    assert out["number"] == 3
    assert captured == {"model": "gpt-5.6-luna", "effort": "low"}


def test_create_issue_comment_posts_via_token(monkeypatch):
    """The webhook auto-review's only write: one advisory PR comment (comment-only)."""
    import github as pygithub

    captured: dict = {}

    class FakeComment:
        html_url = "https://github.com/a/b/pull/7#issuecomment-1"
        id = 99

    class FakeIssue:
        def create_comment(self, body):
            captured["body"] = body
            return FakeComment()

    class FakeRepo:
        def get_issue(self, number):
            captured["number"] = number
            return FakeIssue()

    class FakeGithub:
        def __init__(self, _token):
            pass

        def get_repo(self, _full_name):
            return FakeRepo()

    monkeypatch.setattr(pygithub, "Github", FakeGithub)
    from backend.integrations.github_write import create_issue_comment

    out = create_issue_comment("a/b", "tok", 7, "🌑 Umbra Review")
    assert out == {"url": "https://github.com/a/b/pull/7#issuecomment-1", "id": 99}
    assert captured == {"number": 7, "body": "🌑 Umbra Review"}
