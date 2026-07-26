# Umbra — judge & dev shortcuts.
# The `judge` target proves the whole loop with ONE command, no sign-in, no network:
# it runs the Agent Admission Test on a hermetic fixture, prints the earned authority,
# and verifies the Ed25519-signed receipt against Umbra's own pinned public key.

.PHONY: judge judge-adversarial test serve help deploy deploy-verify

help:
	@echo "make judge             # run admission on the permitted fixture + verify the signed receipt"
	@echo "make judge-adversarial # run the prompt-injection fixture (redacted, still permitted)"
	@echo "make test              # run the backend test suite (309 tests)"
	@echo "make serve             # run the API locally on :8000"
	@echo "make deploy            # build + deploy to Google Cloud Run (needs gcloud auth)"
	@echo "make deploy-verify     # curl the live URL and check the key routes return 200"

# One command that closes the loop: admit a fixture, then independently verify the
# receipt it produced. Prints the earned authority level and the verification result.
judge:
	@uv run python -c "import json; \
from backend.orchestrator import orchestrator; import asyncio; \
from backend.receipt import verify_receipt; \
r = asyncio.run(orchestrator.admit(repo_url='', fixture='permitted-dependency-fix')); \
print('── Agent Admission Test · permitted-dependency-fix ─────────────'); \
print('  outcome        :', r['outcome']); \
print('  authority      : L%d · %s' % (r['authority_level'], r['authority_label'])); \
print('  auto_merge     :', r['auto_merge'], '(never true)'); \
print('  contract passed:', r['contract_result']['passed']); \
print('  checks passed  :', r['checks']['all_passed']); \
print('  executor       :', r['executor']); \
v = verify_receipt(r['receipt']); \
print('── Receipt verification (against Umbra pinned key) ─────────────'); \
print('  verified       :', v.get('verified')); \
print('  issuer         :', v.get('issuer', 'umbra')); \
print('────────────────────────────────────────────────────────────────'); \
print('OK' if (r['authority_level']==2 and v.get('verified')) else 'FAIL')"

judge-adversarial:
	@uv run python -c "import json; \
from backend.orchestrator import orchestrator; import asyncio; \
r = asyncio.run(orchestrator.admit(repo_url='', fixture='adversarial-readme-injection')); \
print('── adversarial-readme-injection ───────────────────────────────'); \
print('  trust boundary clean :', r['trust_boundary']['clean']); \
print('  quarantined count    :', r['trust_boundary']['quarantined_count']); \
print('  authority            : L%d · %s' % (r['authority_level'], r['authority_label'])); \
print('  (injection redacted on disk; the in-scope fix is still permitted)')"

test:
	uv run pytest -q

serve:
	uv run uvicorn backend.main:app --reload --port 8000

# --- Deploy (Google Cloud Run) ---------------------------------------------
# One command builds the image remotely (Cloud Build: Next.js static export +
# FastAPI) and deploys it, so the whole product is one URL. Requires an
# authenticated gcloud (`gcloud auth login`) and a project set. Existing env
# vars / mounted secrets on the service are preserved unless overridden. See
# docs/deploy.md for the founder-Codex / GitHub App / email secrets.
#
# Override the region/service if needed:  make deploy REGION=us-central1 SERVICE=umbra
REGION  ?= us-central1
SERVICE ?= umbra
URL     ?= https://umbra.engineer

deploy:
	@command -v gcloud >/dev/null 2>&1 || { echo "error: gcloud not found — install the Google Cloud SDK"; exit 1; }
	@echo "Deploying '$(SERVICE)' to Cloud Run ($(REGION)) from the current source…"
	gcloud run deploy $(SERVICE) \
		--source . \
		--region $(REGION) \
		--allow-unauthenticated

# Confirm a deploy actually shipped the new surfaces (Mission Control, Get
# Started, PWA). Every route must return 200.
deploy-verify:
	@echo "Verifying $(URL) …"
	@ok=1; for p in / /start/ /dashboard/ /dashboard/overview/ /manifest.webmanifest /sw.js /api/health; do \
		code=$$(curl -s -o /dev/null -w "%{http_code}" "$(URL)$$p"); \
		printf '  %-28s %s\n' "$$p" "$$code"; \
		[ "$$code" = "200" ] || ok=0; \
	done; \
	[ "$$ok" = "1" ] && echo "OK — all routes live" || { echo "FAIL — a route did not return 200 (redeploy?)"; exit 1; }
