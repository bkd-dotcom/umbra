# Umbra — judge & dev shortcuts.
# The `judge` target proves the whole loop with ONE command, no sign-in, no network:
# it runs the Agent Admission Test on a hermetic fixture, prints the earned authority,
# and verifies the Ed25519-signed receipt against Umbra's own pinned public key.

.PHONY: judge judge-adversarial test serve help

help:
	@echo "make judge             # run admission on the permitted fixture + verify the signed receipt"
	@echo "make judge-adversarial # run the prompt-injection fixture (redacted, still permitted)"
	@echo "make test              # run the backend test suite (277 tests)"
	@echo "make serve             # run the API locally on :8000"

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
