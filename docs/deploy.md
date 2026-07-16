# Deploying Umbra (one public URL)

Umbra deploys as a **single service**: the Docker image builds the Next.js
dashboard into a static bundle and the FastAPI backend serves it, so the whole
product lives on **one URL** — no separate frontend host, no CORS to wire up.

**Live site:** [umbra.engineer](https://umbra.engineer) (Google Cloud Run). Sign in with GitHub
or Google, then scan your own public/private repos — findings are real (OSV, dependency graph,
git-history root-cause).

> **How live work runs on the hosted site.** Real *findings* (CVEs, dependency graph, git-history)
> run server-side without any model. For the *reasoning + Codex diffs*, there are three tiers:
> **(1)** any signed-in user can add their **own OpenAI API key** in the dashboard for live GPT
> reasoning billed to them; **(2)** the **founder account** runs full live **Codex** on the server
> — the Codex CLI + a mounted ChatGPT credential (Secret Manager), hard-gated to
> `UMBRA_FOUNDER_IDS` so no visitor can spend those credits; **(3)** everyone else sees findings
> plus an honest "Codex runs on your machine" label. Run the full local money-shot with
> `UMBRA_ENABLE_LIVE_REPOS=true UMBRA_ENABLE_CODEX_CLI=true` on your own `codex login`.

---

## Google Cloud Run (the deployed path)

Cloud Run runs the Docker container directly, injects `$PORT` (the Dockerfile
already honors it), supports SSE streaming, and scales to zero. One command
builds remotely with Cloud Build and deploys:

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
gcloud run deploy umbra \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars UMBRA_DEMO_MODE=true
```

`gcloud` prints the service URL when it finishes (a few minutes for the first
build). Redeploy after any change by re-running the same command.

**Verify:**

- `<URL>/` → the Umbra dashboard.
- `<URL>/api/health` → `{"status":"ok","mode":"demo","ready":true}`.
- `<URL>/api/events` → `text/event-stream` (the live terminal feed).
- Click **Launch scan** — the Reasoning Replay modal opens with the provider
  ledger (`demo-cache` chips on a public deploy).

---

## Alternative: Render

[`render.yaml`](../render.yaml) defines the same single service for Render:
**New + → Blueprint** in the [Render dashboard](https://dashboard.render.com),
connect `bkd-dotcom/umbra` on `main`, **Apply**. Render builds the same Docker
image and gives a `*.onrender.com` URL. (Free tier cold-starts after idle.)

## Run it locally (identical single-service image)

```bash
cd frontend && NEXT_PUBLIC_API_URL="" npm run build && cd ..
UMBRA_DEMO_MODE=true UMBRA_STATIC_DIR="$PWD/frontend/out" \
  uvicorn backend.main:app --port 8000
# open http://localhost:8000
```

Or with Docker (mirrors the cloud build exactly):

```bash
docker build -t umbra . && docker run -p 8000:8000 umbra
# open http://localhost:8000
```

---

## Optional: custom domain

Cloud Run: **Manage Custom Domains** (or a load balancer) → map your domain.
The app is single-origin, so there's nothing else to reconfigure.
