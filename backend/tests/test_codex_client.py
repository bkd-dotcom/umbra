"""Tests for the Codex CLI adapter's output hygiene."""
from __future__ import annotations

import tempfile
from pathlib import Path

from backend.codex_client import CodexClient


def test_sanitize_paths_strips_absolute_checkout_prefix() -> None:
    """Codex embeds the disposable checkout's absolute path in its prose; the
    adapter must rewrite it to a repo-relative path so the server filesystem
    layout never leaks into the user-facing summary/Morning Report."""
    tmp = Path(tempfile.mkdtemp(prefix="umbra-repo-"))
    try:
        repo = tmp / "repo"
        repo.mkdir()
        # Codex reports the resolved (/private/... on macOS) spelling in links,
        # and sometimes the unresolved (/var/...) spelling elsewhere.
        leaked = (
            "Changed:\n"
            f"- [package.json]({repo.resolve()}/package.json)\n"
            f"- inspected {repo}/app/page.tsx"
        )
        clean = CodexClient._sanitize_paths(leaked, repo)
        assert "(package.json)" in clean
        assert "app/page.tsx" in clean
        for token in ("/private/var/", "/var/folders/", "umbra-repo-", str(repo)):
            assert token not in clean, f"leaked {token!r}: {clean!r}"
    finally:
        import shutil

        shutil.rmtree(tmp, ignore_errors=True)


def test_sanitize_paths_noops_on_empty_and_clean_text() -> None:
    repo = Path("/tmp/umbra-repo-abc/repo")
    assert CodexClient._sanitize_paths("", repo) == ""
    clean = "Updated Next.js to 14.2.35. Lockfile synced; typecheck skipped."
    assert CodexClient._sanitize_paths(clean, repo) == clean


def test_model_identity_never_infers_unpinned_model() -> None:
    """When no model is pinned via -m, model_resolved must be 'unavailable' (we do
    NOT claim the CLI's internal default) and evidence must be 'codex-default'."""
    client = CodexClient(model=None, reasoning_effort=None, runner=lambda *a, **k: None)
    mi = client.model_identity("codex-cli")
    assert mi["executor"] == "codex-cli"
    assert mi["model_configured"] == "codex-default"
    assert mi["model_resolved"] == "unavailable"
    assert mi["model_evidence"] == "codex-default"


def test_model_identity_pinned_model_is_configured_not_resolved() -> None:
    """A -m flag proves the model was REQUESTED, not that the provider/CLI confirmed
    it ran: model_configured is set, model_resolved stays 'unavailable', and evidence
    is 'cli-argument' (a request, never provider-attested)."""
    import subprocess

    def fake_runner(argv, **kwargs):
        return subprocess.CompletedProcess(argv, 0, stdout="codex-cli 0.9.9\n", stderr="")

    client = CodexClient(model="gpt-5.6-terra", reasoning_effort="low", runner=fake_runner)
    mi = client.model_identity("codex-cli")
    assert mi["model_configured"] == "gpt-5.6-terra"
    assert mi["model_resolved"] == "unavailable"          # requested, not attested
    assert mi["model_evidence"] == "cli-argument"
    assert mi["codex_cli_version"] == "codex-cli 0.9.9"


def test_model_identity_deterministic_declares_no_model() -> None:
    client = CodexClient(model="gpt-5.6-sol", reasoning_effort="high", runner=lambda *a, **k: None)
    mi = client.model_identity("deterministic")
    assert mi["model_evidence"] == "no-model"
    assert mi["model_configured"] is None and mi["model_resolved"] is None


def test_cli_version_returns_none_when_probe_fails() -> None:
    def boom(*a, **k):
        raise OSError("no codex binary")

    assert CodexClient.cli_version(runner=boom) is None
