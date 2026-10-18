import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPending, PENDING_FILE, validatePending } from "./pending.mjs";
import { main } from "./run.mjs";
import { HardError } from "./schema.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "__fixtures__");
const IDS = new Map([["runnable", new Set(["leak-case"])]]);

/** A copy of the runnable fixture suite; `golden: false` deletes its golden, `pending` writes goldens-pending.json. */
function fixture(t, { golden = true, pending } = {}) {
  const root = mkdtempSync(join(tmpdir(), "run-pending-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(join(FIX, "runnable"), join(root, "runnable"), { recursive: true });
  if (!golden) rmSync(join(root, "runnable", "transcripts", "leak-case.json"));
  if (pending !== undefined) writeFileSync(join(root, PENDING_FILE), typeof pending === "string" ? pending : JSON.stringify(pending));
  return root;
}
const replay = (root) => main(["--adapter", "replay", "--suite", "all"], { evalsRoot: root, skillsRoot: root, suites: { runnable: "runnable" }, silent: true });

test("validatePending: a well-formed list has no errors", () => {
  assert.deepEqual(validatePending({ pending: { runnable: ["leak-case"] } }, IDS), []);
  assert.deepEqual(validatePending({ comment: "x", pending: { runnable: [] } }, IDS), []);
});

test("validatePending: unknown suite, unknown or non-string id, duplicate, wrong shapes are all errors", () => {
  assert.match(validatePending({ pending: { nope: [] } }, IDS).join(), /unknown suite "nope"/);
  assert.match(validatePending({ pending: { runnable: ["other"] } }, IDS).join(), /unknown case id "other"/);
  assert.match(validatePending({ pending: { runnable: [7] } }, IDS).join(), /unknown case id 7/);
  assert.match(validatePending({ pending: { runnable: ["leak-case", "leak-case"] } }, IDS).join(), /duplicate case id leak-case/);
  assert.match(validatePending({ pending: { runnable: "leak-case" } }, IDS).join(), /must be an array/);
  assert.match(validatePending({ pending: ["leak-case"] }, IDS).join(), /"pending" must be an object/);
  assert.match(validatePending([], IDS).join(), /must be a JSON object/);
  assert.match(validatePending(null, IDS).join(), /must be a JSON object/);
});

test("loadPending: an absent file is an empty map; unreadable JSON throws (fail closed, never 'nothing pending')", (t) => {
  assert.equal(loadPending(fixture(t), IDS).size, 0);
  assert.throws(() => loadPending(fixture(t, { pending: "{not json" }), IDS), /not valid JSON/);
  assert.throws(() => loadPending(fixture(t, { pending: { pending: { runnable: ["x"] } } }), IDS), /unknown case id "x"/);
});

test("replay: a LISTED case with no golden is reported pending (exit 0); its adversarials are still graded", async (t) => {
  const { report, code } = await replay(fixture(t, { golden: false, pending: { pending: { runnable: ["leak-case"] } } }));
  assert.equal(code, 0);
  assert.equal(report.pending, 1);
  assert.equal(report.failed, 0);
  const g = report.cases.find((c) => c.kind === "golden");
  assert.equal(g.pending, true);
  assert.equal(report.cases.filter((c) => c.kind === "adversarial").length, 1, "adversarials still run");
});

test("replay: an UNLISTED case with no golden still fails (exit 1, HardError row)", async (t) => {
  for (const pending of [undefined, { pending: { runnable: [] } }]) {
    const { report, code } = await replay(fixture(t, { golden: false, pending }));
    assert.equal(code, 1);
    assert.equal(report.pending, 0);
    assert.match(report.cases.find((c) => c.kind === "golden").hardError, /cannot load transcript/);
  }
});

test("replay: a listed case whose golden EXISTS is graded like any other (a stale entry never skips a golden)", async (t) => {
  const root = fixture(t, { pending: { pending: { runnable: ["leak-case"] } } });
  const { report, code } = await replay(root);
  assert.equal(code, 0);
  assert.equal(report.pending, 0);
  const g = report.cases.find((c) => c.kind === "golden");
  assert.equal(g.pending, undefined);
  assert.equal(g.pass, true);
  // ...and a failing golden still fails although it is listed.
  const f = join(root, "runnable", "transcripts", "leak-case.json");
  writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), meta: { adapter: "synthetic" } }));
  assert.equal((await replay(root)).code, 1);
});

test("replay: a malformed goldens-pending.json is a HardError, not an empty list", async (t) => {
  await assert.rejects(replay(fixture(t, { golden: false, pending: "[]" })), (e) => e instanceof HardError && /goldens-pending\.json/.test(e.message));
});

test("evals-live.yml regen job drops each recorded id from the pending list in the golden's own commit", () => {
  const wf = readFileSync(join(here, "..", "..", ".github", "workflows", "evals-live.yml"), "utf8");
  assert.match(wf, /pending=evals\/goldens-pending\.json/);
  assert.match(wf, /jq --arg s "\$suite" --arg id "\$id" 'if \.pending\[\$s\] then \.pending\[\$s\] \|= map\(select\(\. != \$id\)\) else \. end'/);
  assert.match(wf, /paths\+=\("\$pending"\)\n\s+fi\n\s+git add -- "\$\{paths\[@\]\}"/);
});

test("the committed goldens-pending.json lists only real case ids with no golden yet", () => {
  const evals = join(here, "..");
  const doc = JSON.parse(readFileSync(join(evals, PENDING_FILE), "utf8"));
  for (const [suite, ids] of Object.entries(doc.pending)) {
    const known = new Set(JSON.parse(readFileSync(join(evals, suite, "assertions.json"), "utf8")).cases.map((c) => c.id));
    for (const id of ids) {
      assert.ok(known.has(id), `${suite}/${id} is not a case`);
      assert.throws(() => readFileSync(join(evals, suite, "transcripts", `${id}.json`)), /ENOENT/, `${suite}/${id} has a golden: remove it from ${PENDING_FILE}`);
    }
  }
});
