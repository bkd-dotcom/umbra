"""Tests for the auditable Evidence Pack builder + hashing + path hygiene."""
from __future__ import annotations

from backend.evidence import (
    autonomy_metadata,
    build_evidence_pack,
    canonical_hash,
    make_run_id,
    read_policy,
)


def _result() -> dict:
    return {
        "repo_url": "https://github.com/Pranav-Karra-3301/calhacks-12",
        "source": "live-watchman",
        "umbra_score": 0,
        "reasoning_summary": "Live Watchman found 26 OSV advisories. Updated `next` in [package.json](package.json).",
        "vulnerabilities": [{"cve": "GHSA-f82v-jwr5-mffw", "severity": "high"}],
        "autonomy": autonomy_metadata(1),
        "policy": {"loaded": False, "summary": "Default Umbra policy applied: prepare reviewable work, never auto-merge."},
        "agent_results": [
            {
                "agent": "watchman",
                "replay": {
                    "codex_diff": (
                        "diff --git a/package.json b/package.json\n"
                        "--- a/package.json\n+++ b/package.json\n"
                        "@@ -17,7 +17,7 @@\n-    \"next\": \"^14.2.5\",\n+    \"next\": \"^14.2.33\",\n"
                    ),
                    "providers": {"vulnerabilities": "osv.dev", "engineering": "codex-cli", "reasoning": "codex-cli"},
                },
            },
        ],
    }


def test_build_evidence_pack_has_required_sections() -> None:
    pack = build_evidence_pack(_result(), "live")
    md = pack["markdown"]
    # Core facts a reviewer needs.
    assert "Pranav-Karra-3301/calhacks-12" in md
    assert "Run ID" in md and "umbra_" in md
    assert "Umbra score" in md
    assert "osv.dev" in md and "codex-cli" in md   # provider ledger, real values only
    assert "package.json" in md                    # changed file parsed from the diff
    assert "Prepare diff" in md                     # autonomy label
    assert "never auto-merges" in md.lower()        # safety statement
    assert "Default Umbra safety policy applied" in md
    # Envelope.
    assert pack["sha256"].startswith("sha256:")
    assert pack["summary"]
    assert pack["generated_at"]


def test_evidence_pack_sanitizes_temp_paths() -> None:
    result = _result()
    result["reasoning_summary"] = (
        "Edited /private/var/folders/9x/abc/T/umbra-repo-3f9a2b/repo/app/page.tsx "
        "and /tmp/umbra-codex-zzzz/repo/lib/livekit-audio.ts during the run."
    )
    pack = build_evidence_pack(result, "live")
    md = pack["markdown"]
    for token in ("/private/var", "/var/folders", "/tmp/", "umbra-repo-", "umbra-codex-"):
        assert token not in md, f"leaked {token!r} in Evidence Pack: {md!r}"
    # The repo-relative remainder still survives so the note stays useful.
    assert "app/page.tsx" in md
    assert "lib/livekit-audio.ts" in md


def test_canonical_hash_excludes_evidence_hash_and_is_stable() -> None:
    result = _result()
    first = canonical_hash(result)
    with_hash = dict(result)
    with_hash["evidence_hash"] = "sha256:tampered"
    assert canonical_hash(with_hash) == first, "evidence_hash must be excluded from its own hash"
    assert first.startswith("sha256:")
    assert canonical_hash(result) == first, "hash must be deterministic"


def test_autonomy_metadata_never_auto_merges() -> None:
    for level, label in [(0, "Report only"), (1, "Prepare diff"), (2, "Open branch PR"), (3, "Request review")]:
        meta = autonomy_metadata(level)
        assert meta["level"] == level
        assert meta["label"] == label
        assert meta["auto_merge"] is False
        assert meta["human_review_required"] is True
    # Unknown level falls back to the safe default (prepare diff).
    assert autonomy_metadata(99)["level"] == 1


def test_read_policy_defaults_without_checkout(tmp_path) -> None:
    default = read_policy(None)
    assert default["loaded"] is False
    assert "never auto-merge" in default["summary"].lower()
    # A checkout with a policy file is surfaced as loaded metadata.
    (tmp_path / ".umbra").mkdir()
    (tmp_path / ".umbra" / "nightshift.md").write_text("# Night shift policy\n\nOnly touch dependency manifests. Never delete tests.")
    loaded = read_policy(tmp_path)
    assert loaded["loaded"] is True
    assert loaded["path"] == ".umbra/nightshift.md"
    assert "Night shift policy" in loaded["summary"]


def test_make_run_id_shape() -> None:
    run_id = make_run_id("https://github.com/acme/demo", "live-watchman")
    assert run_id.startswith("umbra_")
    assert "acme-demo" in run_id
