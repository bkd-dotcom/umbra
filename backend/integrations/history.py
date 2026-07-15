"""Read local Git history from Umbra's disposable checkouts."""
from __future__ import annotations

import subprocess
from pathlib import Path


def recent_history(repo_path: Path, limit: int = 20) -> list[dict[str, object]]:
    log = subprocess.run(
        ["git", "log", f"-{limit}", "--format=@@@%H%x1f%s", "--name-only"],
        cwd=repo_path, text=True, capture_output=True, check=False,
    )
    if log.returncode:
        return []
    commits: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    for line in log.stdout.splitlines():
        if line.startswith("@@@") and "\x1f" in line:
            if current:
                commits.append(current)
            sha, subject = line[3:].split("\x1f", 1)
            current = {"sha": sha, "subject": subject, "files": []}
        elif current and line:
            current["files"].append(line)  # type: ignore[index]
    if current:
        commits.append(current)
    return commits
