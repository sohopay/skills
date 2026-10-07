import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./run.mjs";

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

test("replay: an adversarial that grades pass -> exit 1", async () => {
  const root = mkdtempSync(join(tmpdir(), "run-weak-"));
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

test("--case filter narrows to that id", async () => {
  const { report } = await main(["--suite", "all", "--case", "nope"], opts(FIX));
  assert.equal(report.total, 0);
});

test("--suite all with no real suites present -> exit 0 (Phase A)", async () => {
  const empty = mkdtempSync(join(tmpdir(), "run-empty-"));
  const { report, code } = await main(["--adapter", "replay", "--suite", "all"], { evalsRoot: empty, silent: true });
  assert.equal(code, 0);
  assert.equal(report.total, 0);
});
