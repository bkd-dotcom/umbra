# Umbra showcase — the click-path walkthrough

A repeatable, ~5-minute walkthrough of the **deployed platform** for a live demo
or a prospect. Unlike [DEMO_SCRIPT.md](DEMO_SCRIPT.md) (a video shot list), this is
the exact sequence of clicks and commands to show Umbra *working* end to end.

> One line to open with: **"Coding agents can now change your repo. Umbra decides
> how much authority each change has earned — and proves it with a signed receipt.
> `auto_merge` is always false; a human merges."**

Everything below works on the deployed site. The offline path (`make judge`) is the
fallback if the network is flaky — it needs no sign-in and no keys.

---

## 0. Before you start

- Deploy is current: `make deploy-verify` shows every route `200` (see
  [deploy.md](deploy.md)).
- Have a repo in mind to admit (a public one like `expressjs/express`, or your own
  after sign-in).

## 1. The landing (15s) — the pitch

Open **[umbra.engineer](https://umbra.engineer)**.

- Point at the hero and the honest capability matrix: Umbra sits *above* AI review
  / dependency bots — it decides if a change is **allowed at all**.
- Click **Get started** (top of the final CTA) to show the product onboarding.

## 2. Get Started (30s) — every surface, one page

On **`/start`**, walk the six steps out loud:

1. Install the CLI — `brew install bkd-dotcom/umbra/umbra` / `pip install umbra-core` / the `curl … | sh` one-liner.
2. `umbra init` — scaffold a contract.
3. `umbra admit` — govern a change.
4. The GitHub Action snippet — the required check.
5. Editor plugins (Claude Code / Cursor / Codex / pre-commit) + any MCP client.
6. The console.

> Message: "Same admission pipeline everywhere — CLI, CI, editor, hosted. One
> result type: the Admission Decision Pack."

## 3. Run an admission (90s) — the core loop

Open the **dashboard** → **Agent Admission** panel.

- **Zero-setup proof first:** run a committed fixture (no sign-in, no network).
  Show the **Admission Decision Pack**: verdict, earned **authority L0/L1/L2**,
  contract result, **trust boundary** (quarantined injection), **checks** (base vs
  changed + sandbox tier), **dual verifier**, and the **proposed diff**.
- Then the adversarial fixture: the README injection is **redacted on disk before
  the agent runs**, the attacker's out-of-scope edits never enter the changeset,
  and the in-scope fix still earns branch-PR.
- **Live (optional):** paste a public repo URL for a real clone + live OSV. On the
  hosted site, live Codex is founder-gated; other users add their **own** OpenAI
  key or run the CLI locally (say this honestly).

## 4. Verify the receipt (30s) — proof, not a claim

- Click **Verify receipt** — it checks the Ed25519 signature against Umbra's
  **pinned public key** (`/api/verify-key`), so it proves *Umbra* issued it.
- Mention `umbra gates receipt.json` on the CLI: **G1** capability integrity ·
  **G2** behavioral authenticity · **G3** interaction auditability — each
  `pass`/`fail`/`unproven`, never green on missing evidence.

## 5. Mission Control (30s) — the org view

Open **`/dashboard/overview`** (header → **Org overview**).

- Multi-repo health: **L0/L1/L2 distribution**, avg score, branch-PR count.
- The **per-repo authority table** — executor, receipt hash, expiry.
- Passport lifecycle banner: revoked / expired / expiring are counted honestly as
  **L0**, never the level they once earned.

## 6. Emergency brake (20s) — you're in control

- On a repo that earned L2, hit **Emergency brake**. It durably revokes to L0
  server-side; a subsequent PR-open for that repo is blocked until admission
  re-earns authority. (If Slack is configured via `UMBRA_SLACK_WEBHOOK_URL`, the
  brake pings the channel.)

## 7. Install as an app (15s) — the PWA

- In Chrome/Edge, click the **install** icon in the address bar (or "Add to Home
  Screen" on mobile). It installs standalone, opening straight to Mission Control.
- Note the honesty guarantee: the service worker caches only the **static shell** —
  it **never** caches `/api`, so governed data (passports, receipts) is always live.

## 8. Close (10s)

> "Any agent can *propose* a change. Only Umbra *admits* authority and seals a
> receipt an auditor can verify offline — and it never merges. That's the
> change-control plane for coding agents."

Links to leave on screen: **[docs](https://bkd-dotcom.github.io/umbra-core/)** ·
**[umbrella / all repos](https://github.com/bkd-dotcom/umbra-umbrella)** ·
**[PyPI](https://pypi.org/project/umbra-core/)**.

---

## Offline fallback (no network / no sign-in)

```bash
make judge              # admit a fixture → earns L2 → verifies the signed receipt → OK
make judge-adversarial  # prompt-injection redacted on disk; in-scope fix still permitted
```

Both run deterministically with no keys and no network — the safe demo path.
