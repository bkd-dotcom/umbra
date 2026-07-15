"""Read-only public GitHub helper. PR creation deliberately lives in Codex."""
from __future__ import annotations

import os
from urllib.parse import urlparse

import httpx


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


def list_user_repos(token: str, limit: int = 50) -> list[dict[str, object]]:
    """List the authenticated user's PUBLIC repositories (v1 is public-only).

    Reuses the PyGithub pattern already present in ``recent_commits``. Private
    repos are filtered out defensively even though we request public visibility.
    """
    from github import Github

    user = Github(token).get_user()
    repos: list[dict[str, object]] = []
    for repo in user.get_repos(visibility="public", sort="updated"):
        if repo.private:
            continue
        repos.append({
            "name": repo.name,
            "full_name": repo.full_name,
            "url": repo.html_url,
            "private": repo.private,
            "stars": repo.stargazers_count,
        })
        if len(repos) >= limit:
            break
    return repos


def parse_pull_diff(diff: str, limit: int = 200_000) -> list[dict[str, object]]:
    """Return changed-file metadata while bounding review input size."""
    files: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    for line in diff[:limit].splitlines():
        if line.startswith("diff --git "):
            if current:
                files.append(current)
            path = line.split(" b/", 1)[-1]
            current = {"file": path, "additions": 0, "deletions": 0}
        elif current and line.startswith("+") and not line.startswith("+++"):
            current["additions"] = int(current["additions"]) + 1
        elif current and line.startswith("-") and not line.startswith("---"):
            current["deletions"] = int(current["deletions"]) + 1
    if current:
        files.append(current)
    return [item for item in files if int(item["additions"]) + int(item["deletions"]) <= 1500]


def _headers() -> dict[str, str]:
    headers = {"Accept": "application/vnd.github.v3.diff", "User-Agent": "umbra-engineer"}
    if token := os.getenv("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    return headers


def fetch_pull_request(repo_url: str, pr_number: int) -> dict[str, object]:
    owner_repo = parse_public_repo(repo_url)
    patch = httpx.get(f"https://github.com/{owner_repo}/pull/{pr_number}.diff", headers=_headers(), timeout=20)
    patch.raise_for_status()
    diff = patch.text[:200_000]
    api = httpx.get(f"https://api.github.com/repos/{owner_repo}/pulls/{pr_number}", headers=_headers(), timeout=20)
    api.raise_for_status()
    details = api.json()
    return {"number": pr_number, "title": details["title"], "head_sha": details["head"]["sha"], "base_sha": details["base"]["sha"], "changed_files": parse_pull_diff(diff), "diff": diff}


def latest_open_pull_request(repo_url: str) -> int | None:
    owner_repo = parse_public_repo(repo_url)
    response = httpx.get(f"https://api.github.com/repos/{owner_repo}/pulls", params={"state": "open", "sort": "updated", "direction": "desc", "per_page": 1}, headers=_headers(), timeout=20)
    if response.status_code >= 400:
        return None
    pulls = response.json()
    return int(pulls[0]["number"]) if pulls else None
