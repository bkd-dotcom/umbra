# Pre-submission checklist — OpenAI Build Week

**Deadline: Tuesday, July 21, 5:00 PM PT.** Everything below is a submission action
(the code/product is done and verified — 282 backend tests pass, tsc + build clean,
endpoints verified live). Work top-to-bottom.

---

## 🔴 BLOCKERS (submission fails without these)

- [ ] **Make the repo judge-accessible.** `https://github.com/bkd-dotcom/umbra` currently
      returns **404** (private or wrong URL). Judges must be able to read the code. Either:
  - Make it **public** (Settings → General → Danger Zone → Change visibility → Public), **or**
  - Keep private and add collaborators **`testing@devpost.com`** and **`build-week-event@openai.com`**
      (Settings → Collaborators).
  - Then re-check: `curl -o /dev/null -w "%{http_code}\n" https://github.com/bkd-dotcom/umbra` → must be **200**.
  - Confirm `main` is pushed and current (`git status`, `git log origin/main..HEAD` empty).
  - Confirm `LICENSE` (MIT) is present at repo root. ✅ (it is)

- [ ] **Record & upload the <3-min demo video** (public, unlisted-OK YouTube).
  - Use [`docs/VIDEO_TELEPROMPTER.md`](VIDEO_TELEPROMPTER.md) — word-for-word, timed to 2:55.
  - MUST narrate **how Codex AND GPT-5.6 were used** (rubric requirement, scored twice).
  - Lead with **Agent Admission** (the differentiator), crew last.
  - Safe path: the offline fixtures + captured proof scan need no network — never let the demo depend on a live call.

- [ ] **Publish the Devpost entry** (currently an "Untitled" draft).
  - Paste from [`docs/DEVPOST_COPY.md`](DEVPOST_COPY.md) (name, tagline, all fields).
  - Category: **Developer Tools**.
  - Attach: the video URL, repo URL, live URL (`https://umbra.engineer`).
  - Enter the **/feedback Codex Session ID** (see below).
  - Click **Submit** (a saved draft is NOT submitted).

- [ ] **Confirm the `/feedback` Codex Session ID.** Current value in the docs:
      `019f66b8-a2ce-7103-aaed-2f60900d1aab`. Verify this is the session where the core
      functionality was built (the form asks for "where the majority of the core
      functionality" was built). If you built across sessions, use the primary one.

---

## 🟠 STRONGLY RECOMMENDED (protects your score before judges test live)

- [ ] **Set the 3 production secrets** so receipts sign with a managed key, not the dev
      fallback. Follow [`docs/DEPLOY_SECRETS.md`](DEPLOY_SECRETS.md). Without these, the UI
      honestly shows a "dev key" chip and the server logs a warning — not fatal, but a
      managed key makes the "verify against our pinned public key" claim airtight.
  - [ ] `SESSION_SECRET`
  - [ ] `UMBRA_FERNET_KEY`
  - [ ] `UMBRA_SIGNING_KEY`
  - [ ] After deploy: `curl https://umbra.engineer/api/verify-key` returns a stable key, and
        a fresh admission receipt shows **no** `key_ephemeral: true`.

- [ ] **Smoke-test the live site as a judge would** (incognito, no login):
  - [ ] `https://umbra.engineer` loads; hero reads "Trust, earned and proven."; the
        **Agent Admission** section renders with the trust ladder.
  - [ ] Hero CTA **"Run the Admission demo"** → dashboard → the **"For judges"** card shows.
  - [ ] In Zone 02, run the 3 fixtures: permitted → **L2**, forbidden → **L0**, failing-check → **L1**.
  - [ ] **Verify receipt** → "verified"; **Emergency brake** → shows the honest preview note.
  - [ ] Open the **captured proof scan** → real diff + provider ledger render.
  - [ ] (If live enabled) the **"Run a live admission on a public repo"** button works and is rate-limited.
  - [ ] ChatGPT: import `https://umbra.engineer/openapi-actions.yaml` (auth None) → "Scan github.com/expressjs/express".

- [ ] **`make judge` works from a clean clone** (the one-command proof):
  - [ ] `git clone …; cd umbra; uv sync; make judge` → prints earned **L2** + receipt **verified → OK**.

---

## 🟢 OPTIONAL (only real lever left for a perfect "Impact" score)

- [ ] **One real-user validation quote.** A single message/screenshot from a platform or
      security lead who says "I'd use this to prove our Codex rollout stayed in bounds."
      Add it to the Devpost description. This is the one thing code can't manufacture and
      it directly moves the Seshan-style "is the pain real?" axis.

---

## Reference — the four judging criteria (from the live Build Week page)

1. **Technological Implementation** — how thoroughly/skillfully it uses Codex; genuine,
   non-trivial, working. → real `codex exec`, GPT-5.6 Responses API, 282 tests, signed receipts.
2. **Design** — complete, coherent, runnable product (not a POC). → multi-surface, polished, judge path.
3. **Potential Impact** — credible, specific problem for a real audience. → `docs/WHO_ITS_FOR.md`, OWASP citations.
4. **Quality of the Idea** — creative, novel, differentiated. → admission-first, earned authority, signed receipts.

## What's already done (no action needed)
- 282 backend tests pass · `tsc` + `npm run build` clean · overflow 0 at all breakpoints.
- a11y: single `<h1>` per page, accessible dialogs (focus trap/Escape), honest scan progress + cancel.
- Endpoints verified live: `/api/admit`, `/api/receipt/verify`, `/api/verify-key`, `/api/admit/public-live`.
- Evidence docs: `CODEX_USAGE.md`, `WHO_ITS_FOR.md`, `DEMO_SCRIPT.md`, `Makefile` (`make judge`).
