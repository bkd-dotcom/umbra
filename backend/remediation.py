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


def _advisory_matches_cve(advisory: dict[str, Any], cve: str) -> bool:
    """True if ``cve`` names this advisory by its OSV id or any alias.

    OSV entries carry a canonical ``id`` (e.g. ``GHSA-…``) plus ``aliases``
    (e.g. ``CVE-…``). Umbra's scanner surfaces the ``id`` as the finding's ``cve``
    field (agents/watchman.py), so a match on id is the common path; aliases cover
    the case where a caller passes the CVE number instead. Case-insensitive."""
    wanted = cve.strip().lower()
    if not wanted:
        return False
    ids = [str(advisory.get("id", ""))] + [str(a) for a in advisory.get("aliases") or []]
    return any(i.lower() == wanted for i in ids)


def _smallest_fix_above(advisory: dict[str, Any], current_key: tuple[int, ...]) -> str | None:
    """Smallest ``fixed`` version in ONE advisory strictly greater than ``current``.

    That's the version needed to climb out of the vulnerable interval this advisory
    places ``current`` in. Returns None if the advisory lists no fix above current
    (e.g. an as-yet-unfixed advisory, or a per-branch fix only below current)."""
    fixed = {
        str(event["fixed"])
        for affected in advisory.get("affected") or []
        for rng in affected.get("ranges") or []
        for event in rng.get("events") or []
        if event.get("fixed")
    }
    above = sorted((f for f in fixed if _version_key(f) > current_key), key=_version_key)
    return above[0] if above else None


def pick_fixed_version(advisories: list[dict[str, Any]], current: str, cve: str | None = None) -> str | None:
    """Pick a version that genuinely escapes the relevant OSV advisory range(s).

    A dependency at ``current`` is typically affected by *several* advisories, each
    with its own fixed version. To escape ONE advisory you must reach the smallest
    ``fixed`` version above ``current`` within that advisory; to escape a *set* of
    advisories you must reach the largest of those per-advisory boundaries.

    - When ``cve`` names a specific advisory (by OSV id or alias), the bump targets
      exactly that advisory — the smallest fix above ``current`` within it. This is
      the remediation-queue path: the PR then truly remediates the CVE it claims
      (e.g. GHSA-h25m-26qc-wcjf on next → 15.0.8, not the unrelated 14.2.7 that a
      global minimum would pick).
    - Otherwise, clear *every* advisory affecting ``current`` — the max over
      advisories of each one's smallest fix above ``current`` — so the bumped
      version is left inside no known vulnerable range.

    Returns None when no relevant advisory lists any fixed version above ``current``
    (nothing to bump to), in which case no automatic bump is offered."""
    current_key = _version_key(current)

    if cve:
        targeted = [a for a in advisories if _advisory_matches_cve(a, cve)]
        if targeted:
            fixes = [f for a in targeted if (f := _smallest_fix_above(a, current_key))]
            return min(fixes, key=_version_key) if fixes else None

    # No CVE named (or it matched nothing): reach past the highest per-advisory fix
    # so we don't leave the package inside another advisory's vulnerable range.
    fixes = [f for a in advisories if (f := _smallest_fix_above(a, current_key))]
    return max(fixes, key=_version_key) if fixes else None


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
