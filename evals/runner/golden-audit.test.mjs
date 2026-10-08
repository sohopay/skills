// T15 fix round 2, N8: a golden's audit status is visible in replay and enforced at validate time. Goldens are recorded
// on Linux CI under --require-audit, so every committed golden must say meta.audit = "available"
// (INV-sp6-golden-audit, scripts/validate-skills.mjs → goldenAuditError).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { goldenAuditError } from "./golden.mjs";
import { skillHash } from "./hashes.mjs";
import { main } from "./run.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const ROOTS = [];
after(() => { for (const r of ROOTS) rmSync(r, { recursive: true, force: true }); });

test("INV-sp6-golden-audit: a claude-code golden must record audit 'available'", () => {
  const g = (audit) => ({ meta: { adapter: "claude-code", audit } });
  assert.equal(goldenAuditError(g("available")), null);
  assert.match(goldenAuditError(g("unavailable")), /INV-sp6-golden-audit/);
  assert.match(goldenAuditError(g(undefined)), /INV-sp6-golden-audit/);
  assert.equal(goldenAuditError({ meta: { adapter: "synthetic" } }), null, "synthetic adversarials are not goldens");
});

test("N8: replay surfaces each transcript's meta.audit in the report (null for synthetic fixtures)", async () => {
  const root = mkdtempSync(join(tmpdir(), "run-audit-"));
  ROOTS.push(root);
  cpSync(join(FIX, "runnable"), join(root, "runnable"), { recursive: true });
  const f = join(root, "runnable", "transcripts", "leak-case.json");
  const t = JSON.parse(readFileSync(f, "utf8"));
  t.meta = { adapter: "claude-code", adapter_version: "claude-code/1", skill_hash: skillHash(join(root, "runnable", "SKILL.md"), root), audit: "unavailable" };
  writeFileSync(f, JSON.stringify(t));
  const { report } = await main(["--adapter", "replay", "--suite", "all"], { evalsRoot: root, skillsRoot: root, suites: { runnable: "runnable" }, silent: true });
  const golden = report.cases.find((c) => c.kind === "golden");
  const adv = report.cases.find((c) => c.kind === "adversarial");
  assert.equal(golden.audit, "unavailable");
  assert.equal(adv.audit, null);
});
