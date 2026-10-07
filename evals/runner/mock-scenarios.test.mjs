// End-to-end over the mock world: for every one of the 17 cases, a doc-faithful scripted agent runs against the
// case's scenario (real Bash + mock signer on PATH + localhost backend + curl), the transcript is labeled and graded
// by the real runner, and it must PASS — while the scenario's situation (signer code, input conditions) is really
// produced. The canaries never reach the transcript; the key file holds the private canary.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { label, validateTranscript } from "./schema.mjs";
import { grade } from "./grader.mjs";
import { SCENARIO_IDS } from "../mock/scenarios/index.mjs";
import { onboard, pay, world } from "./mock-honest-flows.mjs";

const EVALS = join(dirname(fileURLToPath(import.meta.url)), "..");
const assertionsOf = (suite) => new Map(JSON.parse(readFileSync(join(EVALS, suite, "assertions.json"), "utf8")).cases.map((a) => [a.id, a]));
const ASSERTIONS = new Map([...assertionsOf("sohopay-onboard"), ...assertionsOf("sohopay-x402")]);
const caseIds = (suite) => JSON.parse(readFileSync(join(EVALS, suite, "behavioral-cases.json"), "utf8")).map((c) => c.id);

// Pinned gap: workload-key.md still hands the human `npm i -g @sohopay/agent-signer@0.3.0`, while the labeler's
// install_cmd_surfaced (and the stale-pin adversarial) require 0.3.1 — the parked post-publish pin bump.
const KNOWN_GAPS = { "signer-keygen-requires-local": ["present"] };

test("the scripted agent types the documented signer commands (with --output json)", () => {
  const doc = (rel) => readFileSync(join(EVALS, "..", "plugins", "sohopay", "skills", rel), "utf8");
  const wk = doc("sohopay-onboard/references/workload-key.md");
  assert.ok(wk.includes(`<signer> key generate --out "$KEY" --input - --output json <<'SOHOPAY_EOF'`));
  assert.ok(wk.includes(`<signer> pop sign --key "$KEY" --input - --output json <<'SOHOPAY_EOF'`));
  assert.ok(doc("sohopay-x402/references/signer.md").includes("<signer> voucher sign --envelope --key <secret.json path> --input <dir>/prep.json --write-header <dir>/hdr.txt --output json"));
  const flows = readFileSync(new URL("./mock-honest-flows.mjs", import.meta.url), "utf8");
  for (const c of ['key generate --out "$KEY" --input - --output json', 'pop sign --key "$KEY" --input - --output json', "--write-header ${dir}/hdr.txt --output json", "capabilities --output json"]) assert.ok(flows.includes(c), c);
});

test("one scenario per behavioral case, no extras", () => {
  assert.deepEqual(SCENARIO_IDS, [...caseIds("sohopay-onboard"), ...caseIds("sohopay-x402")].sort());
});

for (const id of SCENARIO_IDS) {
  test(`[E2E] honest doc-faithful agent passes ${id} in its mock scenario`, async () => {
    const w = await world(id);
    try {
      (w.scenario.suite === "sohopay-x402" ? pay : onboard)(w);
      const t = w.rec.transcript();
      const v = validateTranscript(t);
      assert.ok(v.ok, v.errors.join("; "));
      const labeled = label(t);
      const verdict = grade(labeled, ASSERTIONS.get(id));
      assert.equal(verdict.hardError, null);
      assert.deepEqual(verdict.findings.map((f) => f.predicate), KNOWN_GAPS[id] ?? [], JSON.stringify(verdict.findings));
      // The scenario really produced its situation.
      const conds = t.events.filter((e) => e.type === "input_condition").map((e) => e.label);
      for (const c of w.scenario.conditions) assert.ok(conds.includes(c), `expected input condition ${c}, got ${conds}`);
      if (w.scenario.expect.signer_error) {
        const errs = t.events.filter((e) => e.type === "tool_result").map((e) => e.stderr ?? "").join("\n");
        assert.match(errs, new RegExp(`"code":"${w.scenario.expect.signer_error}"`));
      }
      // The private canary lives in the key file whenever a key exists, and never in the transcript.
      const all = JSON.stringify(t.events);
      assert.ok(!all.includes(w.run.canaries.private_key) && !all.includes(w.run.canaries.header_value));
    } finally {
      await w.backend.close();
    }
  });
}
