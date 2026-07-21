# Production secrets — generate & set before judging

Umbra boots fine without these (dev fallbacks), but then receipts are signed with a
*known* dev key: the UI shows a "dev key" chip and the server logs a startup warning.
Setting these three makes the **"verify against our own pinned public key"** claim
airtight for judges. Deploy target is **Google Cloud Run** (see `docs/deploy.md`).

## 1. Generate the three values

Run locally (uses the same crypto libs the app expects):

```bash
uv run python - <<'PY'
import secrets, base64
from cryptography.fernet import Fernet
print("SESSION_SECRET=" + secrets.token_urlsafe(48))
print("UMBRA_FERNET_KEY=" + Fernet.generate_key().decode())   # urlsafe-b64, 32 bytes
print("UMBRA_SIGNING_KEY=" + base64.b64encode(secrets.token_bytes(32)).decode())  # b64 of 32 raw bytes
PY
```

- `SESSION_SECRET` — any long random string (signs session cookies).
- `UMBRA_FERNET_KEY` — a Fernet key (encrypts stored GitHub/OpenAI tokens at rest).
- `UMBRA_SIGNING_KEY` — base64 of 32 raw bytes → the Ed25519 seed that signs receipts.
  **Keep this stable forever** — rotating it changes the public key and invalidates
  every previously issued receipt.

## 2. Store them in Secret Manager + wire to Cloud Run

```bash
PROJECT=your-gcp-project
for k in SESSION_SECRET UMBRA_FERNET_KEY UMBRA_SIGNING_KEY; do
  # paste the value when prompted (or pipe from a file you delete after)
  printf '%s' "$VALUE_FOR_$k" | gcloud secrets create "$k" --data-file=- --project "$PROJECT" 2>/dev/null \
    || printf '%s' "$VALUE_FOR_$k" | gcloud secrets versions add "$k" --data-file=- --project "$PROJECT"
done

gcloud run services update umbra \
  --region YOUR_REGION --project "$PROJECT" \
  --update-secrets=SESSION_SECRET=SESSION_SECRET:latest,UMBRA_FERNET_KEY=UMBRA_FERNET_KEY:latest,UMBRA_SIGNING_KEY=UMBRA_SIGNING_KEY:latest
```

(Also ensure `UMBRA_TRUST_PROXY=true` is set on Cloud Run so the public-live rate
limiter reads the real client IP from `X-Forwarded-For` behind the load balancer.)

## 3. Verify it took

```bash
# Public key is now stable (same across restarts) and NOT the dev key:
curl -s https://umbra.engineer/api/verify-key

# A fresh admission receipt should NOT report key_ephemeral: true
curl -s -X POST https://umbra.engineer/api/admit -d '{"fixture":"permitted-dependency-fix"}' \
  | python3 -c "import sys,json; r=json.load(sys.stdin)['receipt']['receipt']; print('key_ephemeral:', r.get('key_ephemeral'))"
# → key_ephemeral: False
```

In the dashboard's Agent Admission panel, the receipt should no longer show the amber
**"dev key"** chip. Startup logs should no longer print the "INSECURE dev fallbacks" warning.

## Optional live-Codex env (founder only)
`UMBRA_ENABLE_CODEX_CLI=true`, and for gVisor/Cloud Run where Codex's own sandbox can't
init, `UMBRA_CODEX_SANDBOX=workspace-write` (or, only if you accept the container as the
isolation boundary, `UMBRA_CODEX_SANDBOX=bypass` **plus** `UMBRA_ALLOW_UNSAFE_CODEX=true`
— the second flag is required by design and logged loudly every run).
