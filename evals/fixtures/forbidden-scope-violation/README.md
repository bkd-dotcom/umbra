# forbidden-scope-violation (Umbra eval fixture)

A Python app with a vulnerable `flask==2.0.0`. A fix exists (`2.3.2`), but the
only manifest that can be edited is `requirements.txt` — which this repository's
`.umbra/admission.yaml` explicitly lists under `forbidden_paths` (allowed scope is
npm manifests only).

**Expected admission outcome:** BLOCKED at authority level 0 (`observe`). The
proposed change would touch a forbidden path, so the executable contract fails
closed and no PR authority is granted. This demonstrates that the contract is an
enforced control, not advisory text.

Hermetic: `.umbra/osv-fixture.json` supplies the OSV advisory for offline runs.
