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

### 2b. Let the Cloud Scheduler service agent mint the OIDC token

**Easy to miss — the job fails before it ever reaches Umbra without this.** To
attach an OIDC token as `umbra-scheduler`, the Cloud Scheduler *service agent* must
be allowed to act as (mint tokens for) that service account. Grant it
`roles/iam.serviceAccountTokenCreator` **on the scheduler SA** (not project-wide):

```bash
PROJECT_NUMBER="$(gcloud projects describe <PROJECT_ID> --format='value(projectNumber)')"
SCHEDULER_AGENT="service-${PROJECT_NUMBER}@gcp-sa-cloudscheduler.iam.gserviceaccount.com"

# (First-time only) ensure the Scheduler service agent exists:
gcloud beta services identity create --service=cloudscheduler.googleapis.com --project=<PROJECT_ID>

gcloud iam service-accounts add-iam-policy-binding "${SCHED_SA}" \
  --member="serviceAccount:${SCHEDULER_AGENT}" \
  --role="roles/iam.serviceAccountTokenCreator"
```

Without this binding, Cloud Scheduler cannot generate the OIDC token and the job
errors out at the scheduler side (you'll see it in the job's run history), before
Umbra is ever called.

### 2c. Tell the app which identity to trust

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

### 2d. Create the Cloud Scheduler job with OIDC (no secret in the job)

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

## 4. Post-deploy verification order (required)

Provider acceptance ≠ inbox delivery. After the infrastructure above is in place,
verify in this exact order and only call scheduling "working" after steps 5 and 6
both succeed:

1. **Deploy** the current build.
2. Confirm **`/api/health`**, the dashboard loads, and the scheduled-report UI shows
   scheduling as enabled (not "email not configured").
3. Create a **test schedule a few minutes ahead** (it sends only to your own account
   email — there is no arbitrary-recipient field).
4. Confirm **Cloud Scheduler invokes the endpoint successfully** — check the job's
   run history (a `PERMISSION_DENIED` there usually means the step 2b token-creator
   binding is missing; a 401/403 from Umbra means the SA/audience env is wrong).
5. Confirm the schedule row records **`accepted_for_delivery`** (Resend accepted).
6. Confirm the message **actually arrives in the inbox** (check spam too). If it
   showed `accepted_for_delivery` but never arrives, the issue is downstream of
   Resend acceptance (domain reputation, SPF/DKIM, filtering) — investigate in
   Resend's dashboard/logs.

**Not working until steps 5 AND 6 both succeed.** `accepted_for_delivery` alone is
provider acceptance, not inbox delivery — the UI says exactly that and nothing more.

You can also sanity-check immediate send at any time: **Email latest report now** in
Scheduled Reports sends the latest saved report to your own account address.

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
