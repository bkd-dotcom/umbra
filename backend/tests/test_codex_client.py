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
