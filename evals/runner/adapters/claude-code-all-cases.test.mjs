// Final review m6 + I1: every one of the 17 cases' doc-faithful honest flow (mock-honest-flows.mjs, via the honest stub
// "model") goes through the REAL live adapter — world, hook relay, mock backend + signer host, cc-assemble — and must
// validate, grade PASS against the case's real assertions, and pass the committed-secrets scan exactly as a golden
// committed at evals/<suite>/transcripts/<case>.json would. This makes adapter↔recorder parity a gate.
// The `claude` is a marked stub (no live, paid session). The signer child runs under this host's real OS sandbox when
// one is available (macOS sandbox-exec; Linux bwrap + strace), else under the test-only fake seam (CI without bwrap).
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { label, validateTranscript } from "../schema.mjs";
import { grade } from "../grader.mjs";
import { scanCommitted } from "../committed-secrets.mjs";
import { PINS, resolveClaude, run } from "./claude-code.mjs";
import { childTraceSupport, sandboxSupport } from "../../mock/lib/signer-sandbox.mjs";
import { loadScenario, SCENARIO_IDS } from "../../mock/scenarios/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVALS = join(HERE, "..", "..");
const SKILLS = join(EVALS, "..", "plugins", "sohopay", "skills");
const STUB = join(HERE, "__fixtures__", "stub-claude.mjs");
const HONEST = join(HERE, "__fixtures__", "stub-scripts", "honest.mjs");
const STUB_MARKER = "SP6-TEST-STUB-CLAUDE";
const WAIVERS = JSON.parse(readFileSync(join(EVALS, "floor-waivers.json"), "utf8")).waivers;
const assertionsOf = (suite) => new Map(JSON.parse(readFileSync(join(EVALS, suite, "assertions.json"), "utf8")).cases.map((a) => [a.id, a]));
const ASSERTIONS = new Map([...assertionsOf("sohopay-onboard"), ...assertionsOf("sohopay-x402")]);

// Real sandbox where this host has one; the fake seam (R3-1) only where it has none. Under SP6_REQUIRE_SANDBOX=1 (the
// live workflow's pre-flight) the real one is mandatory.
const REAL = sandboxSupport();
const USE_REAL = Boolean(REAL.kind) && (process.platform !== "linux" || childTraceSupport().ok);
const SEAMS = USE_REAL ? undefined : Object.freeze({ signerSandbox: "fake" });

// R4-1: only a marked stub `claude` is ever resolvable here; PATH is reset to it before every test.
const savedPath = process.env.PATH;
const DIR = mkdtempSync(join(tmpdir(), "cc-stub-all-"));
writeFileSync(join(DIR, "claude"), `#!/bin/sh\n# ${STUB_MARKER}\nexec '${process.execPath}' '${STUB}' '${HONEST}' '${DIR}' -- "$@"\n`);
chmodSync(join(DIR, "claude"), 0o755);
after(() => { process.env.PATH = savedPath; rmSync(DIR, { recursive: true, force: true }); });
beforeEach(() => {
  process.env.PATH = `${DIR}:${savedPath}`;
  assert.ok(readFileSync(resolveClaude(), "utf8").slice(0, 512).includes(STUB_MARKER), "R4-1: refusing a non-stub claude");
});

test("the 17 scenarios are the 17 real cases, and the sandbox choice is explicit", () => {
  assert.equal(SCENARIO_IDS.length, 17);
  assert.deepEqual([...ASSERTIONS.keys()].sort(), [...SCENARIO_IDS].sort());
  if (process.env.SP6_REQUIRE_SANDBOX === "1") assert.ok(USE_REAL, `SP6_REQUIRE_SANDBOX=1 but no traced OS sandbox here (${REAL.reason ?? childTraceSupport().reason})`);
});

for (const id of SCENARIO_IDS) {
  test(`[E2E] live adapter, honest stub flow: ${id} validates, grades PASS and passes the committed-secrets scan`, async () => {
    const { suite } = await loadScenario(id);
    const { transcript: t } = await run({ suiteDir: suite, caseId: id }, {
      sample_index: 0, skillsRoot: SKILLS, claudeBin: join(DIR, "claude"), cliVersion: PINS.CLI_VERSION, budgetLeftUsd: 5, testSeams: SEAMS,
    });
    const v = validateTranscript(t);
    assert.ok(v.ok, v.errors.join("; "));
    assert.equal(t.meta.adapter, "claude-code");
    const g = grade(label(t), ASSERTIONS.get(id), WAIVERS);
    assert.equal(g.hardError, null);
    assert.deepEqual(g.findings, [], JSON.stringify(g.findings));
    assert.ok(g.pass);
    const text = JSON.stringify(t, null, 2);
    assert.deepEqual(scanCommitted(`evals/${suite}/transcripts/${id}.json`, text), [], "I1: an honest live-shaped golden passes the committed-secrets scan");
    const events = JSON.stringify(t.events);
    assert.ok(!events.includes(t.secrets.private_key) && !events.includes(t.secrets.header_value), "the canaries never reach the events");
  }, { timeout: 60_000 });
}
