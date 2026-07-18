// AUTO-CAPTURED PROOF SCAN — do not hand-edit.
// A genuine live scan (Codex CLI enabled) of Pranav-Karra-3301/calhacks-12, captured 2026-07-17:
// 26 real OSV advisories on next@14.2.5, real Codex-proposed diffs (Watchman +
// Janitor), Reviewer honestly falling back to a deterministic risk score. Bundled
// so a judge can open a *working* scan instantly instead of waiting ~90s for a
// live run. The UI labels this "CAPTURED SCAN" — it is never presented as running
// live. Disposable-clone temp paths are rewritten to repo-relative before bundling.
// Re-capture with the scan API and regenerate this file to refresh.
export const PROOF_CAPTURED_AT = "2026-07-17";
export const PROOF_REPO = "Pranav-Karra-3301/calhacks-12";
export const PROOF_SCAN = {
  "umbra_score": 0,
  "source": "live",
  "repo_url": "https://github.com/Pranav-Karra-3301/calhacks-12",
  // Auditable-layer metadata (compatible with a live scan result). The backend
  // computes evidence_hash from the canonical result on export, so it is omitted
  // here; run_id/autonomy/policy render the Autonomy + Policy cards for the proof.
  "run_id": "umbra_20260717_pranav-karra-3301-calhacks-12_captured",
  "captured_at": PROOF_CAPTURED_AT,
  "autonomy": { "level": 1, "label": "Prepare diff", "auto_merge": false, "human_review_required": true },
  "policy": { "loaded": false, "summary": "Default Umbra policy applied: prepare reviewable work, never auto-merge." },
  "reasoning_summary": "Live Watchman checked 11 manifest dependencies and found 26 OSV advisories. Updated `next` from `^14.2.5` to patched `^14.2.33` in:\n\n- [package.json](package.json)\n- [package-lock.json](package-lock.json)\n\nVerification:\n\n- `npm audit --offline --json` — 0 vulnerabilities\n- `git diff --check` — passed\n- `npm run typecheck` — blocked; offline install could not fetch uncached `ws@8.18.3` package.",
  "vulnerabilities": [
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-36qx-fr4f-26g5",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js has a Middleware / Proxy bypass in Pages Router applications using i18n"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-3g8h-86w9-wvmq",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js's Middleware / Proxy redirects can be cache-poisoned"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-3h52-269p-cp9r",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Information exposure in Next.js dev server due to lack of origin verification"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-3x4c-7xq6-9pq8",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js: Unbounded next/image disk cache growth can exhaust storage"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-4342-x723-ch2f",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js Improper Middleware Redirect Handling Leads to SSRF"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-5j59-xgg2-r9c4",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next has a Denial of Service with Server Components - Incomplete Fix Follow-Up"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-7gfc-8cq8-jh5f",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js authorization bypass vulnerability"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-7m27-7ghc-44w9",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js Allows a Denial of Service (DoS) with Server Actions"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-8h8q-6873-q5fj",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js Vulnerable to Denial of Service with Server Components"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-9g9p-9gw9-jx7f",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js self-hosted applications vulnerable to DoS via Image Optimizer remotePatterns configuration"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-c4j6-fc7j-m34r",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js vulnerable to server-side request forgery in applications using WebSocket upgrades"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-f82v-jwr5-mffw",
      "severity": "high",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Authorization Bypass in Next.js Middleware"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-ffhc-5mcf-pf4q",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js vulnerable to cross-site scripting in App Router applications using CSP nonces"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-g5qg-72qw-gw5v",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js Affected by Cache Key Confusion for Image Optimization API Routes"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-g77x-44xx-532m",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Denial of Service condition in Next.js image optimization"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-ggv3-7p47-pfv8",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js: HTTP request smuggling in rewrites"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-gp8f-8m3g-qvj9",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js Cache Poisoning"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-gx5p-jg67-6x7h",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js has cross-site scripting in beforeInteractive scripts with untrusted input"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-h25m-26qc-wcjf",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js HTTP request deserialization can lead to DoS when using insecure React Server Components"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-h64f-5h5j-jqjh",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js has a Denial of Service in the Image Optimization API"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-mwv6-3258-q52c",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next Vulnerable to Denial of Service with Server Components"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-q4gf-8mx6-v5v3",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js has a Denial of Service with Server Components"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-qpjv-v59x-3qc4",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js Race Condition to Cache Poisoning"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-vfv6-92ff-j949",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js vulnerable to cache poisoning via collisions in React Server Component cache-busting"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-wfc6-r584-vfw7",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js vulnerable to cache poisoning in React Server Component responses"
    },
    {
      "package": "next",
      "version": "14.2.5",
      "cve": "GHSA-xv57-4mr9-wg8v",
      "severity": "medium",
      "owasp": "A06: Vulnerable and Outdated Components",
      "summary": "Next.js Content Injection Vulnerability for Image Optimization"
    }
  ],
  "dependencies": [
    {
      "name": "@deepgram/sdk",
      "version": "4.11.2",
      "ecosystem": "npm",
      "vulnerable": false
    },
    {
      "name": "@livekit/components-react",
      "version": "2.6.4",
      "ecosystem": "npm",
      "vulnerable": false
    },
    {
      "name": "@supabase/supabase-js",
      "version": "2.76.1",
      "ecosystem": "npm",
      "vulnerable": false
    },
    {
      "name": "clsx",
      "version": "2.1.1",
      "ecosystem": "npm",
      "vulnerable": false
    },
    {
      "name": "livekit-client",
      "version": "2.5.8",
      "ecosystem": "npm",
      "vulnerable": false
    },
    {
      "name": "livekit-server-sdk",
      "version": "2.6.1",
      "ecosystem": "npm",
      "vulnerable": false
    },
    {
      "name": "next",
      "version": "14.2.5",
      "ecosystem": "npm",
      "vulnerable": true
    },
    {
      "name": "qrcode.react",
      "version": "4.2.0",
      "ecosystem": "npm",
      "vulnerable": false
    },
    {
      "name": "react",
      "version": "18.2.0",
      "ecosystem": "npm",
      "vulnerable": false
    },
    {
      "name": "react-dom",
      "version": "18.2.0",
      "ecosystem": "npm",
      "vulnerable": false
    },
    {
      "name": "tailwind-merge",
      "version": "2.5.2",
      "ecosystem": "npm",
      "vulnerable": false
    }
  ],
  "live_agents": [
    "watchman",
    "janitor"
  ],
  "agent_results": [
    {
      "agent": "watchman",
      "summary": "Live Watchman checked 11 manifest dependencies and found 26 OSV advisories. Updated `next` from `^14.2.5` to patched `^14.2.33` in:\n\n- [package.json](package.json)\n- [package-lock.json](package-lock.json)\n\nVerification:\n\n- `npm audit --offline --json` — 0 vulnerabilities\n- `git diff --check` — passed\n- `npm run typecheck` — blocked; offline install could not fetch uncached `ws@8.18.3` package.",
      "findings": [
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-36qx-fr4f-26g5",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js has a Middleware / Proxy bypass in Pages Router applications using i18n"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-3g8h-86w9-wvmq",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js's Middleware / Proxy redirects can be cache-poisoned"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-3h52-269p-cp9r",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Information exposure in Next.js dev server due to lack of origin verification"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-3x4c-7xq6-9pq8",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js: Unbounded next/image disk cache growth can exhaust storage"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-4342-x723-ch2f",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js Improper Middleware Redirect Handling Leads to SSRF"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-5j59-xgg2-r9c4",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next has a Denial of Service with Server Components - Incomplete Fix Follow-Up"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-7gfc-8cq8-jh5f",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js authorization bypass vulnerability"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-7m27-7ghc-44w9",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js Allows a Denial of Service (DoS) with Server Actions"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-8h8q-6873-q5fj",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js Vulnerable to Denial of Service with Server Components"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-9g9p-9gw9-jx7f",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js self-hosted applications vulnerable to DoS via Image Optimizer remotePatterns configuration"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-c4j6-fc7j-m34r",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js vulnerable to server-side request forgery in applications using WebSocket upgrades"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-f82v-jwr5-mffw",
          "severity": "high",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Authorization Bypass in Next.js Middleware"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-ffhc-5mcf-pf4q",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js vulnerable to cross-site scripting in App Router applications using CSP nonces"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-g5qg-72qw-gw5v",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js Affected by Cache Key Confusion for Image Optimization API Routes"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-g77x-44xx-532m",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Denial of Service condition in Next.js image optimization"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-ggv3-7p47-pfv8",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js: HTTP request smuggling in rewrites"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-gp8f-8m3g-qvj9",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js Cache Poisoning"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-gx5p-jg67-6x7h",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js has cross-site scripting in beforeInteractive scripts with untrusted input"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-h25m-26qc-wcjf",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js HTTP request deserialization can lead to DoS when using insecure React Server Components"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-h64f-5h5j-jqjh",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js has a Denial of Service in the Image Optimization API"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-mwv6-3258-q52c",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next Vulnerable to Denial of Service with Server Components"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-q4gf-8mx6-v5v3",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js has a Denial of Service with Server Components"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-qpjv-v59x-3qc4",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js Race Condition to Cache Poisoning"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-vfv6-92ff-j949",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js vulnerable to cache poisoning via collisions in React Server Component cache-busting"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-wfc6-r584-vfw7",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js vulnerable to cache poisoning in React Server Component responses"
        },
        {
          "package": "next",
          "version": "14.2.5",
          "cve": "GHSA-xv57-4mr9-wg8v",
          "severity": "medium",
          "owasp": "A06: Vulnerable and Outdated Components",
          "summary": "Next.js Content Injection Vulnerability for Image Optimization"
        }
      ],
      "replay": {
        "agent": "watchman",
        "prompt": "Inspect confirmed OSV advisories. If a compatible patched version exists, make the smallest dependency-only fix, run focused tests, and leave the working tree reviewable.",
        "codex_diff": "diff --git a/package-lock.json b/package-lock.json\nindex 7496106..4901242 100644\n--- a/package-lock.json\n+++ b/package-lock.json\n@@ -14,7 +14,7 @@\n         \"clsx\": \"^2.1.1\",\n         \"livekit-client\": \"^2.5.8\",\n         \"livekit-server-sdk\": \"^2.6.1\",\n-        \"next\": \"^14.2.5\",\n+        \"next\": \"^14.2.33\",\n         \"qrcode.react\": \"^4.2.0\",\n         \"react\": \"^18.2.0\",\n         \"react-dom\": \"^18.2.0\",\ndiff --git a/package.json b/package.json\nindex b1bb2f3..98b2377 100644\n--- a/package.json\n+++ b/package.json\n@@ -17,7 +17,7 @@\n     \"clsx\": \"^2.1.1\",\n     \"livekit-client\": \"^2.5.8\",\n     \"livekit-server-sdk\": \"^2.6.1\",\n-    \"next\": \"^14.2.5\",\n+    \"next\": \"^14.2.33\",\n     \"qrcode.react\": \"^4.2.0\",\n     \"react\": \"^18.2.0\",\n     \"react-dom\": \"^18.2.0\",\n",
        "tests": "Updated `next` from `^14.2.5` to patched `^14.2.33` in:\n\n- [package.json](package.json)\n- [package-lock.json](package-lock.json)\n\nVerification:\n\n- `npm audit --offline --json` — 0 vulnerabilities\n- `git diff --check` — passed\n- `npm run typecheck` — blocked; offline install could not fetch uncached `ws@8.18.3` package.",
        "reasoning": "Updated `next` from `^14.2.5` to patched `^14.2.33` in:\n\n- [package.json](package.json)\n- [package-lock.json](package-lock.json)\n\nVerification:\n\n- `npm audit --offline --json` — 0 vulnerabilities\n- `git diff --check` — passed\n- `npm run typecheck` — blocked; offline install could not fetch uncached `ws@8.18.3` package.",
        "timings": {
          "osv_ms": 340,
          "codex_ms": 59666,
          "reasoning_ms": 532
        },
        "providers": {
          "vulnerabilities": "osv.dev",
          "reasoning": "codex-cli",
          "engineering": "codex-cli"
        }
      }
    },
    {
      "agent": "reviewer",
      "summary": "Cached Reviewer replay.",
      "findings": [
        {
          "risk_score": 45,
          "severity": "medium",
          "blast_radius": "Cached replay only.",
          "missing_tests": "unknown",
          "recommendation": "human review required"
        }
      ],
      "replay": {
        "agent": "reviewer",
        "prompt": "Review a pull request diff without editing.",
        "codex_diff": "",
        "tests": "No open pull request was available for live review.",
        "reasoning": "No open pull request was available for live review.",
        "timings": {
          "codex_ms": 0,
          "reasoning_ms": 0
        },
        "providers": {
          "review": "cache-fallback",
          "reasoning": "demo-cache",
          "risk": "deterministic"
        }
      }
    },
    {
      "agent": "janitor",
      "summary": "Live Janitor produced 1 changed files.",
      "findings": [
        {
          "file": "lib/livekit-audio.ts",
          "symbol": null,
          "kind": "unused_import"
        }
      ],
      "replay": {
        "agent": "janitor",
        "prompt": "Find behavior-preserving dead code, unused imports, and orphaned environment variables. Make one smallest focused cleanup change, run relevant tests, and do not push, commit, or merge.",
        "codex_diff": "diff --git a/lib/livekit-audio.ts b/lib/livekit-audio.ts\nindex 193dfaf..2606b30 100644\n--- a/lib/livekit-audio.ts\n+++ b/lib/livekit-audio.ts\n@@ -1,4 +1,4 @@\n-import { Room, LocalAudioTrack, createLocalAudioTrack, Track } from 'livekit-client'\n+import { Room, LocalAudioTrack, Track } from 'livekit-client'\n \n /**\n  * Convert audio blob to AudioBuffer for processing\n",
        "tests": "Removed the unused `createLocalAudioTrack` import from [lib/livekit-audio.ts](<lib/livekit-audio.ts:1>).\n\nValidation:\n\n- `git diff --check` passed.\n- `npm run typecheck` could not run because dependencies are not installed (`tsc: command not found`).\n\nNo commit, push, or external changes were made.",
        "reasoning": "Removed the unused `createLocalAudioTrack` import from [lib/livekit-audio.ts](<lib/livekit-audio.ts:1>).\n\nValidation:\n\n- `git diff --check` passed.\n- `npm run typecheck` could not run because dependencies are not installed (`tsc: command not found`).\n\nNo commit, push, or external changes were made.",
        "timings": {
          "codex_ms": 34035,
          "reasoning_ms": 447
        },
        "providers": {
          "engineering": "codex-cli",
          "reasoning": "codex-cli"
        }
      }
    }
  ]
} as const;
