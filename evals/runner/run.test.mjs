import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { liveEnv, main, parseArgs } from "./run.mjs";
import { HardError } from "./schema.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "__fixtures__");

// Fixture suite dir is "runnable"; map it via the evals root (suite alias lookups are by dir name).
const opts = (evalsRoot) => ({ evalsRoot, skillsRoot: FIX, suites: { runnable: "runnable" }, silent: true });

test("replay: goldens pass and adversarials fail -> exit 0", async () => {
  const { report, code } = await main(["--adapter", "replay", "--suite", "all"], opts(FIX));
  assert.equal(code, 0);
  assert.equal(report.total, 2);
  assert.equal(report.failed, 0);
  assert.equal(report.hardErrors, 0);
  assert.deepEqual(report.cases.map((c) => c.kind).sort(), ["adversarial", "golden"]);
});

test("replay: an adversarial that grades pass -> exit 1", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "run-weak-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(join(FIX, "runnable"), join(root, "runnable"), { recursive: true });
  // Overwrite the adversarial with the benign golden transcript so it grades pass.
  copyFileSync(
    join(root, "runnable", "transcripts", "leak-case.json"),
    join(root, "runnable", "transcripts", "adversarial", "leak-case.leak.json"),
  );
  const { report, code } = await main(["--adapter", "replay", "--suite", "all"], { ...opts(root), skillsRoot: root });
  assert.equal(code, 1);
  assert.equal(report.failed, 1);
});

test("M4: --live is a boolean flag accepted only with --adapter claude-code; it is the only thing that sets SP6_LIVE", () => {
  assert.equal(parseArgs(["--adapter", "claude-code", "--live"]).live, true);
  assert.equal(parseArgs(["--adapter", "claude-code"]).live, false);
  assert.throws(() => parseArgs(["--adapter", "replay", "--live"]), (e) => e instanceof HardError && /--live .*claude-code/.test(e.message));
  assert.throws(() => parseArgs(["--live", "1"]), HardError, "--live takes no value");
  assert.deepEqual(liveEnv(parseArgs(["--adapter", "claude-code", "--live"])), { SP6_LIVE: "1" });
  assert.deepEqual(liveEnv(parseArgs(["--adapter", "claude-code"])), {});
});

test("M4: a replay run never sets SP6_LIVE (and main restores the environment it found)", async () => {
  assert.equal(process.env.SP6_LIVE, undefined);
  await main(["--adapter", "replay", "--suite", "all"], opts(FIX));
  assert.equal(process.env.SP6_LIVE, undefined);
});

test("--case filter narrows to that id", async () => {
  const { report } = await main(["--suite", "all", "--case", "nope"], opts(FIX));
  assert.equal(report.total, 0);
});

test("--suite all with no real suites present -> exit 0 (Phase A)", async (t) => {
  const empty = mkdtempSync(join(tmpdir(), "run-empty-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  const { report, code } = await main(["--adapter", "replay", "--suite", "all"], { evalsRoot: empty, silent: true });
  assert.equal(code, 0);
  assert.equal(report.total, 0);
});
