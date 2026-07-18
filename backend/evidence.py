"""Auditable Evidence Pack: a portable, hashable record of a scan run.

Turns a scan result into a human-readable Markdown artifact plus a sha256 over
the canonical result, so a reviewer can audit exactly what Umbra did — which
providers actually ran, the Codex diff, changed files, the autonomy level, and
the repository policy — without re-running anything.

Honesty invariants (mirrored from the scan layer):
- The provider ledger only lists providers that literally appear in the result;
  it never implies Codex/GPT ran when the values say otherwise.
- Every path is sanitized: an Evidence Pack can never surface the server's
  disposable-checkout filesystem layout (``/private/var``, ``/var/folders``,
  ``/tmp``, or an ``umbra-<kind>-XXXX`` checkout dir).
- It always restates that Umbra never auto-merges and human review is required.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

# --- Path hygiene -----------------------------------------------------------
# codex_client already strips the disposable checkout's absolute prefix at the
# source; these two patterns are a second, defence-in-depth net so an Evidence
# Pack NEVER leaks a temp path even if some field slipped through. The first
# removes a full temp path (``/private/var/folders/…/umbra-repo-XXXX/repo/`` or
# ``/tmp/umbra-codex-XXXX/repo/``); the second removes any residual bare
# ``umbra-<kind>-XXXX`` checkout-dir name.
_TEMP_PATH = re.compile(
    r"(?:/private)?/(?:var/folders/[^\s\"')]*?|tmp)/umbra-[A-Za-z0-9_-]+(?:/repo)?/?"
)
_TEMP_NAME = re.compile(r"/?umbra-(?:repo|reason|codex)-[A-Za-z0-9_-]+(?:/repo)?/?")

_LIVE_PROVIDERS = {
    "codex-cli", "osv.dev", "local-git", "local-git-grep", "repo-clone",
    "responses-api", "responses-api-stream",
}

_MODES = {
    "live": "Live Codex-enabled run",
    "captured": "Captured scan (recorded proof)",
    "demo": "Sample shift (seeded)",
}

_SAFETY = "Umbra never auto-merges. Human review required."

# Autonomy ladder — metadata only. Umbra performs no auto-merge at ANY level;
# higher levels describe intent, and the actual PR/review still happens through
# explicit endpoints (``/api/my/pr``, the GitHub App webhook).
AUTONOMY_LADDER = {
    0: "Report only",
    1: "Prepare diff",
    2: "Open branch PR",
    3: "Request review",
}

_DEFAULT_POLICY = {
    "loaded": False,
    "summary": "Default Umbra policy applied: prepare reviewable work, never auto-merge.",
}
_POLICY_REL = ".umbra/nightshift.md"
_POLICY_MAX_BYTES = 8000


def sanitize_paths(text: str) -> str:
    """Strip any disposable-checkout temp path from free text (idempotent)."""
    if not text:
        return text
    return _TEMP_NAME.sub("", _TEMP_PATH.sub("", text))


def canonical_hash(result: dict[str, Any]) -> str:
    """sha256 over the canonical JSON of ``result``, excluding ``evidence_hash``.

    Deterministic (sorted keys, compact separators) so the same run reproduces
    the same hash — that reproducibility is what makes the pack auditable.
    """
    payload = {k: v for k, v in result.items() if k != "evidence_hash"}
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str, ensure_ascii=False)
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _repo_slug(repo_url: str) -> str:
    stripped = re.sub(r"^https?://", "", repo_url or "", flags=re.I)
    stripped = re.sub(r"^(www\.)?github\.com/", "", stripped, flags=re.I)
    stripped = re.sub(r"\.git$", "", stripped, flags=re.I).strip("/")
    slug = re.sub(r"[^a-z0-9]+", "-", stripped.lower()).strip("-")
    return slug or "repo"


def _repo_display(repo_url: str) -> str:
    stripped = re.sub(r"^https?://", "", repo_url or "", flags=re.I)
    stripped = re.sub(r"^(www\.)?github\.com/", "", stripped, flags=re.I)
    return re.sub(r"\.git$", "", stripped, flags=re.I).strip("/") or "unknown-repo"


def make_run_id(repo_url: str, source: str) -> str:
    """Stable-ish run id: ``umbra_<yyyymmdd>_<repo-slug>_<short-hash>``.

    The short hash folds timestamp + repo + source so two runs of the same repo
    on the same day stay distinguishable while remaining deterministic for a
    given (time, repo, source) tuple.
    """
    now = datetime.now(UTC)
    short = hashlib.sha256(f"{now.isoformat()}|{repo_url}|{source}".encode("utf-8")).hexdigest()[:8]
    return f"umbra_{now.strftime('%Y%m%d')}_{_repo_slug(repo_url)}_{short}"


def autonomy_metadata(level: int) -> dict[str, Any]:
    lvl = level if level in AUTONOMY_LADDER else 1
    return {
        "level": lvl,
        "label": AUTONOMY_LADDER[lvl],
        "auto_merge": False,
        "human_review_required": True,
    }


def _policy_summary(text: str) -> str:
    lines = [ln.strip().lstrip("#").strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]
    summary = " ".join(lines[:3]).strip()
    if not summary:
        return "Custom policy loaded."
    return (summary[:277] + "…") if len(summary) > 280 else summary


def read_policy(repo_path: Path | str | None) -> dict[str, Any]:
    """Read ``.umbra/nightshift.md`` from a checkout, else the default policy.

    Metadata only for now: the loaded text is surfaced but not (yet) threaded
    into agent prompts — that would be a behavior change, so it's deferred.
    """
    if repo_path is None:
        return dict(_DEFAULT_POLICY)
    try:
        path = Path(repo_path) / ".umbra" / "nightshift.md"
        if path.is_file():
            text = path.read_text(errors="replace")[:_POLICY_MAX_BYTES]
            return {"loaded": True, "path": _POLICY_REL, "summary": _policy_summary(text)}
    except OSError:
        pass
    return dict(_DEFAULT_POLICY)


def _merge_providers(result: dict[str, Any]) -> dict[str, str]:
    """Fold every agent's provider map into one, preferring a live value."""
    merged: dict[str, str] = {}
    for run in result.get("agent_results") or []:
        providers = ((run or {}).get("replay") or {}).get("providers") or {}
        for key, value in providers.items():
            if key not in merged or (merged[key] not in _LIVE_PROVIDERS and value in _LIVE_PROVIDERS):
                merged[key] = str(value)
    return merged


_DIFF_FILE = re.compile(r"^\+\+\+ b/(.+)$", re.M)


def _files_from_diff(diff: str) -> list[str]:
    files: list[str] = []
    for match in _DIFF_FILE.finditer(diff or ""):
        rel = sanitize_paths(match.group(1).strip())
        if rel and rel != "/dev/null" and rel not in files:
            files.append(rel)
    return files


def _codex_diff_summary(result: dict[str, Any]) -> tuple[list[str], list[str]]:
    lines: list[str] = []
    changed: list[str] = []
    for run in result.get("agent_results") or []:
        agent = (run or {}).get("agent", "agent")
        diff = ((run or {}).get("replay") or {}).get("codex_diff") or ""
        if not diff.strip():
            continue
        files = _files_from_diff(diff)
        for rel in files:
            if rel not in changed:
                changed.append(rel)
        lines.append(f"- **{agent}** — {len(diff)} chars across {len(files)} file(s): {', '.join(files) or 'n/a'}")
    return lines, changed


def build_evidence_pack(result: dict[str, Any], mode: str = "live") -> dict[str, Any]:
    """Render a scan ``result`` into an auditable Markdown Evidence Pack.

    Returns ``{markdown, summary, sha256, generated_at}``. The ``sha256`` is the
    run's canonical hash (reproducible), reused from ``result['evidence_hash']``
    when present so the pack and the live scan agree.
    """
    mode = mode if mode in _MODES else "live"
    run_type = _MODES[mode]
    generated_at = datetime.now(UTC).isoformat()

    repo = _repo_display(str(result.get("repo_url", "")))
    run_id = str(result.get("run_id") or make_run_id(str(result.get("repo_url", "")), str(result.get("source", mode))))
    sha = str(result.get("evidence_hash") or canonical_hash(result))
    score = result.get("umbra_score", "—")
    source = str(result.get("source", "—"))
    vulns = result.get("vulnerabilities") or []
    findings_count = len(vulns)

    providers = _merge_providers(result)
    ledger_lines = [f"- `{k}` → **{v}**" for k, v in sorted(providers.items())]
    inline_ledger = " · ".join(sorted({v for v in providers.values()})) or "none recorded"

    diff_lines, changed_files = _codex_diff_summary(result)
    verification = sanitize_paths(str(result.get("reasoning_summary") or "").strip())

    autonomy = result.get("autonomy") or autonomy_metadata(1)
    policy = result.get("policy") or dict(_DEFAULT_POLICY)
    captured_at = result.get("captured_at") or result.get("ran_at")

    parts: list[str] = [
        "# Umbra Evidence Pack",
        "",
        f"**Repository:** {repo}  ",
        f"**Run ID:** `{run_id}`  ",
        f"**Run type:** {run_type}  ",
        f"**Source:** `{source}`  ",
    ]
    if captured_at:
        parts.append(f"**Captured at:** {captured_at}  ")
    parts += [
        f"**Generated at:** {generated_at}  ",
        f"**Evidence hash:** `{sha}`  ",
        "",
        "## Summary",
        "",
        f"- **Umbra score:** {score} / 100",
        f"- **Findings:** {findings_count} OSV {'advisory' if findings_count == 1 else 'advisories'}",
        f"- **Providers that ran:** {inline_ledger}",
        "",
        "## Provider ledger",
        "",
        *(ledger_lines or ["- (no provider metadata recorded on this run)"]),
        "",
        "## Codex diff summary",
        "",
        *(diff_lines or ["- No Codex-authored diff on this run."]),
        "",
        "## Changed files",
        "",
        *([f"- `{rel}`" for rel in changed_files] or ["- none"]),
        "",
        "## Verification notes",
        "",
        verification or "_No reasoning summary recorded for this run._",
        "",
        "## Autonomy",
        "",
        f"- **Level {autonomy.get('level')}** — {autonomy.get('label')}",
        f"- Auto-merge: **{'yes' if autonomy.get('auto_merge') else 'no'}**",
        f"- Human review required: **{'yes' if autonomy.get('human_review_required', True) else 'no'}**",
        "",
        "## Policy",
        "",
        (f"- Policy loaded from `{policy.get('path', _POLICY_REL)}`" if policy.get("loaded") else "- Default Umbra safety policy applied"),
        f"- {sanitize_paths(str(policy.get('summary', '')))}",
        "",
        "---",
        "",
        f"**{_SAFETY}**",
        "",
    ]
    # Final catch-all sanitize over the whole document — belt-and-suspenders so a
    # temp path can never reach a copied/exported Evidence Pack.
    markdown = sanitize_paths("\n".join(parts))

    summary = sanitize_paths(
        f"Umbra {run_type} on {repo}: {findings_count} finding(s), score {score}/100. "
        f"Providers: {inline_ledger}. Autonomy L{autonomy.get('level')} ({autonomy.get('label')}); "
        "never auto-merges."
    )
    return {"markdown": markdown, "summary": summary, "sha256": sha, "generated_at": generated_at}
