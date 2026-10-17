// Final review m2: in the merge gate (validate.yml) a failing replay step must not hide the INV results — the
// `npm run validate` step runs even when an earlier step failed, so CI shows every INV line.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkflow, stepsOf } from "./live-workflow-check.mjs";

const YML = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows", "validate.yml"), "utf8");

test("m2: validate.yml runs `npm run validate` with if: always(), after the replay gate", () => {
  const steps = stepsOf(readWorkflow(YML).jobs.find((j) => j.id === "validate"));
  const at = (re) => steps.findIndex((s) => re.test(s.run ?? ""));
  const replay = at(/run\.mjs --adapter replay --suite all/);
  const validate = at(/npm run validate/);
  assert.ok(replay >= 0 && validate > replay, "validate runs after the replay step");
  assert.equal(steps[validate].if, "always()");
  assert.equal(steps[replay].if, undefined, "the replay gate itself stays unconditional");
});
