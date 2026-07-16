# Umbra GitHub App — install-once PR auto-review

Umbra's autonomous PR review is an **install-once GitHub App**. A user installs it on their account or
org (choosing repos in GitHub's own UI), and every new pull request gets one advisory review comment —
public or private repos, any account, **never merges**. There are no per-repo webhooks and no stored user
token: reviews are posted **as the App**, using a short-lived installation token minted from the App's
private key.

## How it works

1. A single app-level webhook (`POST /api/github/app/webhook`) receives PR events for **every**
   installation. Each delivery is HMAC-verified against the App's webhook secret.
2. On a reviewable PR (`opened` / `reopened` / `synchronize` / `ready_for_review`), Umbra mints an
   installation access token from the App's private key (`GithubIntegration.get_access_token`), reads the
   PR diff, runs the Reviewer (comment-only, `allow_codex=False`), and posts one comment.
3. The install's repos are tracked from the `installation` / `installation_repositories` events so the
   dashboard can show what's covered. The `Setup URL` links an install to the signed-in Umbra user.

The installation token is short-lived, used read-only for the diff/clone and comment-only to post — it is
**never** passed to the Codex child process.

## One-time setup (operator)

Create the App under your GitHub account (this is the only step Umbra cannot do for you):

1. GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. **Name:** `Umbra Engineer` (this sets the install slug). **Homepage:** `https://umbra.engineer`.
3. **Webhook:** Active ✓ · **URL** `https://umbra.engineer/api/github/app/webhook` · **Secret:** a fresh
   random string (save it).
4. **Repository permissions:** Pull requests → **Read & write**; Contents → **Read-only**; Metadata →
   Read-only (default).
5. **Subscribe to events:** Pull request.
6. **Where can this be installed:** Any account.
7. **Setup URL:** `https://umbra.engineer/api/github/app/setup` (optionally check "Redirect on update").
8. **Create**, then note the **App ID** and the **slug** (from the App's URL), and **Generate a private
   key** (downloads a `.pem`).

## Provision the secrets (Cloud Run)

```bash
PROJECT=calm-photon-472423-h3
printf %s "<APP_ID>"          | gcloud secrets create umbra-gh-app-id --data-file=- --project $PROJECT
printf %s "<WEBHOOK_SECRET>"  | gcloud secrets create umbra-gh-app-webhook-secret --data-file=- --project $PROJECT
gcloud secrets create umbra-gh-app-key --data-file=umbra-engineer.private-key.pem --project $PROJECT

gcloud run services update umbra --region us-central1 --project $PROJECT \
  --update-env-vars GITHUB_APP_SLUG=<slug> \
  --update-secrets GITHUB_APP_ID=umbra-gh-app-id:latest,GITHUB_APP_WEBHOOK_SECRET=umbra-gh-app-webhook-secret:latest,GITHUB_APP_PRIVATE_KEY=umbra-gh-app-key:latest
```

`GITHUB_APP_PRIVATE_KEY` accepts a raw PEM (newlines preserved by the secret mount) or base64 of the PEM.
Never paste the private key or webhook secret into code, logs, or chat.

## Verify

- Before secrets land: `GET /api/github/app` → `{"configured": false}`; `POST /api/github/app/webhook`
  (no valid signature) → **503**.
- After secrets land: `GET /api/github/app` → `{"configured": true, "install_url": "https://github.com/apps/<slug>/installations/new"}`;
  an unsigned/bad-signature POST → **401**; a validly-signed `ping` → **200**.
- End-to-end: install the App on a repo → open a PR → an **🌑 Umbra Review** comment appears within a few
  seconds; the dashboard lists the repo under "Autonomous PR auto-review". Failures are logged under the
  `umbra.webhook` logger (grep Cloud Run logs).

## Local development

Set `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_WEBHOOK_SECRET`, and `GITHUB_APP_PRIVATE_KEY` in your
env (see [`.env.example`](../.env.example)) and expose `POST /api/github/app/webhook` to GitHub with a
tunnel (e.g. `cloudflared` / `ngrok`); point the App's webhook URL at the tunnel while testing.
