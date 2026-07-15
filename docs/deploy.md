# Deploying Umbra (one public URL)

Umbra deploys as a **single service**: the Docker image builds the Next.js
dashboard into a static bundle and the FastAPI backend serves it, so the whole
product lives on **one URL** — no separate frontend host, no CORS to wire up.
[`render.yaml`](../render.yaml) drives this on **Render**.

> **A public deploy runs in demo mode.** The live agents need the Codex CLI's
> ChatGPT login, which only exists on your local machine — a cloud host cannot
> authenticate to Codex. So the public URL is the safe, zero-cost demo; run the
> live money-shot locally (`UMBRA_ENABLE_LIVE_REPOS=true UMBRA_ENABLE_CODEX_CLI=true`).
> No API keys or secrets ever need to live in the cloud.

---

## Deploy to Render (≈5 clicks)

1. In the [Render dashboard](https://dashboard.render.com): **New + → Blueprint**.
2. Connect the `bkd-dotcom/umbra` repo and pick `main`. Render detects
   [`render.yaml`](../render.yaml) and proposes the `umbra` service — **Apply**.
3. Leave the env var as-is (`UMBRA_DEMO_MODE=true`). Render builds the Docker
   image (Node build stage → Python serve stage); the first build takes a few
   minutes.
4. When it's live, note the URL, e.g. `https://umbra.onrender.com`. **That single
   URL is your public dashboard *and* API.**

**Verify:**

- `https://umbra.onrender.com/` → the Umbra dashboard.
- `https://umbra.onrender.com/api/health` → `{"status":"ok","mode":"demo","ready":true}`.
- Click **Launch scan** / **View night shift** — the Reasoning Replay modal opens
  with the provider ledger (`demo-cache` chips on a public deploy). The live
  terminal streams from `/api/events` on the same origin.

> Render's free tier spins the service down after inactivity, so the first
> request after idle can take ~30–60s (cold start). Normal for a demo.

---

## Run it locally (identical single-service image)

```bash
# Build the same static dashboard the deploy uses, then serve everything on :8000
cd frontend && NEXT_PUBLIC_API_URL="" npm run build && cd ..
UMBRA_DEMO_MODE=true UMBRA_STATIC_DIR="$PWD/frontend/out" \
  uvicorn backend.main:app --port 8000
# open http://localhost:8000
```

Or with Docker (mirrors Render exactly):

```bash
docker build -t umbra . && docker run -p 8000:8000 umbra
# open http://localhost:8000
```

---

## Optional: custom domain

Point a domain at the Render service under **Settings → Custom Domains**. Nothing
else changes — the app is single-origin, so there's no frontend config to update.

## Alternative: split hosting (Render + Vercel)

If you'd rather host the dashboard separately on Vercel, set the frontend's
`NEXT_PUBLIC_API_URL` to the backend URL and set `UMBRA_FRONTEND_ORIGIN` on the
backend so CORS allows it. The single-service image above is simpler and is the
recommended path.
