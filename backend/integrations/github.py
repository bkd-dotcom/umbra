"""Read-only public GitHub helper. PR creation deliberately lives in Codex."""
from __future__ import annotations

import os
from urllib.parse import urlparse

import httpx


def parse_public_repo(repo_url: str) -> str:
    value = repo_url.strip().rstrip("/")
    # Accept bare "owner/repo" and scheme-less "github.com/owner/repo" (and
    # "www.github.com/…") in addition to full https URLs — normalize to a URL first
    # so urlparse resolves the host instead of dumping everything into the path.
    if not value.lower().startswith(("http://", "https://")):
        value = f"https://{value.lstrip('/')}" if value.lower().startswith(("github.com/", "www.github.com/")) else f"https://github.com/{value.lstrip('/')}"
    parsed = urlparse(value)
    host = parsed.netloc.lower().removeprefix("www.")
    if host != "github.com":
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


def list_user_repos(token: str, limit: int = 100) -> list[dict[str, object]]:
    """List the authenticated user's repositories — public AND private.

    The token is used read-only (never passed to Codex; the clone remote is
    stripped after checkout). The ``private`` flag lets the UI show a lock badge.

    Robust by design against GitHub's flaky ``/user/repos``: the broad
    ``visibility=all``+``affiliation`` enumeration is the expensive query GitHub
    intermittently answers with 503s, so on ANY failure we degrade to the cheap
    owner-only listing (which almost never 503s). ``per_page=100`` fetches the
    page in one round-trip, and a patient backoff absorbs a transient 5xx blip.
    A single unreadable repo is skipped rather than failing the whole list; a
    hard auth/scope failure still raises (surfaced distinctly by ``/api/my/repos``).
    """
    from github import Github, GithubRetry

    # Longer backoff window than PyGithub's default so a short 503 burst on the
    # authenticated repo enumeration is ridden out instead of giving up fast.
    # GithubRetry already retries all 5xx (+ rate-limited 403) by default.
    retry = GithubRetry(total=4, backoff_factor=0.6, backoff_max=6)
    user = Github(token, per_page=100, retry=retry).get_user()

    def _collect(paginated) -> list[dict[str, object]]:
        out: list[dict[str, object]] = []
        for repo in paginated:
            try:
                out.append({
                    "name": repo.name,
                    "full_name": repo.full_name,
                    "url": repo.html_url,
                    "private": bool(repo.private),
                    "stars": repo.stargazers_count or 0,
                })
            except Exception:  # noqa: BLE001 - skip one unreadable repo, never drop the list
                continue
            if len(out) >= limit:
                break
        return out

    # Cheapest-last: try the full affiliation set, but fall back to owner-only
    # (and then the bare default) if GitHub 503s on the expensive query.
    attempts = (
        {"visibility": "all", "affiliation": "owner,collaborator,organization_member", "sort": "pushed"},
        {"affiliation": "owner", "sort": "pushed"},
        {"sort": "pushed"},
    )
    last_exc: Exception | None = None
    for kwargs in attempts:
        try:
            return _collect(user.get_repos(**kwargs))
        except Exception as exc:  # noqa: BLE001 - degrade to a cheaper query on failure
            last_exc = exc
            continue
    if last_exc is not None:
        raise last_exc
    return []


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


_JSON_ACCEPT = "application/vnd.github+json"
_DIFF_ACCEPT = "application/vnd.github.v3.diff"


def _headers(token: str | None = None, accept: str = _JSON_ACCEPT) -> dict[str, str]:
    # Prefer an explicit per-request token (the repo owner's OAuth token, for
    # private-repo auto-review) and fall back to the ambient read-only GITHUB_TOKEN.
    headers = {"Accept": accept, "User-Agent": "umbra-engineer"}
    if tok := (token or os.getenv("GITHUB_TOKEN")):
        headers["Authorization"] = f"Bearer {tok}"
    return headers


def fetch_pull_request(repo_url: str, pr_number: int, token: str | None = None) -> dict[str, object]:
    owner_repo = parse_public_repo(repo_url)
    # Fetch BOTH the diff and the metadata from the api.github.com endpoint (with
    # the appropriate Accept per call): the JSON endpoint honours the diff media
    # type, and — unlike the github.com/<repo>/pull/N.diff URL, which 302s to a
    # different host and drops the Authorization header — it keeps the token on
    # the same host, so private-repo diffs work with the owner's token.
    api_url = f"https://api.github.com/repos/{owner_repo}/pulls/{pr_number}"
    patch = httpx.get(api_url, headers=_headers(token, _DIFF_ACCEPT), timeout=20, follow_redirects=True)
    patch.raise_for_status()
    diff = patch.text[:200_000]
    api = httpx.get(api_url, headers=_headers(token), timeout=20, follow_redirects=True)
    api.raise_for_status()
    details = api.json()
    return {"number": pr_number, "title": details["title"], "head_sha": details["head"]["sha"], "base_sha": details["base"]["sha"], "changed_files": parse_pull_diff(diff), "diff": diff}


def latest_open_pull_request(repo_url: str, token: str | None = None) -> int | None:
    owner_repo = parse_public_repo(repo_url)
    response = httpx.get(f"https://api.github.com/repos/{owner_repo}/pulls", params={"state": "open", "sort": "updated", "direction": "desc", "per_page": 1}, headers=_headers(token), timeout=20, follow_redirects=True)
    if response.status_code >= 400:
        return None
    pulls = response.json()
    return int(pulls[0]["number"]) if pulls else None
