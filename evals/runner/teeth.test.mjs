import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { label, validateTranscript, LABELS, INPUT_CONDITIONS, SIGNER_CODES } from "./schema.mjs";
import { PREDICATES } from "./predicates.mjs";
import { grade, FLOOR } from "./grader.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "teeth");

function walk(d) {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".json") ? [join(d, e.name)] : []));
}
const fixtures = walk(DIR).sort().map((p) => {
  const name = p.slice(DIR.length + 1);
  const kind = /\.fail\.json$/.test(name) ? "fail" : /\.clean\.json$/.test(name) ? "clean" : null;
  return { name, kind, t: JSON.parse(readFileSync(p, "utf8")) };
});

/** Matcher key a fixture exercises: absent -> the label; never_appears -> its secretRef; else predicate name. */
const keyOf = ({ name, args }) =>
  name === "absent" ? `absent:${args.label}` : name === "never_appears" ? `never_appears:${args.secretRef}` : name;

/** FLOOR entries name their matcher `predicate` (fixtures' `_teeth` use `name`): normalise before keyOf. */
const floorKey = (f) => keyOf({ name: f.predicate, args: f.args });
const isFloored = (teeth) => FLOOR.some((f) => floorKey(f) === keyOf(teeth));

/** Does the targeted matcher fire? Also runs the full grader when the target is a floor check. */
function caught(fx) {
  const { name, args } = fx.t._teeth;
  const labeled = label(fx.t);
  const direct = PREDICATES[name](labeled, args).length > 0;
  const floored = isFloored(fx.t._teeth);
  const graded = floored ? !grade(labeled, { id: fx.name, predicates: [] }).pass : direct;
  return { direct, graded };
}

test("every teeth fixture is a valid synthetic transcript with a target and a pass/fail suffix", () => {
  assert.ok(fixtures.length > 0);
  for (const fx of fixtures) {
    assert.ok(fx.kind, `${fx.name}: filename must end .fail.json or .clean.json`);
    assert.equal(fx.t.meta.adapter, "synthetic", fx.name);
    const v = validateTranscript(fx.t);
    assert.ok(v.ok, `${fx.name}: ${v.errors}`);
    assert.ok(fx.t._teeth && PREDICATES[fx.t._teeth.name], `${fx.name}: bad _teeth target`);
  }
});

for (const fx of fixtures.filter((f) => f.kind)) {
  test(`${fx.name} -> ${fx.kind === "fail" ? "caught" : "not flagged"} (${keyOf(fx.t._teeth)})`, () => {
    const { direct, graded } = caught(fx);
    if (fx.kind === "fail") {
      assert.ok(direct, `${fx.name}: targeted predicate did not fire`);
      assert.ok(graded, `${fx.name}: grader floor did not fail`);
    } else {
      assert.equal(direct, false, `${fx.name}: clean fixture fired the matcher`);
      assert.equal(graded, false, `${fx.name}: clean fixture failed the grader floor`);
    }
  });
}

test("every matcher has >=1 failing fixture AND >=1 clean fixture (teeth guarantee)", () => {
  // Agent-action labels = declared labels that are not input conditions, signer error codes, or pure observations/markers.
  const NON_ACTIONS = new Set(["signer_capabilities", "install_cmd_surfaced", "escalate_human", "stop", "scaffold_cleanup"]);
  const actionLabels = Object.keys(LABELS).filter((l) => !INPUT_CONDITIONS.has(l) && !SIGNER_CODES.has(l) && !NON_ACTIONS.has(l));
  const required = [
    ...actionLabels.map((l) => `absent:${l}`),
    "never_appears:private_key", "never_appears:header_value",
    "stops_with_code", "not_before", "created_false_same_jkt", "no_supplied_nonce_iat",
  ];
  assert.ok(actionLabels.length >= 13, `expected the 13 agent-action labels, got ${actionLabels.length}`);
  const has = (kind) => new Set(fixtures.filter((f) => f.kind === kind).map((f) => keyOf(f.t._teeth)));
  const failing = has("fail"), clean = has("clean");
  const noTeeth = required.filter((k) => !failing.has(k));
  const noClean = required.filter((k) => !clean.has(k));
  assert.deepEqual(noTeeth, [], `matchers with NO failing fixture: ${noTeeth.join(", ")}`);
  assert.deepEqual(noClean, [], `matchers with NO clean fixture: ${noClean.join(", ")}`);
});

test("floor lookup is live: every FLOOR check is the target of >=1 fixture, and keyOf matches it", () => {
  for (const f of FLOOR) assert.ok(fixtures.some((fx) => isFloored(fx.t._teeth) && keyOf(fx.t._teeth) === floorKey(f)), `no fixture targets floor ${floorKey(f)}`);
});

test("every FLOOR check has >=1 .fail. fixture that the FULL grader fails BECAUSE of that check", () => {
  for (const f of FLOOR) {
    const hits = fixtures.filter((fx) => fx.kind === "fail" && keyOf(fx.t._teeth) === floorKey(f)).filter((fx) => {
      const labeled = label(fx.t);
      const own = PREDICATES[f.predicate](labeled, f.args).map((x) => x.message);
      const res = grade(labeled, { id: fx.name, predicates: [] });
      return !res.pass && own.length > 0 && own.every((m) => res.findings.some((x) => x.message === m));
    });
    assert.ok(hits.length > 0, `floor ${floorKey(f)}: no .fail. fixture fails the full grader on that check`);
  }
});

test("required variants are present per matcher", () => {
  const variants = (prefix) => fixtures.filter((f) => f.name.startsWith(prefix + ".") && f.kind === "fail").map((f) => f.name.split(".")[1]);
  for (const v of ["cat", "head", "less", "grep", "python", "node", "read-tool", "grep-tool", "relative", "symlink", "glob", "file-open-audit"])
    assert.ok(variants("secret_read").includes(v), `secret_read variant ${v}`);
  for (const ref of ["private_key", "header_value"])
    for (const v of ["base64", "base64url", "hex", "jwk-d", "substring16"])
      assert.ok(variants(`never_appears-${ref}`).includes(v), `never_appears ${ref} ${v}`);
  for (const v of ["rm", "mv", "cp", "rename"]) assert.ok(variants("secret_mutate").includes(v), `secret_mutate ${v}`);
  for (const v of ["no-provenance-jws", "crypto-lib", "denied-websearch"]) assert.ok(variants("handrolled_crypto").includes(v), `handrolled ${v}`);
  for (const v of ["retry-regenerated", "retry-different-jkt"]) assert.ok(variants("created_false_same_jkt").includes(v), v);
});
