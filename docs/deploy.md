# Deploying Umbra (Render + Vercel)

Umbra is two services: the **FastAPI backend** and the **Next.js dashboard**. This
guide puts the backend on **Render** and the dashboard on **Vercel**, both from
the `main` branch of your GitHub repo.

> **A public deploy runs in demo mode.** The live agents need the Codex CLI's
> ChatGPT login, which only exists on your local machine — Render/Vercel cannot
> authenticate to Codex. So the public URL is the safe, zero-cost demo; run the
> live money-shot locally (`UMBRA_ENABLE_LIVE_REPOS=true UMBRA_ENABLE_CODEX_CLI=true`).
> No API keys or secrets ever need to live in the cloud.

The two services depend on each other's URLs, so deploy in this order and finish
by wiring them together.

---

## 1. Backend → Render

Render reads [`render.yaml`](../render.yaml) at the repo root (a Docker web
service, `umbra-api`, already set to demo mode with a `/api/health` check).

1. In the [Render dashboard](https://dashboard.render.com): **New + → Blueprint**.
2. Connect the `bkd-dotcom/umbra` repo and select `main`. Render detects
   `render.yaml` and proposes the `umbra-api` service — **Apply**.
3. Leave the env vars as-is for now (`UMBRA_DEMO_MODE=true`; `OPENAI_API_KEY`,
   `GITHUB_TOKEN`, `UMBRA_FRONTEND_ORIGIN` blank — you'll set the last one in step 3).
4. Wait for the first deploy, then note the URL, e.g. `https://umbra-api.onrender.com`.
5. **Verify:** open `https://umbra-api.onrender.com/api/health` — expect
   `{"status":"ok","mode":"demo","ready":true}`. The API docs are at `/docs`.

> Render's free tier spins the service down after inactivity, so the first
> request after idle can take ~30–60s (cold start). Normal for a demo.

---

## 2. Frontend → Vercel

1. In [Vercel](https://vercel.com/new): **Add New… → Project**, import the same
   GitHub repo.
2. **Set Root Directory to `frontend`** (this is a monorepo — Vercel must build
   the `frontend/` subfolder). Framework preset auto-detects as **Next.js**.
3. Add an Environment Variable (Production):
   - `NEXT_PUBLIC_API_URL` = your Render URL from step 1 (e.g. `https://umbra-api.onrender.com`)
   - This is inlined at **build time**, so it must be set before the build.
4. **Deploy**, then note the URL, e.g. `https://umbra-xxx.vercel.app`.

---

## 3. Wire CORS back (the step everyone forgets)

The backend only accepts requests from the one origin in `UMBRA_FRONTEND_ORIGIN`
(defaults to `http://localhost:3000`). Point it at your Vercel URL:

1. Render → `umbra-api` → **Environment** → set
   `UMBRA_FRONTEND_ORIGIN = https://umbra-xxx.vercel.app` (no trailing slash) → **Save**.
2. Render redeploys automatically. Until this is set, the dashboard loads but its
   API calls (scan, replays, the live event stream) are blocked by CORS.

---

## 4. Verify end to end

Open your Vercel URL and click **Launch scan** / **View night shift**. It should
hit the Render backend and open the Reasoning Replay modal with the provider
ledger (`demo-cache` chips in a public deploy). The live event terminal streams
from `/api/events`.

---

## Optional: custom domain

Point a domain (e.g. `umbra.engineer`) at the Vercel project under
**Settings → Domains**. Then update `UMBRA_FRONTEND_ORIGIN` on Render to match.

## Alternative: one-box Docker

`docker-compose.yml` runs both services locally (`docker compose up`) — API on
`:8000`, dashboard on `:3000`. Useful for a self-hosted single VM, but Render +
Vercel is less setup for a public URL.
