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


@contextmanager
def checkout_public_repo(repo_url: str) -> Iterator[Path]:
    """Clone a public repo to a temporary directory without any credentialed remote."""
    if not live_repositories_enabled():
        raise RuntimeError("Live repositories are disabled; set UMBRA_ENABLE_LIVE_REPOS=true")
    owner_repo = parse_public_repo(repo_url)
    temp_dir = Path(tempfile.mkdtemp(prefix="umbra-repo-"))
    checkout = temp_dir / "repo"
    try:
        result = subprocess.run(
            ["git", "clone", "--depth", "1", f"https://github.com/{owner_repo}.git", str(checkout)],
            text=True, capture_output=True, timeout=120, check=False,
        )
        if result.returncode:
            raise RuntimeError(f"Unable to clone public repository: {result.stderr.strip()}")
        # The origin is removed to make accidental pushing impossible.
        subprocess.run(["git", "remote", "remove", "origin"], cwd=checkout, text=True, capture_output=True, check=False)
        yield checkout
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
