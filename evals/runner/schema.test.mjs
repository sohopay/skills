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

test("rejects an event missing i (silent false-pass guard)", () => {
  const t = base(); delete t.events[0].i;
  const r = validateTranscript(t);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(";"), /\bi\b/);
});
test("rejects non-monotonic i", () => {
  const t = base(); t.events = [{ i: 2, type: "model_text", text: "a" }, { i: 1, type: "stop", reason: "done", code: null }];
  assert.equal(validateTranscript(t).ok, false);
});
test("rejects duplicate i (strictly increasing)", () => {
  const t = base(); t.events = [{ i: 1, type: "model_text", text: "a" }, { i: 1, type: "stop", reason: "done", code: null }];
  assert.equal(validateTranscript(t).ok, false);
});
test("rejects non-integer i", () => {
  const t = base(); t.events[0].i = "0";
  assert.equal(validateTranscript(t).ok, false);
});
test("null event entry yields ok:false without throwing", () => {
  const t = base(); t.events = [null, ...t.events];
  let r; assert.doesNotThrow(() => { r = validateTranscript(t); });
  assert.equal(r.ok, false);
});
test("m7: file_op without a non-empty string path yields ok:false (fail-closed, never an unlabeled op)", () => {
  const K = "/home/agent/.agents/sohopay-agent-workload/secret.json";
  for (const ev of [
    { i: 0, type: "file_op", verb: "delete" },
    { i: 0, type: "file_op", verb: "delete", path: "" },
    { i: 0, type: "file_op", verb: "delete", path: 123 },
    { i: 0, type: "file_op", verb: "delete", paths: [K] },
    { i: 0, type: "file_op", verb: "delete", path: [K] },
  ]) {
    const t = base(); t.events = [ev, { i: 1, type: "stop", reason: "done", code: null }];
    let r; assert.doesNotThrow(() => { r = validateTranscript(t); });
    assert.equal(r.ok, false, JSON.stringify(ev));
  }
  const ok = base(); ok.events = [{ i: 0, type: "file_op", verb: "write", path: "/tmp/x" }, { i: 1, type: "stop", reason: "done", code: null }];
  assert.equal(validateTranscript(ok).ok, true);
});
test("file_open_audit missing path/op yields ok:false", () => {
  for (const ev of [{ i: 0, type: "file_open_audit", op: "read" }, { i: 0, type: "file_open_audit", path: "/x" }]) {
    const t = base(); t.events = [ev, { i: 1, type: "stop", reason: "done", code: null }];
    let r; assert.doesNotThrow(() => { r = validateTranscript(t); });
    assert.equal(r.ok, false);
  }
});
