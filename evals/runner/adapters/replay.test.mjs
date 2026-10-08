import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./replay.mjs";
import { HardError } from "../schema.mjs";

const mk = (meta, extra = {}) => ({
  case_id: "c1", suite: "s1", meta,
  secrets: { private_key: "FAKE-SP6-CANARY-PRIV-TEST", header_value: "FAKE-SP6-CANARY-HDR-TEST" },
  sensitive_paths: { key_path: "/x/secret.json" },
  events: [{ i: 0, type: "stop", code: 0 }],
  ...extra,
});
const golden = (h) => mk({ adapter: "claude-code", adapter_version: "claude-code/1", skill_hash: h, audit: "unavailable" });
const synth = () => mk({ adapter: "synthetic", adapter_version: "synthetic/1", grader_hash: "old" });

const ROOTS = [];
after(() => { for (const r of ROOTS) rmSync(r, { recursive: true, force: true }); });

function setup(obj, kind) {
  const root = mkdtempSync(join(tmpdir(), "replay-"));
  ROOTS.push(root);
  const dir = join(root, "s1", "transcripts", ...(kind === "adversarial" ? ["adversarial"] : []));
  mkdirSync(dir, { recursive: true });
  const name = kind === "adversarial" ? "c1.v1" : "c1";
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(obj));
  return { root, ref: { suite: "s1", caseId: "c1", kind, name } };
}

test("synthetic loads without skill_hash gating or grader_hash gating", () => {
  const obj = synth();
  const { root, ref } = setup(obj, "adversarial");
  assert.deepEqual(run(ref, { rootDir: root, skillHashFor: () => "mismatch" }), obj);
});

test("golden with stale skill_hash throws HardError", () => {
  const { root, ref } = setup(golden("aaa"), "golden");
  assert.throws(() => run(ref, { rootDir: root, skillHashFor: () => "bbb" }), HardError);
});

test("golden with matching skill_hash loads", () => {
  const obj = golden("aaa");
  const { root, ref } = setup(obj, "golden");
  assert.deepEqual(run(ref, { rootDir: root, skillHashFor: () => "aaa" }), obj);
});

test("unknown adapter_version throws HardError", () => {
  const obj = synth(); obj.meta.adapter_version = "synthetic/99";
  const { root, ref } = setup(obj, "adversarial");
  assert.throws(() => run(ref, { rootDir: root, skillHashFor: () => "x" }), HardError);
});

test("schema-invalid transcript throws HardError", () => {
  const obj = synth(); obj.events = [];
  const { root, ref } = setup(obj, "adversarial");
  assert.throws(() => run(ref, { rootDir: root, skillHashFor: () => "x" }), HardError);
});

test("missing file and invalid JSON throw HardError", () => {
  const { root, ref } = setup(synth(), "adversarial");
  assert.throws(() => run({ ...ref, name: "nope" }, { rootDir: root, skillHashFor: () => "x" }), HardError);
  writeFileSync(join(root, "s1", "transcripts", "adversarial", "bad.json"), "{");
  assert.throws(() => run({ ...ref, name: "bad" }, { rootDir: root, skillHashFor: () => "x" }), HardError);
});

// Final review I2: the kind of a transcript is bound to the adapter that produced it. A golden is a live claude-code
// capture (skill_hash-gated, golden-audit-checked at validate); an adversarial is a hand-authored synthetic near-miss.
// A synthetic file at the golden path would replay green, never go stale and bypass INV-sp6-golden-audit.
test("I2: a synthetic transcript at the golden path is refused (HardError)", () => {
  const { root, ref } = setup(synth(), "golden");
  assert.throws(() => run(ref, { rootDir: root, skillHashFor: () => "x" }), (e) => e instanceof HardError && /golden .*claude-code/.test(e.message));
});

test("I2: a claude-code transcript under adversarial/ is refused (HardError)", () => {
  const { root, ref } = setup(golden("aaa"), "adversarial");
  assert.throws(() => run(ref, { rootDir: root, skillHashFor: () => "aaa" }), (e) => e instanceof HardError && /adversarial .*synthetic/.test(e.message));
});

test("I2: any other adapter is refused for both kinds", () => {
  for (const kind of ["golden", "adversarial"]) {
    const obj = synth(); obj.meta.adapter = "hand-written";
    const { root, ref } = setup(obj, kind);
    assert.throws(() => run(ref, { rootDir: root, skillHashFor: () => "x" }), HardError, kind);
  }
});
