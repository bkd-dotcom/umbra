"""Read-only public GitHub helper. PR creation deliberately lives in Codex."""
from __future__ import annotations

import os
from urllib.parse import urlparse


def parse_public_repo(repo_url: str) -> str:
    value = repo_url.strip().rstrip("/")
    if value.count("/") == 1 and not value.startswith("http"):
        value = f"https://github.com/{value}"
    parsed = urlparse(value)
    if parsed.netloc.lower() != "github.com":
        raise ValueError("Umbra currently accepts GitHub repository URLs only.")
    bits = [part for part in parsed.path.split("/") if part]
    if len(bits) < 2:
        raise ValueError("Expected a repository URL such as https://github.com/owner/repo")
    return f"{bits[0]}/{bits[1].removesuffix('.git')}"


def recent_commits(repo_url: str, limit: int = 8) -> list[dict[str, str]]:
    """Fetch a small public commit history only when a GitHub token is configured."""
    token = os.getenv("GITHUB_TOKEN")
    if not token:
        return []
    from github import Github

    repo = Github(token).get_repo(parse_public_repo(repo_url))
    return [{"sha": commit.sha[:10], "message": commit.commit.message.splitlines()[0]} for commit in repo.get_commits()[:limit]]

