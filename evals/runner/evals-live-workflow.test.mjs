// T17: the opt-in live workflow cannot run here, so its safety properties are pinned statically. Each ruling is asserted
// on the committed .github/workflows/evals-live.yml, and each check is shown to have teeth: one mutation per ruling
// must be reported by liveWorkflowErrors (the same checker INV-sp6-live-workflow runs in `npm run validate`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PINS } from "./adapters/cc-guards.mjs";
import { CONCURRENCY_PREFIX, FORK_EXPR, livePinError, liveWorkflowErrors, readWorkflow, stepsOf } from "./live-workflow-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const YML = readFileSync(join(ROOT, ".github", "workflows", "evals-live.yml"), "utf8");
const wf = readWorkflow(YML);
const job = (id) => wf.jobs.find((j) => j.id === id);
const key = (j, k) => j.keys.find((b) => b.key === k);
const steps = (id) => stepsOf(job(id));
const blockIf = (id) => `${key(job(id), "if").value}\n${key(job(id), "if").body.join("\n")}`;

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
  assert.match(live, /--adapter claude-code --live --suite all --samples "\$SAMPLES"/, "M4: the live spawn guard is opened only by an explicit --live");
  assert.equal(PINS.MODEL_ID, "claude-sonnet-5-5");
  assert.equal(PINS.MAX_TURNS, 20);
  // The kernel/evidence tests must run (none skipped) before the live run, without the API key in reach. I1: Node 22
  // prints TAP (`# skipped N`) when piped unless the spec reporter is forced; the grep matches the spec summary line.
  const tests = live.indexOf("node --test --test-reporter=spec evals/runner/*.test.mjs evals/runner/adapters/*.test.mjs");
  assert.ok(tests > 0 && tests < live.indexOf("node evals/runner/run.mjs"), "runner tests (spec reporter) precede the live run");
  assert.match(live, /grep -qx 'ℹ skipped 0'/);
  // C1: the key is exposed to exactly two steps — the live run and the egress scan that looks for it.
  const keyed = steps("live").filter((s) => /ANTHROPIC_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/.test(s.text)).map((s) => s.id);
  assert.deepEqual(keyed, ["run", "egress"]);
});

test("C1 egress: a scan for the literal key (and its base64) runs after the verdict and before both uploads; uploads only on a clean scan", () => {
  const ids = steps("live").map((s) => s.id ?? s.name);
  const at = (x) => ids.indexOf(x);
  assert.ok(at("verdict") < at("egress") && at("egress") < at("Upload transcripts and report") && at("egress") < at("Upload verdict"), ids.join(" → "));
  const egress = steps("live").find((s) => s.id === "egress");
  assert.match(egress.text, /if: \$\{\{ always\(\) \}\}/);
  assert.match(egress.text, /grep -rqF -e "\$ANTHROPIC_API_KEY" -e "\$b64"/);
  assert.match(egress.text, /rm -rf "\$\{dirs\[@\]\}"/, "a hit quarantines (deletes) the artifact dirs");
  for (const name of ["Upload transcripts and report", "Upload verdict"]) {
    assert.match(steps("live").find((s) => s.name === name).text, /always\(\) && steps\.egress\.outcome == 'success'/, name);
  }
  // Downstream jobs act only on a verdict that passed the scan.
  assert.match(job("live").text, /safety_failures: \$\{\{ steps\.egress\.outcome == 'success' && steps\.verdict\.outputs\.safety_failures \|\| 'false' \}\}/);
  assert.match(job("live").text, /regen_count: \$\{\{ steps\.egress\.outcome == 'success' && steps\.goldenscan\.outcome == 'success' && steps\.verdict\.outputs\.regen_count \|\| '0' \}\}/);
});

test("M2: the live step has its own timeout below the job's; verdict always runs, so spend never goes unreported", () => {
  const jobT = Number(key(job("live"), "timeout-minutes").value);
  const runStep = steps("live").find((s) => s.id === "run");
  const stepT = Number(/timeout-minutes: (\d+)/.exec(runStep.text)?.[1]);
  assert.ok(stepT > 0 && stepT < jobT - 15, `step ${stepT} < job ${jobT} - 15`);
  assert.match(steps("live").find((s) => s.id === "verdict").text, /if: \$\{\{ always\(\) \}\}/);
});

test("M3 + M5: issues are filed per case id with per-id error handling (no set -e abort); both write jobs require gate success", () => {
  const issues = job("issues").text;
  assert.ok(!/set -e/.test(issues), "one gh failure must not stop the other case ids");
  assert.match(issues, /failed=\$\(\(failed \+ 1\)\)/);
  assert.match(issues, /exit "\$\(\( failed > 0 \)\)"/);
  for (const id of ["issues", "regen"]) assert.match(`${key(job(id), "if").value}\n${key(job(id), "if").body.join("\n")}`, /needs\.gate\.result == 'success'/, id);
});

test("I2 hash pin: evals/live-workflow.sha256 pins the committed workflow; any edit must update it (CODEOWNERS covers both)", () => {
  const pin = readFileSync(join(ROOT, "evals", "live-workflow.sha256"), "utf8");
  const RAW = readFileSync(join(ROOT, ".github", "workflows", "evals-live.yml"));
  assert.equal(livePinError(RAW, pin), null);
  assert.match(livePinError(Buffer.from(YML.replace("timeout-minutes", "timeout-minutes ")), pin), /INV-sp6-live-workflow: .*sha256 .* != pinned/);
  assert.match(livePinError(RAW, ""), /pin/);
  const owners = readFileSync(join(ROOT, "CODEOWNERS"), "utf8");
  assert.match(owners, /^\/\.github\/workflows\/evals-live\.yml\s+@sohopay\/backend-write$/m);
  assert.match(owners, /^\/evals\/live-workflow\.sha256\s+@sohopay\/backend-write$/m);
});

test("m7: the code that ENFORCES the pin (validate-skills.mjs, validate.yml) is maintainer-owned too; the repo-wide catch-all stays first", () => {
  const lines = readFileSync(join(ROOT, "CODEOWNERS"), "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  assert.match(lines[0], /^\*\s+@sohopay\/platform$/, "catch-all first (later, more specific lines win)");
  // Final review I2: committed transcripts (goldens + adversarials) are maintainer-owned as well.
  for (const p of ["/scripts/validate-skills.mjs", "/.github/workflows/validate.yml", "/evals/runner/", "/.github/workflows/evals-live.yml", "/evals/live-workflow.sha256", "/evals/*/transcripts/"]) {
    assert.ok(lines.some((l) => l.split(/\s+/)[0] === p && /@sohopay\/backend-write/.test(l)), p);
  }
});

test("m8: the pin hashes the file's raw BYTES, so byte sequences that decode alike (invalid UTF-8 → U+FFFD) still differ", () => {
  const raw = readFileSync(join(ROOT, ".github", "workflows", "evals-live.yml"));
  assert.equal(livePinError(raw, readFileSync(join(ROOT, "evals", "live-workflow.sha256"), "utf8")), null, "the committed bytes match the pin");
  const a = Buffer.concat([Buffer.from("x: 1\n"), Buffer.from([0xff])]);
  const b = Buffer.concat([Buffer.from("x: 1\n"), Buffer.from([0xfe])]);
  assert.equal(a.toString("utf8"), b.toString("utf8"), "the two decode to the same string");
  const pinA = `${createHash("sha256").update(a).digest("hex")}  .github/workflows/evals-live.yml\n`;
  assert.equal(livePinError(a, pinA), null);
  assert.match(livePinError(b, pinA), /!= pinned/);
  // Only bytes are accepted (a decoded string would collapse the two above), and the INV reads the file as bytes.
  assert.throws(() => livePinError(a.toString("utf8"), pinA), TypeError);
  assert.match(readFileSync(join(ROOT, "scripts", "validate-skills.mjs"), "utf8"), /const raw = readFileSync\(f\);[\s\S]{0,400}livePinError\(raw,/);
});

test("I2: no `${{ }}` expression inside any run: body (script injection); every value reaches the shell through env", () => {
  for (const j of wf.jobs) for (const s of steps(j.id)) if (s.run) assert.ok(!/\$\{\{/.test(s.run), `${j.id}/${s.id ?? s.name}`);
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

test("final review I1: staged goldens are re-scanned (committed-secrets) after the verdict and before egress; regen needs a clean scan; rejects open issues", () => {
  const ids = steps("live").map((s) => s.id ?? s.name);
  assert.ok(ids.indexOf("verdict") < ids.indexOf("goldenscan") && ids.indexOf("goldenscan") < ids.indexOf("egress"), ids.join(" → "));
  const scan = steps("live").find((s) => s.id === "goldenscan");
  assert.equal(scan.if, "${{ always() && steps.verdict.outcome == 'success' }}");
  assert.match(scan.run, /node evals\/runner\/live-ci\.mjs --scan-verdict-dir "\$RUNNER_TEMP\/sp6-verdict" \| tee -a "\$GITHUB_OUTPUT"/);
  assert.match(scan.run, /set -euo pipefail/);
  assert.match(job("live").text, /golden_scan_rejects: \$\{\{ steps\.egress\.outcome == 'success' && steps\.goldenscan\.outputs\.rejects \|\| '0' \}\}/);
  assert.match(blockIf("issues"), /needs\.live\.outputs\.golden_scan_rejects != '0'/);
});

// Teeth: each ruling, broken once, must be reported.
const MUTATIONS = [
  ["I1: golden scan step removed", (y) => y.replace(/      - name: Committed-secrets scan of the staged goldens[\s\S]*?tee -a "\$GITHUB_OUTPUT"\n/, ""), /golden scan/],
  ["I1: golden scan after the egress scan", (y) => { const m = /      # I1: every staged golden[\s\S]*?tee -a "\$GITHUB_OUTPUT"\n\n/.exec(y); return y.replace(m[0], "").replace("      # Transcripts carry only", `${m[0]}      # Transcripts carry only`); }, /golden scan/],
  ["I1: regen not gated on the golden scan", (y) => y.replace("steps.egress.outcome == 'success' && steps.goldenscan.outcome == 'success' && steps.verdict.outputs.regen_count", "steps.egress.outcome == 'success' && steps.verdict.outputs.regen_count"), /regen_count .*goldenscan/],
  ["I1: golden scan fails open", (y) => y.replace('node evals/runner/live-ci.mjs --scan-verdict-dir "$RUNNER_TEMP/sp6-verdict" | tee -a "$GITHUB_OUTPUT"', 'node evals/runner/live-ci.mjs --scan-verdict-dir "$RUNNER_TEMP/sp6-verdict" | tee -a "$GITHUB_OUTPUT" || true'), /golden scan/],
  ["I1: issues ignore golden-scan rejects", (y) => y.replace(" || needs.live.outputs.golden_scan_rejects != '0'", ""), /golden_scan_rejects/],

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
  ["issues job skips the gate", (y) => y.replace("    needs: [gate, live]\n    if: ${{ !cancelled() && needs.gate.result == 'success' && (needs.live.outputs.safety_failures", "    needs: [live]\n    if: ${{ !cancelled() && needs.gate.result == 'success' && (needs.live.outputs.safety_failures"), /job issues must need the gate job/],
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
  // ── I2 (review): mutations the first checker accepted ──
  ["injection: PR title in a gate run body", (y) => y.replace('        run: |\n          set -euo pipefail\n          if [ "$EVENT" = "pull_request" ]; then', '        run: |\n          echo "${{ github.event.pull_request.title }}"\n          set -euo pipefail\n          if [ "$EVENT" = "pull_request" ]; then'), /expression inside a run: body/],
  ["injection: label name in a gate run body", (y) => y.replace('        run: |\n          set -euo pipefail\n          if [ "$EVENT" = "pull_request" ]; then', '        run: |\n          echo "${{ github.event.label.name }}"\n          set -euo pipefail\n          if [ "$EVENT" = "pull_request" ]; then'), /expression inside a run: body/],
  ["injection: PR body in an issues run body", (y) => y.replace("          shopt -s nullglob\n", "          shopt -s nullglob\n          echo \"${{ github.event.pull_request.body }}\"\n"), /expression inside a run: body/],
  ["injection: head.ref in the regen push", (y) => y.replace('git push origin "HEAD:refs/heads/${HEAD_REF}"', 'git push origin "HEAD:refs/heads/${{ github.event.pull_request.head.ref }}"'), /expression inside a run: body/],
  ["injection: dispatch input in a run body", (y) => y.replace('          if [ -n "$CASE" ]; then args+=(--case "$CASE"); fi', '          if [ -n "${{ inputs.case }}" ]; then args+=(--case "$CASE"); fi'), /expression inside a run: body/],
  ["flow-style permissions with write", (y) => y.replace("    permissions:\n      issues: write\n", "    permissions: { issues: write, contents: write, actions: write }\n"), /flow-style permissions/],
  ["key in workflow-level env", (y) => y.replace("\njobs:\n", "\nenv:\n  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}\n\njobs:\n"), /workflow-level env|ANTHROPIC_API_KEY outside/],
  ["key in the live job env (reaches the PR-code test step)", (y) => y.replace('      SP6_REQUIRE_SANDBOX: "1"\n', '      SP6_REQUIRE_SANDBOX: "1"\n      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}\n'), /job-level env|ANTHROPIC_API_KEY outside/],
  ["key in the test step env", (y) => y.replace("          SP6_RUN_ROOT_BASE: ${{ runner.temp }}/sp6-run-tests\n", "          SP6_RUN_ROOT_BASE: ${{ runner.temp }}/sp6-run-tests\n          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}\n"), /ANTHROPIC_API_KEY outside/],
  ["fork step disabled with false &&", (y) => y.replace("if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository", "if: false && github.event.pull_request.head.repo.full_name != github.repository"), /fork step/],
  ["fork step no longer exits 1", (y) => y.replace('live evals run only on same-repo branches"\n          exit 1', 'live evals run only on same-repo branches"\n          exit 0'), /fork step/],
  ["gate if short-circuited with true ||", (y) => y.replace("      github.event_name == 'workflow_dispatch' ||", "      true || github.event_name == 'workflow_dispatch' ||"), /gate .*if/],
  ["gate if short-circuited with always()", (y) => y.replace("      github.event_name == 'workflow_dispatch' ||", "      always() || github.event_name == 'workflow_dispatch' ||"), /gate .*if/],
  ["force push (--force)", (y) => y.replace('git push origin "HEAD', 'git push --force origin "HEAD'), /force|unexpected push/],
  ["force push (-f)", (y) => y.replace('git push origin "HEAD', 'git push -f origin "HEAD'), /force|unexpected push/],
  ["force push (+refspec)", (y) => y.replace('"HEAD:refs/heads/${HEAD_REF}"', '"+HEAD:refs/heads/${HEAD_REF}"'), /force|unexpected push/],
  ["live checkout persists credentials", (y) => y.replace("          persist-credentials: false\n", ""), /persist-credentials/],
  ["live checkout gets a token", (y) => y.replace("          persist-credentials: false\n", "          persist-credentials: false\n          token: ${{ secrets.GITHUB_TOKEN }}\n"), /live checkout/],
  ["regen path regex removed", (y) => y.split("\n").filter((l) => !l.includes('[[ "$p" =~ ^evals/sohopay-')).join("\n"), /regen path/],
  ["regen same-repo clause removed", (y) => y.replace("          github.event.pull_request.head.repo.full_name == github.repository &&\n", ""), /same-repo/],
  ["regen runs PR code", (y) => y.replace("          git add -- \"${paths[@]}\"\n", "          npm ci && node scripts/validate-skills.mjs\n          git add -- \"${paths[@]}\"\n"), /runs PR code/],
  ["issues job checks out the repo", (y) => y.replace("    permissions:\n      issues: write\n    steps:\n", "    permissions:\n      issues: write\n    steps:\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0\n"), /must not check out/],
  ["secrets: inherit", (y) => y.replace("  regen:\n", "  extra:\n    needs: gate\n    uses: ./.github/workflows/validate.yml\n    secrets: inherit\n\n  regen:\n"), /secrets: inherit/],
  ["artifact path widened to all of runner.temp", (y) => y.replace("          path: ${{ runner.temp }}/sp6-live\n", "          path: ${{ runner.temp }}\n"), /artifact path/],
  // ── fix round 1 (C1, I1, M2–M5) ──
  ["I1: spec reporter dropped", (y) => y.replace("node --test --test-reporter=spec ", "node --test "), /test-reporter=spec/],
  ["M4: --live dropped", (y) => y.replace("--adapter claude-code --live --suite", "--adapter claude-code --suite"), /--live/],
  ["C1: egress scan removed", (y) => y.replace(/      - name: Egress scan[\s\S]*?(?=      # Transcripts carry)/, ""), /egress/],
  ["C1: transcript upload not gated on the scan", (y) => y.replace("if: ${{ always() && steps.egress.outcome == 'success' }}\n        uses: actions/upload-artifact", "if: ${{ always() }}\n        uses: actions/upload-artifact"), /egress/],
  ["M2: no live-step timeout", (y) => y.replace("        timeout-minutes: 300\n", ""), /step timeout/],
  ["M5: issues without gate success", (y) => y.replace("${{ !cancelled() && needs.gate.result == 'success' && (needs.live.outputs.safety_failures", "${{ !cancelled() && (needs.live.outputs.safety_failures"), /needs\.gate\.result/],
  ["M3: set -e in the issues loop", (y) => y.replace("          set -uo pipefail\n          gh label create", "          set -euo pipefail\n          gh label create"), /set -e/],
  // ── fix round 2, m1 (re-review mutations A–G and the ruling's list) ──
  ["m1: always() on the live job (a paid run even when the gate is skipped / fails)", (y) => y.replace("  live:\n    name: Live run (protected environment)\n    needs: gate\n", "  live:\n    name: Live run (protected environment)\n    needs: gate\n    if: ${{ always() }}\n"), /status function/],
  ["m1: !cancelled() on the live job", (y) => y.replace("  live:\n    name: Live run (protected environment)\n    needs: gate\n", "  live:\n    name: Live run (protected environment)\n    needs: gate\n    if: ${{ !cancelled() }}\n"), /status function/],
  ["m1: failure() on the gate", (y) => y.replace("      github.event_name == 'workflow_dispatch' ||", "      failure() || github.event_name == 'workflow_dispatch' ||"), /gate .*if|status function/],
  ["m1: !cancelled() on the gate", (y) => y.replace("      github.event_name == 'workflow_dispatch' ||", "      !cancelled() && github.event_name == 'workflow_dispatch' ||"), /gate .*if|status function/],
  ["m1: push HEAD_REF from base.ref (pushes to the base branch)", (y) => y.replace("          HEAD_REF: ${{ github.event.pull_request.head.ref }}\n          HEAD_SHA:", "          HEAD_REF: ${{ github.event.pull_request.base.ref }}\n          HEAD_SHA:"), /HEAD_REF/],
  ["m1: push HEAD_REF a literal", (y) => y.replace("          HEAD_REF: ${{ github.event.pull_request.head.ref }}\n          HEAD_SHA:", "          HEAD_REF: develop\n          HEAD_SHA:"), /HEAD_REF/],
  ["m1: github-script script: with an event expression", (y) => y.replace("      - name: One issue per failing safety case id", "      - uses: actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea # v7.0.1\n        with:\n          script: console.log(\"${{ github.event.pull_request.title }}\")\n      - name: One issue per failing safety case id"), /script:/],
  ["m1: eval of an env value", (y) => y.replace('        run: |\n          set -euo pipefail\n          if [ "$EVENT" = "pull_request" ]; then', '        run: |\n          eval "echo $HEAD_REF"\n          set -euo pipefail\n          if [ "$EVENT" = "pull_request" ]; then'), /eval|-c "\$/],
  ["m1: bash -c \"$VAR\"", (y) => y.replace("          mkdir -p \"$SP6_LIVE_OUT_DIR\"\n", "          mkdir -p \"$SP6_LIVE_OUT_DIR\"\n          bash -c \"$CASE\"\n"), /eval|-c "\$/],
  ["m1: continue-on-error on the fork step", (y) => y.replace("      - name: Refuse a fork PR\n", "      - name: Refuse a fork PR\n        continue-on-error: true\n"), /continue-on-error/],
  ["m1: continue-on-error on the egress step", (y) => y.replace("        id: egress\n", "        id: egress\n        continue-on-error: true\n"), /continue-on-error/],
  ["m1: continue-on-error on the gate job", (y) => y.replace("  gate:\n    name: Gate (fork refusal, no secrets)\n", "  gate:\n    name: Gate (fork refusal, no secrets)\n    continue-on-error: true\n"), /continue-on-error/],
  ["m1: toJSON(github.event) written to GITHUB_ENV", (y) => y.replace("          EVENT: ${{ github.event_name }}\n", "          EVENT: ${{ github.event_name }}\n          EV: ${{ toJSON(github.event) }}\n").replace('          set -euo pipefail\n          if [ "$EVENT" = "pull_request" ]; then', '          set -euo pipefail\n          echo "BODY=$(echo "$EV" | jq -r .pull_request.body)" >> "$GITHUB_ENV"\n          if [ "$EVENT" = "pull_request" ]; then'), /toJSON|GITHUB_ENV/],
  ["m1: PR title written to GITHUB_OUTPUT", (y) => y.replace("          EVENT: ${{ github.event_name }}\n", "          EVENT: ${{ github.event_name }}\n          TITLE: ${{ github.event.pull_request.title }}\n").replace('          set -euo pipefail\n          if [ "$EVENT" = "pull_request" ]; then', '          set -euo pipefail\n          echo "title=$TITLE" >> "$GITHUB_OUTPUT"\n          if [ "$EVENT" = "pull_request" ]; then'), /event text/],
  ["m1: anything written to GITHUB_PATH", (y) => y.replace("          strace -V | head -n 1\n", "          strace -V | head -n 1\n          echo \"$RUNNER_TEMP/bin\" >> \"$GITHUB_PATH\"\n"), /GITHUB_PATH|GITHUB_ENV/],
  // ── m2: force pushes the exact PUSH_LINE comparison alone would NOT catch ──
  ["m2: forced refspec configured, exact push line kept", (y) => y.replace('          git push origin "HEAD:refs/heads/${HEAD_REF}"\n', '          git config remote.origin.push "+HEAD:refs/heads/${HEAD_REF}"\n          git push origin "HEAD:refs/heads/${HEAD_REF}"\n'), /force/],
  ["m2: `git -c … push --force` (not a `git push` line)", (y) => y.replace('git push origin "HEAD:refs/heads/${HEAD_REF}"', 'git -c protocol.version=2 push --force origin "HEAD:refs/heads/${HEAD_REF}"'), /force/],
];
for (const [name, mutate, expected] of MUTATIONS) {
  test(`teeth: ${name} is reported`, () => {
    const y = mutate(YML);
    assert.notEqual(y, YML, `mutation "${name}" did not apply`);
    const errs = liveWorkflowErrors(y);
    assert.ok(errs.some((e) => expected.test(e)), `${name}: ${JSON.stringify(errs)}`);
  });
}
