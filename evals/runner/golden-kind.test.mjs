// Final review I2: golden ⇒ meta.adapter "claude-code", adversarial ⇒ "synthetic", anything else a hard failure — in
// replay (adapters/replay.mjs), at validate time (scripts/validate-skills.mjs) and in golden.mjs (goldenAuditError).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { goldenAuditError, transcriptKindError } from "./golden.mjs";
import { skillHash } from "./hashes.mjs";
import { main } from "./run.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "__fixtures__");
const ROOT = join(HERE, "..", "..");
const ROOTS = [];
after(() => { for (const r of ROOTS) rmSync(r, { recursive: true, force: true }); });

test("transcriptKindError: golden ⇒ claude-code, adversarial ⇒ synthetic, otherwise an error", () => {
  const t = (adapter) => ({ meta: { adapter } });
  assert.equal(transcriptKindError(t("claude-code"), "golden"), null);
  assert.equal(transcriptKindError(t("synthetic"), "adversarial"), null);
  assert.match(transcriptKindError(t("synthetic"), "golden"), /golden/);
  assert.match(transcriptKindError(t("claude-code"), "adversarial"), /adversarial/);
  for (const a of [undefined, null, "replay", "Claude-Code"]) {
    assert.ok(transcriptKindError(t(a), "golden"), String(a));
    assert.ok(transcriptKindError(t(a), "adversarial"), String(a));
  }
  assert.ok(transcriptKindError(t("claude-code"), "live"), "an unknown kind is an error");
  assert.ok(transcriptKindError(null, "golden"));
});

test("goldenAuditError: a synthetic golden is refused (it would bypass the audit and staleness gates)", () => {
  assert.match(goldenAuditError({ meta: { adapter: "synthetic" } }), /golden/);
});

/** A copy of the runnable fixture suite whose golden / adversarial metas are replaced. */
function world(goldenMeta, advMeta) {
  const root = mkdtempSync(join(tmpdir(), "golden-kind-"));
  ROOTS.push(root);
  cpSync(join(FIX, "runnable"), join(root, "runnable"), { recursive: true });
  const edit = (rel, meta) => {
    const f = join(root, "runnable", "transcripts", rel);
    const t = JSON.parse(readFileSync(f, "utf8"));
    if (meta) t.meta = meta;
    writeFileSync(f, JSON.stringify(t));
  };
  edit("leak-case.json", goldenMeta);
  edit(join("adversarial", "leak-case.leak.json"), advMeta);
  return root;
}
const replay = (root) => main(["--adapter", "replay", "--suite", "all"], { evalsRoot: root, skillsRoot: root, suites: { runnable: "runnable" }, silent: true });

test("[E2E] replay: a synthetic golden fails (HardError), even though it grades pass", async () => {
  const root = world({ adapter: "synthetic", adapter_version: "synthetic/1", grader_hash: "x" }, null);
  const { report, code } = await replay(root);
  const g = report.cases.find((c) => c.kind === "golden");
  assert.equal(code, 1);
  assert.equal(g.pass, false);
  assert.match(g.hardError, /golden .*claude-code/);
});

test("[E2E] replay: a claude-code adversarial fails (HardError), not a graded fail", async () => {
  const cc = (root) => ({ adapter: "claude-code", adapter_version: "claude-code/1", skill_hash: skillHash(join(root, "runnable", "SKILL.md"), root), audit: "available", signer_audit: "no-signer-exec" });
  const root = world(null, null);
  const meta = cc(root);
  const f = join(root, "runnable", "transcripts", "adversarial", "leak-case.leak.json");
  writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), meta }));
  const { report } = await replay(root);
  const a = report.cases.find((c) => c.kind === "adversarial");
  assert.equal(a.pass, false);
  assert.match(a.hardError, /adversarial .*synthetic/);
});

test("validate-skills.mjs binds kind to adapter for every golden AND every adversarial (transcriptKindError)", () => {
  const src = readFileSync(join(ROOT, "scripts", "validate-skills.mjs"), "utf8");
  assert.match(src, /transcriptKindError\(t, 'golden'\)/);
  assert.match(src, /transcriptKindError\([a-z]+, 'adversarial'\)/);
  assert.ok(!/t\.meta\.adapter === 'claude-code' && hash/.test(src), "staleness must not be skipped for a non-claude-code golden");
});
