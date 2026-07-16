"""Deterministic dependency-bump remediation (no model / no Codex).

Given OSV advisories for a pinned dependency, pick the smallest safe fixed
version and produce an edited manifest — the basis for a bump PR that any user
with GitHub write access can open, without spending Codex credits.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any


def _version_key(version: str) -> tuple[int, ...]:
    parts = re.findall(r"\d+", version or "")
    return tuple(int(p) for p in parts[:4]) if parts else (0,)


def pick_fixed_version(advisories: list[dict[str, Any]], current: str) -> str | None:
    """Smallest OSV ``fixed`` version greater than ``current`` (falls back to the
    highest fixed version if none parse as strictly greater). None if OSV lists
    no fixed version — in which case no automatic bump is offered."""
    fixed: set[str] = set()
    for advisory in advisories:
        for affected in advisory.get("affected") or []:
            for rng in affected.get("ranges") or []:
                for event in rng.get("events") or []:
                    if event.get("fixed"):
                        fixed.add(str(event["fixed"]))
    if not fixed:
        return None
    current_key = _version_key(current)
    higher = sorted((f for f in fixed if _version_key(f) > current_key), key=_version_key)
    return higher[0] if higher else sorted(fixed, key=_version_key)[-1]


def bump_manifest(repo_path: Path, package: str, ecosystem: str, fixed: str) -> tuple[str, str] | None:
    """Targeted, format-preserving edit of the pinned version for ``package``.

    Returns ``(manifest_relative_path, new_content)`` or None if the package
    isn't found in the expected manifest. A surgical regex replace keeps the rest
    of the file (ordering, formatting, comments) byte-for-byte intact.
    """
    if ecosystem == "npm":
        path = repo_path / "package.json"
        if not path.exists():
            return None
        content = path.read_text()
        # "pkg": "^1.2.3"  → keep the range operator, swap only the version.
        pattern = re.compile(r'("' + re.escape(package) + r'"\s*:\s*")([\^~>=<v ]*)([^"\s]+)(")')
        if not pattern.search(content):
            return None
        return "package.json", pattern.sub(lambda m: f"{m.group(1)}{m.group(2)}{fixed}{m.group(4)}", content, count=1)

    if ecosystem == "PyPI":
        path = repo_path / "requirements.txt"
        if not path.exists():
            return None
        content = path.read_text()
        pattern = re.compile(r"(?im)^(\s*" + re.escape(package) + r"\s*==\s*)([A-Za-z0-9_.+-]+)(.*)$")
        if not pattern.search(content):
            return None
        return "requirements.txt", pattern.sub(lambda m: f"{m.group(1)}{fixed}{m.group(3)}", content, count=1)

    return None
