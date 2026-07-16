"""GitHub write path — the ONLY place Umbra uses a token for writes.

Strictly branch-only, never merge/approve. Invoked solely on an explicit user
action (POST /api/my/pr). The token is used server-side here and is NEVER handed
to the Codex child process; any token substring is scrubbed from raised errors.
"""
from __future__ import annotations


def open_pull_request(
    repo_full_name: str,
    token: str,
    branch: str,
    title: str,
    body: str,
    file_changes: dict[str, str],
    base: str | None = None,
) -> dict[str, object]:
    """Commit ``file_changes`` to a fresh ``branch`` off ``base`` and open a PR.

    Uses the Git Data API (blobs → tree → commit → ref) for one atomic commit.
    Never touches the default branch's contents and never merges. If the branch
    or an open PR already exists, it is reused rather than duplicated.
    """
    from github import Github, GithubException, InputGitTreeElement

    def _scrub(message: str) -> str:
        return message.replace(token, "***") if token else message

    try:
        repo = Github(token).get_repo(repo_full_name)
        base = base or repo.default_branch
        base_commit = repo.get_git_commit(repo.get_git_ref(f"heads/{base}").object.sha)
        elements = [
            InputGitTreeElement(path=path, mode="100644", type="blob", sha=repo.create_git_blob(content, "utf-8").sha)
            for path, content in file_changes.items()
        ]
        new_tree = repo.create_git_tree(elements, base_commit.tree)
        new_commit = repo.create_git_commit(title, new_tree, [base_commit])
        try:
            repo.create_git_ref(f"refs/heads/{branch}", new_commit.sha)
        except GithubException:
            # Branch already exists — move it to our new commit (no merge, no default branch).
            repo.get_git_ref(f"heads/{branch}").edit(new_commit.sha, force=True)
        try:
            pull = repo.create_pull(title=title, body=body, head=branch, base=base)
        except GithubException:
            existing = list(repo.get_pulls(state="open", head=f"{repo.owner.login}:{branch}"))
            if not existing:
                raise
            pull = existing[0]
        return {"url": pull.html_url, "number": pull.number, "branch": branch, "base": base}
    except Exception as exc:  # noqa: BLE001 - scrub any token before it can surface
        raise RuntimeError(_scrub(str(exc))) from None


def create_issue_comment(repo_full_name: str, token: str, issue_number: int, body: str) -> dict[str, object]:
    """Post a single comment on a PR/issue — used by the webhook auto-review.

    Comment-only: never approves, requests changes, merges, or edits code. The
    token is used server-side here and is NEVER handed to the Codex child process;
    any token substring is scrubbed from raised errors.
    """
    from github import Github

    def _scrub(message: str) -> str:
        return message.replace(token, "***") if token else message

    try:
        issue = Github(token).get_repo(repo_full_name).get_issue(number=issue_number)
        comment = issue.create_comment(body)
        return {"url": comment.html_url, "id": comment.id}
    except Exception as exc:  # noqa: BLE001 - scrub any token before it can surface
        raise RuntimeError(_scrub(str(exc))) from None
