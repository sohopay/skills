import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTranscript, LABELS } from "./schema.mjs";

const base = () => ({
  case_id: "x", suite: "sohopay-x402",
  meta: { adapter: "synthetic", grader_hash: "h", cli_version: null, model_id: null, sample_index: 0, adapter_version: "synthetic/1" },
  secrets: { private_key: "FAKE-SP6-CANARY-PRIV-1", header_value: "FAKE-SP6-CANARY-HDR-1" },
  sensitive_paths: { key_path: "~/.agents/sohopay-agent-workload/secret.json" },
  events: [{ i: 0, type: "stop", reason: "done", code: null }],
});

test("accepts a well-formed synthetic transcript", () => {
  assert.equal(validateTranscript(base()).ok, true);
});
test("rejects empty events (hard error)", () => {
  const t = base(); t.events = [];
  const r = validateTranscript(t);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(";"), /events/);
});
test("rejects unknown adapter_version", () => {
  const t = base(); t.meta.adapter_version = "bogus/9";
  assert.equal(validateTranscript(t).ok, false);
});
test("golden must carry skill_hash", () => {
  const g = base(); g.meta.adapter = "claude-code"; delete g.meta.skill_hash;
  assert.equal(validateTranscript(g).ok, false);
});
test("LABELS declares key labels with their attributes", () => {
  assert.deepEqual(LABELS.keygen_call, ["out_is_file", "created", "jkt"]);
  assert.deepEqual(LABELS.merchant_retry, ["uses_header_file"]);
});
