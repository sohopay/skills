// INV-sp6-live-workflow: static safety properties of .github/workflows/evals-live.yml, checked without a YAML library
// (zero-dep repo) by a minimal indentation-aware reader. The workflow cannot run locally, so these are the guard:
// shared by evals-live-workflow.test.mjs (runner glob) and scripts/validate-skills.mjs (npm run validate).
// Two layers (T17 fix round 1, I2): a HASH PIN (evals/live-workflow.sha256 — any edit must update it, and CODEOWNERS
// reviews both files), then semantic rules as a tripwire. A line reader has false negatives; the pin has none.
// Neither is a security boundary on its own: `pull_request` runs the PR's own copy of the workflow.
import { createHash } from "node:crypto";
import { PINS } from "./adapters/cc-guards.mjs";

export const LIVE_LABEL = "run-live-evals";
export const CONCURRENCY_PREFIX = "sp6-live-${{ github.event.pull_request.number || github.ref }}";
export const NOOP_CLAUSE = "${{ github.event_name == 'pull_request' && (!contains(github.event.pull_request.labels.*.name, 'run-live-evals') || (github.event.action == 'labeled' && github.event.label.name != 'run-live-evals')) && format('-noop-{0}', github.run_id) || '' }}";
export const FORK_EXPR = "github.event.pull_request.head.repo.full_name != github.repository";
/** The fork step's exact `if:` — anything else (`false && …`, `always() || …`) weakens the refusal. */
export const FORK_STEP_IF = `github.event_name == 'pull_request' && ${FORK_EXPR}`;
/** The regen job's golden-path allowlist line (only transcripts of the two live suites, never adversarials). */
export const REGEN_PATH_GUARD = `[[ "$p" =~ ^evals/sohopay-(onboard|x402)/transcripts/[a-z0-9][a-z0-9-]*\\.json$ ]]`;
export const PUSH_LINE = 'git push origin "HEAD:refs/heads/${HEAD_REF}"';
const ARTIFACT_PATHS = ["${{ runner.temp }}/sp6-live", "${{ runner.temp }}/sp6-verdict"];

/**
 * null when the workflow's raw BYTES hash to the committed pin (sha256sum format: `<hex>  <path>`), else the INV failure.
 * m8: bytes only — a decoded string would map distinct invalid UTF-8 sequences to the same U+FFFD text.
 */
export function livePinError(bytes, pinText) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError("livePinError hashes the workflow's raw bytes: pass the Buffer from readFileSync(path)");
  const want = /^([0-9a-f]{64})\b/.exec(String(pinText ?? "").trim())?.[1];
  if (!want) return "INV-sp6-live-workflow: evals/live-workflow.sha256 holds no sha256 pin";
  const got = createHash("sha256").update(bytes).digest("hex");
  return got === want ? null : `INV-sp6-live-workflow: .github/workflows/evals-live.yml sha256 ${got} != pinned ${want} (evals/live-workflow.sha256): update the pin in the same change — CODEOWNERS reviews both`;
}

/** Drop full-line comments and trailing ` # ...` comments (outside quotes, roughly); keep line numbers. */
export function stripComments(text) {
  return text.split("\n").map((l) => {
    if (/^\s*#/.test(l)) return "";
    let q = null;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (q) { if (c === q) q = null; continue; }
      if (c === "'" || c === '"') q = c;
      else if (c === "#" && i > 0 && /\s/.test(l[i - 1])) return l.slice(0, i).trimEnd();
    }
    return l;
  }).join("\n");
}

const indentOf = (l) => l.length - l.trimStart().length;

/** Child blocks of the mapping at `indent` inside `lines`: [{key, value, body: string[]}] (body = deeper lines). */
export function blocks(lines, indent) {
  const out = [];
  for (const l of lines) {
    if (!l.trim()) { if (out.length) out.at(-1).body.push(l); continue; }
    const m = indentOf(l) === indent && /^\s*([A-Za-z0-9_-]+):(?:\s+(.*))?$/.exec(l);
    if (m) out.push({ key: m[1], value: (m[2] ?? "").trim(), body: [] });
    else if (out.length && indentOf(l) > indent) out.at(-1).body.push(l);
  }
  return out;
}
const get = (bs, key) => bs.find((b) => b.key === key);
const blockText = (b) => (b ? `${b.value}\n${b.body.join("\n")}` : "");

/** The steps of a job: [{id, name, if, run, text, keys}] (`run` = the script body, or undefined for a `uses:` step). */
export function stepsOf(job) {
  const st = get(job.keys, "steps");
  if (!st) return [];
  const items = [];
  for (const l of st.body) {
    if (/^ {6}- /.test(l)) items.push([l.replace(/^ {6}- /, "        ")]);
    else if (items.length) items.at(-1).push(l);
  }
  return items.map((lines) => {
    const keys = blocks(lines, 8);
    const run = get(keys, "run");
    return { keys, text: lines.join("\n"), id: get(keys, "id")?.value, name: get(keys, "name")?.value, if: get(keys, "if") ? blockText(get(keys, "if")).trim() : undefined, run: run ? blockText(run) : undefined };
  });
}

/** Parse the workflow into {top, on, jobs:[{id, keys, text}]}; raw comment-free text kept for content checks. */
export function readWorkflow(text) {
  const clean = stripComments(text);
  const lines = clean.split("\n");
  const top = blocks(lines, 0);
  const jobsBlock = get(top, "jobs");
  const jobs = (jobsBlock ? blocks(jobsBlock.body, 2) : []).map((j) => ({ id: j.key, keys: blocks(j.body, 4), text: j.body.join("\n") }));
  return { clean, raw: text, top, jobs };
}

/** Every rule the T17 rulings fix; returns human-readable violations (empty = OK). */
/**
 * Plain (unquoted) YAML values whose `${{ }}` expression holds " #": YAML ends the value at the comment, GitHub sees an
 * unterminated expression and rejects the whole file (every trigger dead; each push shows a failed zero-job run).
 * Checked on the original text, before any comment stripping.
 */
export function unquotedHashErrors(text) {
  const errs = [];
  text.split("\n").forEach((line, n) => {
    const m = /^\s*(?:-\s+)?[\w.-]+:\s+(?!["'|>])(.*)$/.exec(line);
    if (!m) return;
    for (const e of m[1].matchAll(/\$\{\{(.*?)(?:\}\}|$)/g)) {
      if (/\s#/.test(e[1])) errs.push(`line ${n + 1}: unquoted value holds " #" inside \${{ }} — YAML reads it as a comment and the workflow fails to parse; quote the value`);
    }
  });
  return errs;
}

export function liveWorkflowErrors(text) {
  const errs = [];
  const { clean, raw, top, jobs } = readWorkflow(text);
  const no = (m) => errs.push(m);

  // 0. The file must parse as GitHub reads it (a " #" in an unquoted expression silently truncates it).
  for (const e of unquotedHashErrors(text)) no(e);

  // 1. Triggers: workflow_dispatch + pull_request [labeled] only — every live run spends once, on an explicit label or
  //    dispatch (no synchronize / opened / reopened, and never the type-less default); never pull_request_target.
  if (/pull_request_target/.test(clean)) no("pull_request_target is forbidden (it runs PR code with secrets)");
  const on = get(top, "on");
  const triggers = on ? blocks(on.body, 2).map((b) => b.key).sort() : [];
  if (JSON.stringify(triggers) !== JSON.stringify(["pull_request", "workflow_dispatch"])) no(`triggers must be exactly workflow_dispatch + pull_request, got ${JSON.stringify(triggers)}`);
  const pr = on && get(blocks(on.body, 2), "pull_request");
  const types = pr && get(blocks(pr.body, 4), "types");
  if (!types || types.value.replace(/\s/g, "") !== "[labeled]") no(`pull_request types must be exactly [labeled] (got ${types ? types.value : "the default: opened, synchronize, reopened"})`);

  // 2. Top-level permissions: {} and the per-PR concurrency group.
  if (get(top, "permissions")?.value !== "{}") no("top-level permissions must be {}");
  const conc = get(top, "concurrency");
  const ck = conc ? blocks(conc.body, 2) : [];
  const group = get(ck, "group")?.value ?? "";
  if (!group.startsWith(CONCURRENCY_PREFIX)) no(`concurrency group must start with ${CONCURRENCY_PREFIX}`);
  // A PR event that will not run (label absent, or a different label added) gets its own group, so it can never cancel
  // a live run in progress.
  if (!group.includes(NOOP_CLAUSE)) no(`concurrency group must give no-op PR events a unique -noop- suffix (${NOOP_CLAUSE})`);
  if (get(ck, "cancel-in-progress")?.value !== "true") no("concurrency cancel-in-progress must be true");

  // 3. The first job is the fork gate: no environment, no secrets, permissions {}, refuses a fork PR, label-gated.
  const [gate, ...rest] = jobs;
  if (!gate) { no("no jobs"); return errs; }
  if (get(gate.keys, "environment")) no(`first job ${gate.id} must not load an environment`);
  if (/secrets\./.test(gate.text)) no(`first job ${gate.id} must not reference secrets`);
  if (get(gate.keys, "permissions")?.value !== "{}") no(`first job ${gate.id} must have permissions: {}`);
  if (!gate.text.includes(FORK_EXPR) || !/exit 1/.test(gate.text)) no(`first job ${gate.id} must refuse a fork PR (${FORK_EXPR} → exit 1)`);
  const gateIf = get(gate.keys, "if");
  if (!gateIf || !`${gateIf.value}\n${gateIf.body.join("\n")}`.includes(`contains(github.event.pull_request.labels.*.name, '${LIVE_LABEL}')`)) no(`first job ${gate.id} must gate PR runs on the ${LIVE_LABEL} label being present`);
  for (const j of rest) {
    const needs = get(j.keys, "needs")?.value ?? "";
    if (!new RegExp(`(^|[\\[,\\s])${gate.id}([\\],\\s]|$)`).test(needs)) no(`job ${j.id} must need the gate job ${gate.id}`);
  }

  // 4. Environment + secret only on the run job; least privilege everywhere.
  const withEnv = jobs.filter((j) => get(j.keys, "environment"));
  if (withEnv.length !== 1) no(`exactly one job may load the protected environment, got ${withEnv.map((j) => j.id)}`);
  const runJob = withEnv[0];
  for (const j of jobs) {
    if (j !== runJob && /ANTHROPIC_API_KEY/.test(j.text)) no(`job ${j.id} references ANTHROPIC_API_KEY outside the environment job`);
    const perms = get(j.keys, "permissions");
    if (!perms) { no(`job ${j.id} must declare permissions`); continue; }
    if (/write-all|read-all/.test(perms.value)) no(`job ${j.id}: ${perms.value} is not least privilege`);
    const grants = Object.fromEntries(blocks(perms.body, 6).map((b) => [b.key, b.value]));
    const writes = Object.entries(grants).filter(([, v]) => v === "write").map(([k]) => k);
    if (writes.length > 1) no(`job ${j.id} holds more than one write permission (${writes})`);
    if (writes.length && j === runJob) no(`the environment job ${j.id} must not hold a write permission`);
    if (writes.some((w) => !["issues", "contents"].includes(w))) no(`job ${j.id}: unexpected write permission ${writes}`);
    if (writes.includes("contents") && !/refs\/heads\/\$\{HEAD_REF\}/.test(j.text)) no(`job ${j.id} has contents: write but does not push to the PR head ref`);
  }
  if (runJob) {
    const grants = Object.fromEntries(blocks(get(runJob.keys, "permissions")?.body ?? [], 6).map((b) => [b.key, b.value]));
    if (JSON.stringify(grants) !== JSON.stringify({ contents: "read" })) no(`environment job ${runJob.id} permissions must be exactly contents: read`);
    if (!/secrets\.ANTHROPIC_API_KEY/.test(runJob.text)) no(`environment job ${runJob.id} must take ANTHROPIC_API_KEY from the environment's secrets`);
    if (!/SP6_REQUIRE_SANDBOX:\s*"1"/.test(runJob.text)) no(`job ${runJob.id} must set SP6_REQUIRE_SANDBOX: "1"`);
    if (!/SP6_AUDIT:\s*require/.test(runJob.text) && !/--require-audit/.test(runJob.text)) no(`job ${runJob.id} must require the file audit (SP6_AUDIT: require / --require-audit)`);
    const bases = [...runJob.text.matchAll(/SP6_RUN_ROOT_BASE:[ \t]*([^\n]+)/g)].map((m) => m[1].trim());
    if (!bases.length || bases.some((b) => !/^\$\{\{\s*runner\.temp\s*\}\}\/[\w-]+$/.test(b))) no(`job ${runJob.id} must put every SP6_RUN_ROOT_BASE under runner.temp (got ${JSON.stringify(bases)})`);
    if (!/node evals\/runner\/run\.mjs "\$\{args\[@\]\}"/.test(runJob.text) || !/--adapter claude-code --live --suite all --samples/.test(runJob.text)) no(`job ${runJob.id} must run run.mjs --adapter claude-code --live --suite all --samples K (M4: --live is the only spawn switch)`);
    if (!/apt-get install[^\n]*bubblewrap[^\n]*strace|apt-get install[^\n]*strace[^\n]*bubblewrap/.test(runJob.text)) no(`job ${runJob.id} must install bubblewrap and strace`);
    const cli = /CLAUDE_CODE_VERSION:\s*"([^"]+)"/.exec(runJob.text)?.[1];
    if (cli !== PINS.CLI_VERSION) no(`CLAUDE_CODE_VERSION ${cli} != PINS.CLI_VERSION ${PINS.CLI_VERSION}`);
    const cap = /SP6_LIVE_BUDGET_USD:\s*"([^"]+)"/.exec(runJob.text)?.[1];
    if (Number(cap) !== PINS.BUDGET_USD) no(`SP6_LIVE_BUDGET_USD ${cap} != PINS.BUDGET_USD ${PINS.BUDGET_USD}`);
  }

  // 5. Every action pinned by a full commit SHA, with its version in a comment.
  for (const l of raw.split("\n")) {
    const m = /^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/.exec(l);
    if (!m || /^\s*#/.test(l)) continue;
    if (!/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(m[1])) no(`action not pinned by full commit SHA: ${m[1]}`);
    else if (!/#\s*v\d/.test(m[2])) no(`pinned action ${m[1]} lacks a "# vX.Y.Z" version comment`);
  }
  for (const m of raw.matchAll(/retention-days:\s*(\d+)/g)) if (Number(m[1]) > 14) no(`artifact retention ${m[1]} days is not short`);

  // 6. Never push to develop/main; pushes only to the PR head ref, behind an explicit develop|main refusal.
  if (/git push[^\n]*\b(develop|main)\b/.test(clean) || /refs\/heads\/(develop|main)\b/.test(clean)) no("a push to develop/main is forbidden");
  for (const m of clean.matchAll(/git push[^\n]*/g)) if (!/HEAD:refs\/heads\/\$\{HEAD_REF\}"?$/.test(m[0].trim())) no(`unexpected push: ${m[0].trim()}`);
  if (/git push/.test(clean) && !/develop\|main\)/.test(clean)) no("the pushing job must refuse develop|main head refs");
  if (/Co-Authored-By|Generated with/i.test(clean)) no("no attribution trailer in workflow commits");

  injectionAndScopeRules({ top, jobs, gate, runJob, clean }, no);
  if (runJob) runJobRules(runJob, no);
  writeJobRules(jobs, no);
  roundTwoRules({ jobs, gate, runJob, clean }, no);
  return errs;
}

/** Free-text event data an attacker can set (titles, bodies, comments, branch names, commit messages). */
const EVENT_TEXT = /github\.event\.(?:pull_request\.(?:title|body|head\.ref|head\.label)|issue\.|comment\.|review\.|head_commit\.|commits)|github\.head_ref|toJSON\(\s*github\.event/;
const STATUS_FN = /always\(\)|cancelled\(\)|failure\(\)/;

/** T17 fix round 2 (m1): status functions, HEAD_REF provenance, script injection outside run:, eval, continue-on-error, event data to GITHUB_*. */
function roundTwoRules({ jobs, gate, runJob, clean }, no) {
  for (const j of [gate, runJob].filter(Boolean)) {
    if (STATUS_FN.test(blockText(get(j.keys, "if")))) no(`job ${j.id} if: uses a status function (always() / cancelled() / failure()), which runs it whatever its needs did`);
  }
  for (const m of clean.matchAll(/^\s*HEAD_REF:[ \t]*([^\n]*)$/gm)) {
    if (m[1].trim() !== "${{ github.event.pull_request.head.ref }}") no(`HEAD_REF must come from \${{ github.event.pull_request.head.ref }} (got ${m[1].trim()})`);
  }
  if (/continue-on-error/.test(clean)) no("continue-on-error is forbidden (it turns the gate, fork refusal or egress scan into advice)");
  if (/toJSON\(\s*github\.event/.test(clean)) no("toJSON(github.event…) is forbidden (it carries attacker text)");
  for (const j of jobs) {
    for (const s of stepsOf(j)) {
      const label = `job ${j.id} step ${s.id ?? s.name ?? "?"}`;
      const w = get(s.keys, "with");
      const script = w && get(blocks(w.body, 10), "script");
      if (script && /\$\{\{/.test(blockText(script))) no(`${label}: \${{ }} in a with: script: body (github-script injection)`);
      const run = s.run ?? "";
      if (/(^|[\s;&|(])eval\s/.test(run) || /\b(?:ba|z|da)?sh\s+-c\s+["']?\$/.test(run)) no(`${label}: eval / sh -c "$VAR" in a run: body (re-parses data as code)`);
      if (/GITHUB_ENV|GITHUB_PATH/.test(run)) no(`${label}: writes GITHUB_ENV / GITHUB_PATH (poisons every later step)`);
      if (/GITHUB_OUTPUT/.test(run) && EVENT_TEXT.test(blockText(get(s.keys, "env")))) no(`${label}: writes GITHUB_OUTPUT from a step holding event text in its env`);
    }
  }
  // m2 (defence in depth beyond the exact push-line check): any push — `git push`, `git -c … push` — and any forced
  // refspec or push config in a contents: write job is refused, even when the literal push line is the allowed one.
  for (const j of jobs) {
    const grants = Object.fromEntries(blocks(get(j.keys, "permissions")?.body ?? [], 6).map((b) => [b.key, b.value]));
    if (grants.contents !== "write") continue;
    const runs = stepsOf(j).map((s) => s.run ?? "").join("\n");
    if (/--force|(^|\s)-f(\s|$)|["'\s]\+(?:HEAD|refs\/)|remote\.[\w.-]+\.push|push\.(?:default|followTags)/m.test(runs)) no(`job ${j.id}: force push / forced refspec / push config is forbidden`);
    for (const m of runs.matchAll(/^\s*git\b[^\n]*\bpush\b[^\n]*$/gm)) if (m[0].trim() !== PUSH_LINE) no(`job ${j.id}: unexpected push ${m[0].trim()} (only ${PUSH_LINE})`);
  }
}

/** I2 (review): script injection, flow-style permissions, secrets scope, the fork / label gate's exact form. */
function injectionAndScopeRules({ top, jobs, gate, runJob, clean }, no) {
  for (const j of jobs) {
    for (const s of stepsOf(j)) if (s.run !== undefined && /\$\{\{/.test(s.run)) no(`job ${j.id} step ${s.id ?? s.name ?? "?"}: \${{ }} expression inside a run: body (script injection) — pass it through env:`);
    const perms = get(j.keys, "permissions");
    if (perms && perms.value.startsWith("{") && perms.value.replace(/\s/g, "") !== "{}") no(`job ${j.id}: flow-style permissions ${perms.value} (only {} is allowed inline)`);
    if (/secrets\./.test(blockText(get(j.keys, "env")))) no(`job ${j.id}: secrets in job-level env (they reach every step, including the PR-code test step)`);
  }
  const topPerms = get(top, "permissions");
  if (topPerms && topPerms.value.startsWith("{") && topPerms.value.replace(/\s/g, "") !== "{}") no(`top-level flow-style permissions ${topPerms.value}`);
  if (/secrets\./.test(blockText(get(top, "env")))) no("secrets in workflow-level env");
  if (/secrets:\s*inherit/.test(clean)) no("secrets: inherit is forbidden (it hands every secret to a called workflow)");
  if (runJob) {
    const keyed = stepsOf(runJob).filter((s) => /ANTHROPIC_API_KEY/.test(s.text)).map((s) => s.id);
    if (JSON.stringify(keyed) !== JSON.stringify(["run", "egress"])) no(`ANTHROPIC_API_KEY outside the run / egress steps (in ${JSON.stringify(keyed)})`);
  }
  const gateIf = blockText(get(gate.keys, "if"));
  if (/\bfalse\b|\btrue\s*\|\||\|\|\s*true\b|always\(\)/.test(gateIf)) no(`gate job ${gate.id} if: is short-circuited (false / true || / always())`);
  const fork = stepsOf(gate).find((s) => s.if === FORK_STEP_IF);
  if (!fork || !/(^|\n)\s*exit 1\b/.test(fork.run ?? "")) no(`the gate's fork step must be exactly \`if: ${FORK_STEP_IF}\` with an exit 1 in that step`);
}

/** C1 / I1 / M2 / M4 on the environment job: spec reporter, --live, live-step timeout, egress before every upload. */
function runJobRules(runJob, no) {
  const steps = stepsOf(runJob);
  if (!/node --test --test-reporter=spec /.test(runJob.text)) no(`job ${runJob.id}: the pre-flight tests must force --test-reporter=spec (Node 22 prints TAP when piped)`);
  const checkout = steps.find((s) => /actions\/checkout@/.test(s.text));
  if (!checkout || !/persist-credentials:\s*false/.test(checkout.text)) no(`job ${runJob.id}: the live checkout must set persist-credentials: false`);
  if (checkout && /\btoken:/.test(checkout.text)) no(`job ${runJob.id}: the live checkout must carry no token:`);
  const run = steps.find((s) => s.id === "run");
  const stepT = Number(/timeout-minutes:\s*(\d+)/.exec(run?.text ?? "")?.[1]);
  const jobT = Number(get(runJob.keys, "timeout-minutes")?.value);
  if (!(stepT > 0 && jobT > 0 && stepT <= jobT - 15)) no(`job ${runJob.id}: the live step needs its own step timeout at least 15 min below the job's (got step ${stepT}, job ${jobT})`);
  const verdict = steps.find((s) => s.id === "verdict");
  if (!verdict || verdict.if !== "${{ always() }}") no(`job ${runJob.id}: the verdict step must run if: \${{ always() }} (M2)`);
  const ids = steps.map((s) => s.id ?? s.name);
  const egress = steps.find((s) => s.id === "egress");
  const uploads = steps.filter((s) => /actions\/upload-artifact@/.test(s.text));
  if (!egress || egress.if !== "${{ always() }}" || !/grep -rqF -e "\$ANTHROPIC_API_KEY"/.test(egress.run ?? "") || !/rm -rf "\$\{dirs\[@\]\}"/.test(egress.run ?? "")) no(`job ${runJob.id}: an always() egress scan step (id egress) must grep for the key and quarantine on a hit`);
  else if (!(ids.indexOf("verdict") < ids.indexOf("egress") && uploads.every((u) => steps.indexOf(u) > steps.indexOf(egress)))) no(`job ${runJob.id}: the egress scan must run after the verdict and before every upload`);
  goldenScanRules(runJob, steps, ids, no);
  for (const u of uploads) {
    if (!/steps\.egress\.outcome == 'success'/.test(u.if ?? "")) no(`job ${runJob.id}: upload "${u.name}" must be gated on a clean egress scan`);
    const path = /\n\s*path:[ \t]*([^\n]+)/.exec(u.text)?.[1].trim();
    if (!ARTIFACT_PATHS.includes(path)) no(`job ${runJob.id}: artifact path ${path} is not one of ${ARTIFACT_PATHS.join(", ")}`);
  }
}

export const GOLDEN_SCAN_IF = "${{ always() && steps.verdict.outcome == 'success' }}";
export const GOLDEN_SCAN_LINE = 'node evals/runner/live-ci.mjs --scan-verdict-dir "$RUNNER_TEMP/sp6-verdict" | tee -a "$GITHUB_OUTPUT"';
export const REGEN_OUTPUT = "regen_count: ${{ steps.egress.outcome == 'success' && steps.goldenscan.outcome == 'success' && steps.verdict.outputs.regen_count || '0' }}";
export const SCAN_REJECTS_OUTPUT = "golden_scan_rejects: ${{ steps.egress.outcome == 'success' && steps.goldenscan.outputs.rejects || '0' }}";

/**
 * Final review I1: the staged goldens are re-scanned (committed-secrets) by a fail-closed step after the verdict and
 * before the egress scan; regen acts only on a clean scan, and its rejects open issues.
 */
function goldenScanRules(runJob, steps, ids, no) {
  const scan = steps.find((s) => s.id === "goldenscan");
  const lines = (scan?.run ?? "").split("\n").map((l) => l.trim());
  if (!scan || scan.if !== GOLDEN_SCAN_IF || !lines.includes(GOLDEN_SCAN_LINE) || !lines.includes("set -euo pipefail")) {
    no(`job ${runJob.id}: a golden scan step (id goldenscan, if: ${GOLDEN_SCAN_IF}) must run, fail-closed, \`${GOLDEN_SCAN_LINE}\``);
  } else if (!(ids.indexOf("verdict") < ids.indexOf("goldenscan") && ids.indexOf("goldenscan") < ids.indexOf("egress"))) {
    no(`job ${runJob.id}: the golden scan must run after the verdict and before the egress scan`);
  }
  const text = runJob.text.split("\n").map((l) => l.trim());
  if (!text.includes(REGEN_OUTPUT)) no(`job ${runJob.id}: output regen_count must be gated on a clean egress AND golden scan (steps.goldenscan.outcome == 'success')`);
  if (!text.includes(SCAN_REJECTS_OUTPUT)) no(`job ${runJob.id}: output golden_scan_rejects must come from the golden scan, behind the egress scan`);
}

/** The write-token jobs: issues (no checkout, per-id errors) and regen (git only, exact push, path guard, same-repo). */
function writeJobRules(jobs, no) {
  for (const j of jobs) {
    const grants = Object.fromEntries(blocks(get(j.keys, "permissions")?.body ?? [], 6).map((b) => [b.key, b.value]));
    const ifText = blockText(get(j.keys, "if"));
    if (Object.values(grants).includes("write") && !/needs\.gate\.result == 'success'/.test(ifText)) no(`job ${j.id} holds a write token but its if: lacks needs.gate.result == 'success' (M5)`);
    if (grants.issues === "write") {
      if (/actions\/checkout@/.test(j.text)) no(`job ${j.id} (issues: write) must not check out the repository`);
      if (!ifText.includes("needs.live.outputs.golden_scan_rejects != '0'")) no(`job ${j.id}: its if: must also fire on golden_scan_rejects (a golden refused by the committed-secrets scan opens an issue)`);
      if (stepsOf(j).some((s) => /\bset -[a-z]*e/.test(s.run ?? ""))) no(`job ${j.id}: set -e in the issue loop (one gh failure would skip the remaining case ids)`);
    }
    if (grants.contents === "write") {
      if (!j.text.includes(REGEN_PATH_GUARD)) no(`job ${j.id}: the regen path guard ${REGEN_PATH_GUARD} is missing`);
      if (!ifText.includes("github.event.pull_request.head.repo.full_name == github.repository")) no(`job ${j.id}: its if: must re-check same-repo`);
      if (stepsOf(j).some((s) => /\b(?:npm|npx|node|yarn|pnpm|make|bash \S+\.sh)\b/.test(s.run ?? ""))) no(`job ${j.id} (contents: write) runs PR code — it may run git only`);
      for (const m of j.text.matchAll(/git push[^\n]*/g)) {
        const line = m[0].trim();
        if (/--force|\s-f\b|\s\+|"\+/.test(line)) no(`job ${j.id}: force push forbidden (${line})`);
        else if (line !== PUSH_LINE) no(`job ${j.id}: unexpected push ${line} (only ${PUSH_LINE})`);
      }
    }
  }
}
