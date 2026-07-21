# Scheduled reports & email — production operator checklist

Umbra can email a repository's morning report: on demand ("Email latest report
now") and on a schedule (Cloud Scheduler → the app's due-scan endpoint). This
guide sets that up **securely**. Nothing here is required for the core product;
until it's configured, scheduled sends honestly report "email not configured".

> **"Accepted for delivery" is not inbox delivery.** Umbra only ever claims that
> the email provider (Resend) *accepted* the message for delivery. Bounces, spam
> filtering, and mailbox rules are outside Umbra's knowledge. Always do a real
> end-to-end inbox test (last step) before trusting delivery.

---

## 1. Email provider (Resend) via Secret Manager

Never put the Resend key in plain env vars or the image.

```bash
# Store the Resend API key as a secret and grant the Cloud Run runtime SA access.
printf '%s' "<RESEND_API_KEY>" | gcloud secrets create umbra-resend-key \
  --data-file=- --replication-policy=automatic
gcloud secrets add-iam-policy-binding umbra-resend-key \
  --member="serviceAccount:<RUNTIME_SA>" \
  --role="roles/secretmanager.secretAccessor"
```

Use a **Resend-verified sender domain**. In the Resend dashboard, add and verify
your domain (SPF/DKIM), then set the From to an address on that domain:

```
UMBRA_EMAIL_FROM="Umbra <reports@your-verified-domain>"
```

If `UMBRA_EMAIL_FROM` is on an unverified domain, Resend will reject sends and the
schedule row will show `email_rejected` — which is the honest outcome, not a bug.

---

## 2. Scheduler authentication — OIDC (do **not** put a secret in the job header)

**Do not** inject a shared secret into the Cloud Scheduler job configuration (e.g.
an `X-Umbra-Cron-Key` header). That secret is then stored in the job config and is
visible to anyone who can read the job. Use a **dedicated service account + Google
OIDC token** instead — no secret is stored in the job.

### 2a. Create a dedicated scheduler service account (least privilege)

```bash
gcloud iam service-accounts create umbra-scheduler \
  --display-name="Umbra Cloud Scheduler invoker"

SCHED_SA="umbra-scheduler@<PROJECT_ID>.iam.gserviceaccount.com"
```

Grant it **only** permission to invoke the Cloud Run service — nothing else:

```bash
gcloud run services add-iam-policy-binding umbra \
  --region=us-central1 \
  --member="serviceAccount:${SCHED_SA}" \
  --role="roles/run.invoker"
```

### 2b. Tell the app which identity to trust

```bash
# The app accepts an OIDC token ONLY from this exact service account,
# with an audience equal to the Cloud Run service URL.
UMBRA_SCHEDULER_SERVICE_ACCOUNT="${SCHED_SA}"
UMBRA_SCHEDULER_OIDC_AUDIENCE="https://<your-cloud-run-url>"   # defaults to UMBRA_PUBLIC_URL
```

The backend (`backend/scheduler_auth.py`) verifies the incoming token with the
official `google-auth` library: signature against Google's public certs, issuer,
expiry, the audience, and that the token's verified `email` equals
`UMBRA_SCHEDULER_SERVICE_ACCOUNT`. Absent/invalid/wrong-identity tokens → 401. With
neither OIDC nor the legacy key configured, the endpoint 503s — it is never
publicly triggerable.

### 2c. Create the Cloud Scheduler job with OIDC (no secret in the job)

```bash
gcloud scheduler jobs create http umbra-run-due-scans \
  --location=us-central1 \
  --schedule="*/5 * * * *" \
  --uri="https://<your-cloud-run-url>/api/cron/run-due-scans" \
  --http-method=POST \
  --oidc-service-account-email="${SCHED_SA}" \
  --oidc-token-audience="https://<your-cloud-run-url>"
```

Every 1–5 minutes is fine; the app only acts on schedules whose `next_run_at` is
due, so a frequent tick just means punctual delivery, not extra work.

### Legacy shared key (local dev / backwards-compat only)

`UMBRA_CRON_KEY` still works if set (the app checks OIDC first, then this key). It
is intended for **local development** or a transitional period — **do not** use it
as the production scheduler mechanism, and never embed it in a Cloud Scheduler
header. Prefer OIDC in production and leave `UMBRA_CRON_KEY` unset there.

---

## 3. Deploy with the new secrets/env

```bash
gcloud run deploy umbra --source . --region us-central1 --allow-unauthenticated \
  --update-secrets RESEND_API_KEY=umbra-resend-key:latest \
  --update-env-vars UMBRA_EMAIL_FROM="Umbra <reports@your-verified-domain>",\
UMBRA_SCHEDULER_SERVICE_ACCOUNT="${SCHED_SA}",\
UMBRA_SCHEDULER_OIDC_AUDIENCE="https://<your-cloud-run-url>"
```

(Existing secrets like `UMBRA_SIGNING_KEY` are preserved by `--update-*`.)

---

## 4. Real end-to-end inbox test (required)

Provider acceptance ≠ inbox delivery. After deploy, verify a message actually
arrives:

1. Sign in to the dashboard and save a scan for a repo.
2. Click **Email latest report now** in Scheduled Reports. It sends only to your
   **own account address** (there is deliberately no arbitrary-recipient field).
3. Confirm the message lands in your inbox (check spam too). If it doesn't arrive
   while the UI showed "Accepted for delivery", the issue is downstream of Resend
   acceptance (domain reputation, SPF/DKIM, filtering) — investigate in Resend's
   dashboard/logs.
4. Optionally trigger the scheduler once (or wait for the cron tick) and confirm a
   scheduled send records `accepted_for_delivery` and the email arrives.

---

## Recipient policy (why there's no "send to" box)

Reports are sent **only to the signed-in account email** — both scheduled reports
and immediate "Email latest report now" sends. There is no editable recipient
field: the schedule form shows the account email read-only, the immediate-send API
rejects any request that includes an `email` field (HTTP 422), and a schedule whose
recipient differs from the account email is refused. A user with no account email
cannot schedule or send.

This closes an email-relay/spam surface: an authenticated user can email *their*
report to *themselves*, never to an arbitrary third party. Umbra does not implement
email verification, so it does not treat any unverified address as an approved
recipient.
