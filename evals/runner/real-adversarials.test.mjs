// Teeth for the 17 real cases: every case carries >=1 synthetic NEAR-MISS adversarial that the real grader
// (universal FLOOR + the case's own assertion) must fail for the INTENDED reason, never for a schema error,
// a missing required label (HardError) or an unrelated predicate.
//
// Each adversarial file declares its intent as a top-level `intent` ("<predicate>[:<detail>]", matched against a
// finding's `predicate` and, when a detail is given, a substring of its `message`). `also` lists findings that
// the violation unavoidably co-fires (e.g. secret_mutate always arrives with secret_read); any finding that is
// neither the intent nor in `also` fails the test, so an adversarial cannot pass for an incidental reason.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { label, validateTranscript } from "./schema.mjs";
import { grade } from "./grader.mjs";
import { loadSuite } from "./cases.mjs";

const EVALS = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SUITES = ["sohopay-onboard", "sohopay-x402"];
const WAIVERS = JSON.parse(readFileSync(join(EVALS, "floor-waivers.json"), "utf8")).waivers;

/** Does a finding satisfy an intent string? */
function matches(finding, intent) {
  const at = intent.indexOf(":");
  const [pred, detail] = at < 0 ? [intent, null] : [intent.slice(0, at), intent.slice(at + 1)];
  return finding.predicate === pred && (detail === null || finding.message.includes(detail));
}

for (const suite of SUITES) {
  const { assertions } = loadSuite(join(EVALS, suite));
  const dir = join(EVALS, suite, "transcripts", "adversarial");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];

  for (const id of assertions.keys()) {
    test(`${suite}/${id}: has at least one adversarial`, () => {
      assert.ok(files.some((f) => f.startsWith(`${id}.`)), `no adversarial for ${id}`);
    });
  }

  for (const f of files) {
    const t = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const stem = f.slice(0, -".json".length);
    test(`${suite}/${stem}: valid near-miss that fails for its intended check`, () => {
      const assertion = assertions.get(t.case_id);
      assert.ok(assertion, `${f}: case_id ${t.case_id} is not a case of ${suite}`);
      assert.ok(stem.startsWith(`${t.case_id}.`), `${f}: file stem must start with "<case_id>."`);
      assert.equal(t.suite, suite);
      assert.equal(t.meta.adapter, "synthetic");
      const v = validateTranscript(t);
      assert.ok(v.ok, `${f}: ${v.errors}`);
      assert.match(t.secrets.private_key, /^FAKE-SP6-CANARY-/);
      assert.match(t.secrets.header_value, /^FAKE-SP6-CANARY-/);
      assert.equal(typeof t.intent, "string", `${f}: missing top-level intent`);

      const g = grade(label(t), assertion, WAIVERS);
      assert.equal(g.hardError, null, `${f}: HardError ${g.hardError}`);
      assert.equal(g.pass, false, `${f}: adversarial passed grading`);
      assert.ok(g.findings.some((x) => matches(x, t.intent)), `${f}: no finding matches intent ${t.intent}; got ${JSON.stringify(g.findings)}`);
      const allowed = [t.intent, ...(t.also ?? [])];
      const stray = g.findings.filter((x) => !allowed.some((a) => matches(x, a)));
      assert.deepEqual(stray, [], `${f}: findings outside intent/also (not a near-miss)`);
    });
  }
}
