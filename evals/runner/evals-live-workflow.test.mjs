// T17: the opt-in live workflow cannot run here, so its safety properties are pinned statically. Each ruling is asserted
// on the committed .github/workflows/evals-live.yml, and each check is shown to have teeth: one mutation per ruling
// must be reported by liveWorkflowErrors (the same checker INV-sp6-live-workflow runs in `npm run validate`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PINS } from "./adapters/cc-guards.mjs";
import { CONCURRENCY_PREFIX, FORK_EXPR, liveWorkflowErrors, readWorkflow } from "./live-workflow-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const YML = readFileSync(join(ROOT, ".github", "workflows", "evals-live.yml"), "utf8");
const wf = readWorkflow(YML);
const job = (id) => wf.jobs.find((j) => j.id === id);
const key = (j, k) => j.keys.find((b) => b.key === k);

test("INV-sp6-live-workflow: the committed evals-live.yml satisfies every ruling", () => {
  assert.deepEqual(liveWorkflowErrors(YML), []);
});

test("job graph: gate → live (environment) → issues + regen; every later job needs the gate", () => {
  assert.deepEqual(wf.jobs.map((j) => j.id), ["gate", "live", "issues", "regen"]);
  assert.equal(key(job("live"), "needs").value, "gate");
  for (const id of ["issues", "regen"]) assert.equal(key(job(id), "needs").value, "[gate, live]");
  assert.equal(key(job("live"), "environment").value, "sp6-live-evals");
  for (const id of ["gate", "issues", "regen"]) assert.equal(key(job(id), "environment"), undefined, id);
});

test("triggers: workflow_dispatch + pull_request [labeled] ONLY (one spend per explicit label / dispatch), label-gated; never pull_request_target", () => {
  assert.ok(!/pull_request_target/.test(wf.clean));
  assert.match(YML, /pull_request:\n\s+types: \[labeled\]\n/);
  assert.ok(!/synchronize|reopened|opened/.test(wf.clean.split("jobs:")[0]), "no push-driven or open-driven PR type");
  assert.match(key(job("gate"), "if").body.join("\n"), /contains\(github\.event\.pull_request\.labels\.\*\.name, 'run-live-evals'\)/);
});

test("fork safety: the first job has no environment and no secrets and refuses a fork PR; regen re-checks same-repo", () => {
  const gate = job("gate");
  assert.equal(key(gate, "permissions").value, "{}");
  assert.ok(gate.text.includes(FORK_EXPR) && !/secrets\./.test(gate.text));
  assert.match(key(job("regen"), "if").body.join("\n"), /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
});

test("concurrency + permissions: per-PR group, cancel-in-progress; top-level {}; least privilege per job", () => {
  assert.ok(YML.includes(`group: ${CONCURRENCY_PREFIX}`));
  assert.match(YML, /^permissions: \{\}$/m);
  assert.match(job("live").text, /permissions:\n\s+contents: read\n/);
  assert.match(job("issues").text, /permissions:\n\s+issues: write\n/);
  assert.match(job("regen").text, /permissions:\n\s+contents: write\n/);
});

test("run job: sandbox required, audit required, runner-private run root, pinned CLI + budget, k=5 all suites", () => {
  const live = job("live").text;
  assert.match(live, /SP6_REQUIRE_SANDBOX: "1"/);
  assert.match(live, /SP6_AUDIT: require/);
  assert.match(live, /--require-audit/);
  assert.match(live, /SP6_RUN_ROOT_BASE: \$\{\{ runner\.temp \}\}\/sp6-run\n/);
  assert.match(live, new RegExp(`CLAUDE_CODE_VERSION: "${PINS.CLI_VERSION.replace(/\./g, "\\.")}"`));
  assert.match(live, /npm install -g [^\n]*"@anthropic-ai\/claude-code@\$\{CLAUDE_CODE_VERSION\}"/);
  assert.match(live, /SP6_LIVE_BUDGET_USD: "10"/);
  assert.match(live, /--adapter claude-code --suite all --samples "\$SAMPLES"/);
  assert.equal(PINS.MODEL_ID, "claude-sonnet-5-5");
  assert.equal(PINS.MAX_TURNS, 20);
  // The kernel/evidence tests must run (none skipped) before the live run, without the API key in reach.
  const tests = live.indexOf("node --test evals/runner/*.test.mjs evals/runner/adapters/*.test.mjs");
  assert.ok(tests > 0 && tests < live.indexOf("node evals/runner/run.mjs"), "runner tests precede the live run");
  assert.match(live, /grep -qx 'ℹ skipped 0'/);
  assert.equal((live.match(/ANTHROPIC_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/g) ?? []).length, 1, "the key is exposed to one step only");
});

test("actions are SHA-pinned with a version comment; artifacts short-lived", () => {
  const uses = [...YML.matchAll(/uses: (\S+)( # v[\d.]+)?/g)];
  assert.ok(uses.length >= 5);
  for (const [, ref, comment] of uses) {
    assert.match(ref, /^actions\/[a-z-]+@[0-9a-f]{40}$/);
    assert.ok(comment, `${ref} has a version comment`);
  }
  for (const [, d] of YML.matchAll(/retention-days: (\d+)/g)) assert.ok(Number(d) <= 7);
});

test("regen pushes only to the PR head branch, refuses develop/main, checks the head did not move, bot author, no trailer", () => {
  const regen = job("regen").text;
  assert.match(regen, /develop\|main\) echo "::error::never commit goldens/);
  assert.match(regen, /git push origin "HEAD:refs\/heads\/\$\{HEAD_REF\}"/);
  assert.match(regen, /git rev-parse HEAD\)" != "\$HEAD_SHA"/);
  assert.match(regen, /user\.name="github-actions\[bot\]"/);
  assert.match(regen, /must re-run the replay gate/);
  assert.match(regen, /GitHub App installation token/);
  assert.ok(!/Co-Authored-By|Generated with/i.test(regen));
});

// Teeth: each ruling, broken once, must be reported.
const MUTATIONS = [
  ["pull_request_target", (y) => y.replace("  pull_request:\n", "  pull_request_target:\n"), /pull_request_target|triggers/],
  ["push trigger", (y) => y.replace("  pull_request:\n", "  push:\n  pull_request:\n"), /triggers must be exactly/],
  ["synchronize type", (y) => y.replace("types: [labeled]", "types: [labeled, synchronize]"), /types must be exactly \[labeled\]/],
  ["opened type", (y) => y.replace("types: [labeled]", "types: [opened, labeled]"), /types must be exactly \[labeled\]/],
  ["reopened type", (y) => y.replace("types: [labeled]", "types: [labeled, reopened]"), /types must be exactly \[labeled\]/],
  ["unlabeled type", (y) => y.replace("types: [labeled]", "types: [labeled, unlabeled]"), /types must be exactly \[labeled\]/],
  ["no types (GitHub default: opened, synchronize, reopened)", (y) => y.replace("  pull_request:\n    types: [labeled]\n", "  pull_request:\n"), /types must be exactly \[labeled\]/],
  ["noop concurrency suffix removed (an unrelated label would cancel a running live eval)", (y) => y.replace(/\$\{\{ github\.event_name == 'pull_request' && \(!contains[^\n]*-noop-[^\n]*\}\}/, ""), /noop/],
  ["noop suffix ignores unrelated labels", (y) => y.replace(" || (github.event.action == 'labeled' && github.event.label.name != 'run-live-evals')", ""), /noop/],
  ["top-level write-all", (y) => y.replace(/^permissions: \{\}$/m, "permissions: write-all"), /top-level permissions/],
  ["concurrency group", (y) => y.replace("group: sp6-live-", "group: live-"), /concurrency group/],
  ["no cancel-in-progress", (y) => y.replace("cancel-in-progress: true", "cancel-in-progress: false"), /cancel-in-progress/],
  ["environment on gate", (y) => y.replace("    runs-on: ubuntu-latest\n    permissions: {}\n    outputs:", "    runs-on: ubuntu-latest\n    environment: sp6-live-evals\n    permissions: {}\n    outputs:"), /first job gate must not load an environment|exactly one job/],
  ["fork refusal removed", (y) => y.split(FORK_EXPR).join("false"), /must refuse a fork PR/],
  ["label gate removed", (y) => y.replace("contains(github.event.pull_request.labels.*.name, 'run-live-evals') &&\n", "true &&\n"), /run-live-evals label/],
  ["issues job skips the gate", (y) => y.replace("    needs: [gate, live]\n    if: ${{ !cancelled() && needs.live.outputs.safety_failures", "    needs: [live]\n    if: ${{ !cancelled() && needs.live.outputs.safety_failures"), /job issues must need the gate job/],
  ["secret in issues job", (y) => y.replace("          GH_REPO: ${{ github.repository }}", "          GH_REPO: ${{ github.repository }}\n          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}"), /references ANTHROPIC_API_KEY outside/],
  ["write on live job", (y) => y.replace("    permissions:\n      contents: read\n", "    permissions:\n      contents: write\n"), /environment job live/],
  ["two writes on regen", (y) => y.replace("    permissions:\n      contents: write\n", "    permissions:\n      contents: write\n      issues: write\n"), /more than one write/],
  ["tag-pinned action", (y) => y.replace(/actions\/checkout@[0-9a-f]{40}/, "actions/checkout@v4"), /not pinned by full commit SHA/],
  ["no version comment", (y) => y.replace(" # v4.6.2", ""), /version comment/],
  ["sandbox not required", (y) => y.replace('SP6_REQUIRE_SANDBOX: "1"', 'SP6_REQUIRE_SANDBOX: "0"'), /SP6_REQUIRE_SANDBOX/],
  ["audit not required", (y) => y.replace("SP6_AUDIT: require", "SP6_AUDIT: off").replace(" --require-audit)", ")"), /require the file audit/],
  ["run root in /tmp", (y) => y.replace("SP6_RUN_ROOT_BASE: ${{ runner.temp }}/sp6-run\n", "SP6_RUN_ROOT_BASE: /tmp/sp6-run\n"), /never matches|SP6_RUN_ROOT_BASE/],
  ["CLI version drift", (y) => y.replace(`CLAUDE_CODE_VERSION: "${PINS.CLI_VERSION}"`, 'CLAUDE_CODE_VERSION: "9.9.9"'), /CLAUDE_CODE_VERSION/],
  ["budget drift", (y) => y.replace('SP6_LIVE_BUDGET_USD: "10"', 'SP6_LIVE_BUDGET_USD: "100"'), /SP6_LIVE_BUDGET_USD/],
  ["push to develop", (y) => y.replace('git push origin "HEAD:refs/heads/${HEAD_REF}"', "git push origin HEAD:develop"), /develop\/main|unexpected push/],
  ["long retention", (y) => y.replace("retention-days: 7", "retention-days: 90"), /retention/],
];
for (const [name, mutate, expected] of MUTATIONS) {
  test(`teeth: ${name} is reported`, () => {
    const y = mutate(YML);
    assert.notEqual(y, YML, `mutation "${name}" did not apply`);
    const errs = liveWorkflowErrors(y);
    assert.ok(errs.some((e) => expected.test(e)), `${name}: ${JSON.stringify(errs)}`);
  });
}
