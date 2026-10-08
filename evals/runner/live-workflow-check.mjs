// INV-sp6-live-workflow: static safety properties of .github/workflows/evals-live.yml, checked without a YAML library
// (zero-dep repo) by a minimal indentation-aware reader. The workflow cannot run locally, so these are the guard:
// shared by evals-live-workflow.test.mjs (runner glob) and scripts/validate-skills.mjs (npm run validate).
import { PINS } from "./adapters/cc-guards.mjs";

export const LIVE_LABEL = "run-live-evals";
export const CONCURRENCY_PREFIX = "sp6-live-${{ github.event.pull_request.number || github.ref }}";
export const FORK_EXPR = "github.event.pull_request.head.repo.full_name != github.repository";

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
export function liveWorkflowErrors(text) {
  const errs = [];
  const { clean, raw, top, jobs } = readWorkflow(text);
  const no = (m) => errs.push(m);

  // 1. Triggers: workflow_dispatch + pull_request [labeled, synchronize] only; never pull_request_target.
  if (/pull_request_target/.test(clean)) no("pull_request_target is forbidden (it runs PR code with secrets)");
  const on = get(top, "on");
  const triggers = on ? blocks(on.body, 2).map((b) => b.key).sort() : [];
  if (JSON.stringify(triggers) !== JSON.stringify(["pull_request", "workflow_dispatch"])) no(`triggers must be exactly workflow_dispatch + pull_request, got ${JSON.stringify(triggers)}`);
  const pr = on && get(blocks(on.body, 2), "pull_request");
  const types = pr && get(blocks(pr.body, 4), "types");
  if (!types || types.value.replace(/\s/g, "") !== "[labeled,synchronize]") no("pull_request types must be [labeled, synchronize]");

  // 2. Top-level permissions: {} and the per-PR concurrency group.
  if (get(top, "permissions")?.value !== "{}") no("top-level permissions must be {}");
  const conc = get(top, "concurrency");
  const ck = conc ? blocks(conc.body, 2) : [];
  if (!get(ck, "group")?.value.startsWith(CONCURRENCY_PREFIX)) no(`concurrency group must start with ${CONCURRENCY_PREFIX}`);
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
    if (!/node evals\/runner\/run\.mjs "\$\{args\[@\]\}"|node evals\/runner\/run\.mjs --adapter claude-code/.test(runJob.text) || !/--adapter claude-code --suite all --samples/.test(runJob.text)) no(`job ${runJob.id} must run run.mjs --adapter claude-code --suite all --samples K`);
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
  return errs;
}
