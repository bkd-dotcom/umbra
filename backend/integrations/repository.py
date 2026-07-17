"""Ephemeral, read-only-origin checkouts for live public-repository scans."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from backend.integrations.github import parse_public_repo


def live_repositories_enabled() -> bool:
    return os.getenv("UMBRA_ENABLE_LIVE_REPOS", "false").lower() == "true"


def cloud_scan_enabled() -> bool:
    """Run agents' real data pipelines (OSV / git history / git-grep) without the
    Codex CLI. Lets the cloud demo produce real findings on a user's own repo,
    with the Codex diff + reasoning narrative honestly labelled as unavailable."""
    return os.getenv("UMBRA_ENABLE_CLOUD_SCAN", "false").lower() == "true"


def _scrub(text: str, token: str | None) -> str:
    """Remove a GitHub token from any text before it can reach a log/response."""
    return text.replace(token, "***") if (token and text) else text


def reset_checkout(path: Path) -> None:
    """Restore a shared checkout to its pristine cloned state.

    Used between sequential scan agents so a mutating agent (Watchman/Janitor)
    never sees another's edits in its own git diff. Best-effort and local (the
    checkout has no origin remote): a failure just leaves the tree as-is."""
    subprocess.run(["git", "reset", "--hard", "HEAD"], cwd=path, text=True, capture_output=True, check=False)
    subprocess.run(["git", "clean", "-ffdx"], cwd=path, text=True, capture_output=True, check=False)


@contextmanager
def checkout_public_repo(repo_url: str, token: str | None = None) -> Iterator[Path]:
    """Clone a repo to a temp dir with no credentialed remote left behind.

    With ``token`` (a user's read-scoped GitHub token) a private repo can be
    cloned: the token is injected only into the one-shot clone URL, the origin
    remote is removed immediately after, and the token is scrubbed from any error
    text. The token is NEVER written to a persistent config we keep, never passed
    to the Codex child process, and the whole checkout is deleted on exit.
    """
    if not live_repositories_enabled():
        raise RuntimeError("Live repositories are disabled; set UMBRA_ENABLE_LIVE_REPOS=true")
    owner_repo = parse_public_repo(repo_url)
    temp_dir = Path(tempfile.mkdtemp(prefix="umbra-repo-"))
    checkout = temp_dir / "repo"
    clone_url = (
        f"https://x-access-token:{token}@github.com/{owner_repo}.git"
        if token
        else f"https://github.com/{owner_repo}.git"
    )
    # Never let git block on a credential prompt (invalid token / private repo).
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    # A shallow clone is far faster and — because Cloud Run's filesystem is an
    # in-RAM tmpfs — uses much less memory per scan. Depth 1 is enough for the
    # OSV / git-grep / Codex paths; ``UMBRA_CLONE_DEPTH`` can widen it when a
    # feature genuinely needs more history.
    depth = os.getenv("UMBRA_CLONE_DEPTH", "1").strip() or "1"
    try:
        result = subprocess.run(
            ["git", "clone", "--depth", depth, clone_url, str(checkout)],
            text=True, capture_output=True, timeout=120, check=False, env=env,
        )
        if result.returncode:
            raise RuntimeError(f"Unable to clone repository: {_scrub(result.stderr, token).strip()}")
        # The origin (which carries the token in its URL) is removed so the token
        # is not persisted and accidental pushing is impossible.
        subprocess.run(["git", "remote", "remove", "origin"], cwd=checkout, text=True, capture_output=True, check=False)
        yield checkout
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
