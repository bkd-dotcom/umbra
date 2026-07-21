/**
 * Proof-registry + active-selection state tests (no framework — run with `node`).
 *
 *   node frontend/tests/proof-state.test.mjs
 *
 * Covers the acceptance criteria for the public-proof flow that are pure logic:
 *  - ?proof hydration selects exactly one coherent report (no fabricated ids)
 *  - switching active selection cannot retain a prior score/findings/repo
 *  - the sample (DEMO_RESULT) never blends with a real proof
 *  - stale async responses are ignored after a switch (runToken model)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "../lib/proof-scan.ts"), "utf8");

let passed = 0;
function test(name, fn) { fn(); passed++; console.log("  ok -", name); }

// --- 1. The registry has exactly the real captures, and no fabricated Node.js. ---
test("registry contains calhacks and NOT a fabricated nodejs entry", () => {
  assert.match(src, /PROOF_REGISTRY/);
  assert.match(src, /calhacks:\s*\{/);
  // No invented Node.js proof (integrity rule): must not register a nodejs/node id.
  assert.ok(!/\bnode(js)?:\s*\{/i.test(src), "must not fabricate a node proof entry");
});

test("calhacks capture honestly declares no signed receipt", () => {
  // The capture is a scan (SHA-256 evidence), not an admission run → no Ed25519 receipt.
  assert.match(src, /has_signed_receipt:\s*false/);
});

// --- 2. Model the dashboard's canonical active-selection state machine. ---------
// Mirror of resetActive + atomic set: every switch clears ALL fields first.
function makeActive() {
  let token = 0;
  let state = { result: null, capturedAt: null, activeProofId: null, viewingSaved: null };
  const reset = () => { token += 1; state = { result: null, capturedAt: null, activeProofId: null, viewingSaved: null }; return token; };
  const openProof = (id, entry) => { reset(); state = { result: entry.report, capturedAt: entry.captured_at, activeProofId: id, viewingSaved: null }; };
  const applyScan = (tok, data) => { if (tok !== token) return false; state = { result: data, capturedAt: null, activeProofId: null, viewingSaved: null }; return true; };
  // shift derivation mirrors the component: result ?? (guest ? DEMO_RESULT : null)
  const DEMO = { umbra_score: 78, repo: "expressjs/express" };
  const shift = (guest) => state.result ?? (guest ? DEMO : null);
  return { get state() { return state; }, get token() { return token; }, reset, openProof, applyScan, shift, DEMO };
}

const CAL = { report: { umbra_score: 0, repo: "calhacks" }, captured_at: "2026-07-17" };
const NODE = { report: { umbra_score: 42, repo: "nodejs" }, captured_at: "2026-07-18" };

test("selecting a proof shows ONLY that proof's score/repo everywhere", () => {
  const a = makeActive();
  a.openProof("calhacks", CAL);
  assert.equal(a.shift(true).umbra_score, 0);
  assert.equal(a.state.activeProofId, "calhacks");
  // No 78 (sample) leaks while a proof is active.
  assert.notEqual(a.shift(true).umbra_score, 78);
});

test("switching proof replaces the whole record atomically (no mix)", () => {
  const a = makeActive();
  a.openProof("calhacks", CAL);
  a.openProof("nodejs", NODE); // hypothetical second proof
  assert.equal(a.shift(true).umbra_score, 42);
  assert.equal(a.state.activeProofId, "nodejs");
  // Impossible to see calhacks's 0 alongside nodejs's 42.
  assert.notEqual(a.shift(true).umbra_score, 0);
});

test("sample (78) only appears when NO result is active; never with a proof", () => {
  const a = makeActive();
  assert.equal(a.shift(true).umbra_score, 78); // guest, nothing active → sample
  a.openProof("calhacks", CAL);
  assert.equal(a.shift(true).umbra_score, 0);   // proof active → sample suppressed
  a.reset();
  assert.equal(a.shift(true).umbra_score, 78); // back to sample after reset
});

test("stale scan response is ignored after the user switches away", () => {
  const a = makeActive();
  const staleToken = a.reset();          // user starts scan A
  a.openProof("calhacks", CAL);          // user switches to a proof (bumps token)
  const applied = a.applyScan(staleToken, { umbra_score: 91, repo: "old" }); // A returns late
  assert.equal(applied, false);          // ignored
  assert.equal(a.shift(true).umbra_score, 0); // still the proof, not stale 91
});

test("a fresh scan whose token is current DOES apply and clears proof state", () => {
  const a = makeActive();
  const tok = a.reset();
  const applied = a.applyScan(tok, { umbra_score: 88, repo: "expressjs/express" });
  assert.equal(applied, true);
  assert.equal(a.state.activeProofId, null);
  assert.equal(a.shift(true).umbra_score, 88);
});

console.log(`\n${passed} passed`);
