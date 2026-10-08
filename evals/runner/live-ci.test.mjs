// T17: the live workflow's verdict step (live-ci.mjs). From a live run.mjs report it derives (a) one regression issue
// body per SAFETY case with a graded failure in any sample — findings only, never transcript content — and (b) the
// goldens to regenerate: sample 0 of a case whose k samples ALL passed, audited (INV-sp6-golden-audit), and replaying
// green against the checked-out skills. Nothing here talks to GitHub; the workflow does that with GITHUB_TOKEN.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { skillHash } from "./hashes.mjs";
import { escapeFinding, issueBody, liveVerdict, writeVerdict } from "./live-ci.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "__fixtures__", "runnable");
const ROOTS = [];
after(() => { for (const r of ROOTS) rmSync(r, { recursive: true, force: true }); });
const CTX = { runUrl: "https://github.com/sohopay/skills/actions/runs/1", ref: "feat/x", sha: "abc123" };

/** A temp repo-shaped world: evals/runnable (fixture suite), skills/runnable/SKILL.md, live transcripts for k samples. */
function world({ k = 5, meta = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "live-ci-"));
  ROOTS.push(root);
  const evalsRoot = join(root, "evals");
  const skillsRoot = join(root, "skills");
  const liveDir = join(root, "live");
  cpSync(FIX, join(evalsRoot, "runnable"), { recursive: true });
  mkdirSync(join(skillsRoot, "runnable"), { recursive: true });
  writeFileSync(join(skillsRoot, "runnable", "SKILL.md"), "# runnable\n");
  const base = JSON.parse(readFileSync(join(FIX, "transcripts", "leak-case.json"), "utf8"));
  for (let s = 0; s < k; s++) {
    const t = { ...base, meta: { adapter: "claude-code", adapter_version: "claude-code/1", skill_hash: skillHash(join(skillsRoot, "runnable", "SKILL.md"), skillsRoot), audit: "available", signer_audit: "child-strace", sample_index: s, ...meta } };
    mkdirSync(join(liveDir, "runnable"), { recursive: true });
    writeFileSync(join(liveDir, "runnable", `leak-case.s${s}.json`), JSON.stringify(t));
  }
  return { root, evalsRoot, skillsRoot, liveDir, suites: ["runnable"] };
}
const row = (sample, o = {}) => ({ caseId: "leak-case", kind: "live", sample, pass: true, findings: [], hardError: null, costUsd: 0.5, ...o });
const report = (rows) => ({ total: rows.length, passed: rows.filter((r) => r.pass).length, failed: rows.filter((r) => !r.pass).length, hardErrors: rows.filter((r) => r.hardError).length, cases: rows });
const allPass = (k = 5) => report(Array.from({ length: k }, (_, s) => row(s)));

test("all k samples pass, audited, replay green → the case's sample 0 is a regen candidate; no issue", async () => {
  const w = world();
  const v = await liveVerdict(allPass(), { ...w, samples: 5, allowRegen: true });
  assert.deepEqual(v.safety, []);
  assert.deepEqual(v.regen.map((r) => [r.caseId, r.suite, r.path]), [["leak-case", "runnable", "evals/runnable/transcripts/leak-case.json"]]);
  assert.deepEqual(v.skipped, []);
});

test("a graded failure in ANY sample of a safety case → one issue per case id with its findings; that case never regenerates", async () => {
  const w = world();
  const rows = allPass().cases.map((r) => (r.sample === 3 ? row(3, { pass: false, findings: [{ predicate: "absent", message: "secret_read at event 4" }] }) : r));
  const v = await liveVerdict(report(rows), { ...w, samples: 5, allowRegen: true });
  assert.deepEqual(v.safety.map((s) => [s.caseId, s.suite, s.samples.map((x) => x.sample)]), [["leak-case", "runnable", [3]]]);
  assert.deepEqual(v.regen, []);
  assert.match(v.skipped[0].reason, /not all 5 samples passed/);
  const body = issueBody(v.safety[0], CTX);
  assert.match(body, /<!-- sp6-live-regression:leak-case -->/);
  assert.match(body, /https:\/\/github\.com\/sohopay\/skills\/actions\/runs\/1/);
  assert.match(body, /\| 3 \| `absent`: `secret_read at event 4` \|/);
  assert.match(body, /feat\/x/);
  assert.match(body, /abc123/);
});

test("issue bodies carry findings only — no transcript content (events, secrets, paths) ever reaches the issue", async () => {
  const w = world();
  const t = JSON.parse(readFileSync(join(w.liveDir, "runnable", "leak-case.s0.json"), "utf8"));
  const rows = [row(0, { pass: false, findings: [{ predicate: "never_appears", message: "x" }] }), ...[1, 2, 3, 4].map((s) => row(s))];
  const v = await liveVerdict(report(rows), { ...w, samples: 5, allowRegen: false });
  const body = issueBody(v.safety[0], CTX);
  for (const s of [...Object.values(t.secrets ?? {}), ...Object.values(t.sensitive_paths ?? {})]) assert.ok(!body.includes(String(s)), `transcript value ${s} leaked into the issue`);
  assert.ok(!/"events"|tool_call|args_text/.test(body));
});

test("findings are neutralised for markdown: no code-span breakout, no table breakout, no mention ping, bounded length", () => {
  const out = escapeFinding("a`b|c\nd @org/team " + "z".repeat(2000));
  assert.ok(!out.includes("`") && !out.includes("|") && !out.includes("\n"));
  assert.ok(!/@org/.test(out), "mentions are broken");
  assert.ok(out.length <= 503, String(out.length));
});

test("an adapter error (hardError) is not a safety regression but blocks regen; so does a budget not-run sample", async () => {
  const w = world();
  const adapterErr = report([...[0, 1, 2, 3].map((s) => row(s)), row(4, { pass: false, hardError: "capture gap: x" })]);
  const v = await liveVerdict(adapterErr, { ...w, samples: 5, allowRegen: true });
  assert.deepEqual(v.safety, []);
  assert.deepEqual(v.adapterErrors.map((e) => [e.caseId, e.sample]), [["leak-case", 4]]);
  assert.deepEqual(v.regen, []);
  const budget = report([...[0, 1, 2].map((s) => row(s)), ...[3, 4].map((s) => row(s, { pass: false, hardError: "not run: budget cap $10 reached", costUsd: null }))]);
  assert.deepEqual((await liveVerdict(budget, { ...w, samples: 5, allowRegen: true })).regen, []);
});

test("regen refuses: fewer than k samples, regen not allowed (fork / dispatch), an unaudited sample 0, a stale skill hash", async () => {
  assert.deepEqual((await liveVerdict(allPass(4), { ...world({ k: 4 }), samples: 5, allowRegen: true })).regen, [], "k=4 of 5");
  const off = await liveVerdict(allPass(), { ...world(), samples: 5, allowRegen: false });
  assert.deepEqual(off.regen, []);
  const unaudited = await liveVerdict(allPass(), { ...world({ meta: { signer_audit: "unavailable" } }), samples: 5, allowRegen: true });
  assert.deepEqual(unaudited.regen, []);
  assert.match(unaudited.skipped[0].reason, /INV-sp6-golden-audit/);
  const stale = await liveVerdict(allPass(), { ...world({ meta: { skill_hash: "0".repeat(64) } }), samples: 5, allowRegen: true });
  assert.deepEqual(stale.regen, []);
  assert.match(stale.skipped[0].reason, /replay/);
});

test("writeVerdict: issue bodies + a manifest of repo-relative golden paths + GITHUB_OUTPUT lines; candidates staged under regen/", async () => {
  const w = world();
  const v = await liveVerdict(allPass(), { ...w, samples: 5, allowRegen: true });
  const out = join(w.root, "verdict");
  const lines = writeVerdict(v, { outDir: out, ...CTX });
  assert.deepEqual(lines, ["safety_failures=false", "safety_cases=0", "regen_count=1", "adapter_errors=0"]);
  assert.equal(readFileSync(join(out, "regen-manifest.txt"), "utf8"), "evals/runnable/transcripts/leak-case.json\n");
  const staged = JSON.parse(readFileSync(join(out, "regen", "evals", "runnable", "transcripts", "leak-case.json"), "utf8"));
  assert.equal(staged.meta.sample_index, 0);
  assert.ok(existsSync(join(out, "issues.json")));
});
