// The live workflow's verdict step (.github/workflows/evals-live.yml). It reads a live run.mjs report plus the per-sample
// transcripts (SP6_LIVE_OUT_DIR) and derives:
//   * safety regressions: every `class: safety` case with a GRADED failure (findings) in any sample → one issue body per
//     case id, carrying the case id, the failing samples, their findings and a run link — never transcript content;
//   * golden regeneration candidates: sample 0 of a case whose k samples ALL passed with no adapter error, that
//     satisfies INV-sp6-golden-audit and that replays green against the checked-out skills. Only when regeneration is
//     allowed (a same-repo pull_request run); the workflow's regen job commits them onto the PR head branch.
// Adapter errors (hardError: capture gaps, budget not-run, audit refusals) are not safety regressions; they block regen.
// No GitHub calls here: the workflow owns GITHUB_TOKEN. Never imported by run.mjs (replay import graph stays clean).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSuite } from "./cases.mjs";
import { goldenAuditError } from "./golden.mjs";
import { main as runMain } from "./run.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
const MAX_FINDING = 500;
const MAX_FINDINGS_PER_SAMPLE = 20;

/** One finding message made inert for a markdown table cell inside a code span (bounded, no mention pings). */
export function escapeFinding(s) {
  const flat = String(s ?? "").replace(/[`|]/g, "'").replace(/[\r\n\t]+/g, " ").replace(/@/g, "@​");
  return flat.length > MAX_FINDING ? `${flat.slice(0, MAX_FINDING)}...` : flat;
}

/** caseId → {suite, class} over the given suite dirs; a duplicate id across suites is refused (issues are per id). */
function caseIndex(evalsRoot, suites) {
  const idx = new Map();
  for (const suite of suites) {
    if (!SAFE_ID.test(suite)) throw new Error(`live-ci: unsafe suite dir ${JSON.stringify(suite)}`);
    for (const [id, a] of loadSuite(join(evalsRoot, suite)).assertions) {
      if (!SAFE_ID.test(id)) throw new Error(`live-ci: unsafe case id ${JSON.stringify(id)}`);
      if (idx.has(id)) throw new Error(`live-ci: case id ${id} appears in ${idx.get(id).suite} and ${suite}`);
      idx.set(id, { suite, class: a.class });
    }
  }
  return idx;
}

/** Does the staged golden replay green (golden row passes) against the checked-out skills? null or the reason. */
async function replayError(evalsRoot, skillsRoot, suite, caseId, candidate) {
  const dest = join(evalsRoot, suite, "transcripts", `${caseId}.json`);
  const prior = existsSync(dest) ? readFileSync(dest) : null;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(candidate, dest);
  let ok = false;
  try {
    const { report } = await runMain(["--adapter", "replay", "--suite", "s", "--case", caseId], { evalsRoot, skillsRoot, suites: { s: suite }, silent: true });
    const g = report.cases.find((c) => c.kind === "golden");
    ok = Boolean(g?.pass);
    return ok ? null : `replay of the candidate golden failed (${g?.hardError ?? JSON.stringify(g?.findings ?? "no golden row")})`;
  } finally {
    // The candidate stays in the (ephemeral) workspace only when it replays green; otherwise restore what was there.
    if (!ok) { if (prior) writeFileSync(dest, prior); else rmSync(dest, { force: true }); }
  }
}

/** Is this live sample-0 transcript acceptable as a golden? null or the reason. */
function candidateError(file, caseId) {
  if (!existsSync(file)) return `no saved transcript for sample 0 (${file})`;
  let t;
  try { t = JSON.parse(readFileSync(file, "utf8")); } catch (e) { return `sample 0 transcript is not JSON (${e.message})`; }
  if (t?.meta?.adapter !== "claude-code") return `sample 0 adapter is ${JSON.stringify(t?.meta?.adapter)}, not claude-code`;
  if (t.meta.sample_index !== 0) return `sample 0 transcript has sample_index ${JSON.stringify(t.meta.sample_index)}`;
  if (t.case_id !== undefined && t.case_id !== caseId) return `sample 0 transcript is for ${t.case_id}`;
  return goldenAuditError(t);
}

/**
 * @param {{cases: object[]}} report  run.mjs live report
 * @param {{evalsRoot:string, skillsRoot:string, liveDir:string, suites:string[], samples:number, allowRegen:boolean}} o
 * @returns {Promise<{safety:object[], regen:object[], skipped:object[], adapterErrors:object[]}>}
 */
export async function liveVerdict(report, { evalsRoot, skillsRoot, liveDir, suites, samples, allowRegen }) {
  const idx = caseIndex(evalsRoot, suites);
  const rows = (report?.cases ?? []).filter((c) => c && c.kind === "live");
  const byCase = new Map();
  for (const r of rows) {
    if (!idx.has(r.caseId)) throw new Error(`live-ci: report names unknown case ${JSON.stringify(r.caseId)}`);
    byCase.set(r.caseId, [...(byCase.get(r.caseId) ?? []), r]);
  }
  const safety = [];
  const regen = [];
  const skipped = [];
  const adapterErrors = rows.filter((r) => r.hardError).map((r) => ({ caseId: r.caseId, sample: r.sample, hardError: escapeFinding(r.hardError) }));
  for (const [caseId, rs] of byCase) {
    const { suite, class: cls } = idx.get(caseId);
    // M1: a safety sample that failed graded (findings) OR ended in an adapter error (the agent may have tripped a
    // fail-closed guard) counts; a `not run: …` row (budget, audit refusal) is not the agent's doing.
    const failing = rs.filter((r) => !r.pass && (r.hardError ? !String(r.hardError).startsWith("not run:") : (r.findings ?? []).length > 0)).sort((a, b) => a.sample - b.sample);
    if (cls === "safety" && failing.length) {
      safety.push({
        caseId, suite,
        samples: failing.map((r) => (r.hardError
          ? { sample: r.sample, kind: "adapter-error", findings: [{ predicate: "adapter-error", message: escapeFinding(r.hardError) }] }
          : { sample: r.sample, kind: "graded", findings: r.findings.slice(0, MAX_FINDINGS_PER_SAMPLE).map((f) => ({ predicate: escapeFinding(f.predicate), message: escapeFinding(f.message) })) })),
      });
    }
    if (!allowRegen) continue;
    const sampleSet = new Set(rs.map((r) => r.sample));
    const allPassed = rs.length === samples && sampleSet.size === samples && rs.every((r) => r.pass && !r.hardError);
    if (!allPassed) { skipped.push({ caseId, reason: `not all ${samples} samples passed (k=${rs.length}, passed ${rs.filter((r) => r.pass && !r.hardError).length})` }); continue; }
    const file = join(liveDir, suite, `${caseId}.s0.json`);
    const why = candidateError(file, caseId) ?? (await replayError(evalsRoot, skillsRoot, suite, caseId, file));
    if (why) { skipped.push({ caseId, reason: why }); continue; }
    regen.push({ caseId, suite, from: file, path: `evals/${suite}/transcripts/${caseId}.json` });
  }
  return { safety, regen, skipped, adapterErrors };
}

/** M3: issue / comment bodies stay well under GitHub's 65,536-char limit. */
export const MAX_ISSUE_BODY = 50_000;
const KIND_LABEL = { graded: "graded", "adapter-error": "adapter error" };

/** Markdown body for the case's `sp6-live-regression` issue (or the comment updating it). Findings only, capped. */
export function issueBody(entry, { runUrl, ref, sha }) {
  const head = [
    `<!-- sp6-live-regression:${entry.caseId} -->`,
    `**SP6 live regression:** safety case \`${entry.caseId}\` (suite \`${entry.suite}\`) failed in ${entry.samples.length} sample(s) of a live run.`,
    "",
    `- Run: ${runUrl}`,
    `- Ref: \`${escapeFinding(ref)}\` @ \`${escapeFinding(sha)}\``,
    "",
    "| Sample | Kind | Findings |",
    "| --- | --- | --- |",
  ].join("\n");
  const foot = "\n\nFindings only: transcripts stay in the run's short-retention artifact (they carry only FAKE-SP6-CANARY values).\n";
  const note = (n) => `\n| … | … | ${n} more sample row(s) truncated: body capped at ${MAX_ISSUE_BODY} chars, see the run |`;
  let body = head;
  for (const [k, s] of entry.samples.entries()) {
    const row = `\n| ${s.sample} | ${KIND_LABEL[s.kind] ?? "graded"} | ${s.findings.map((f) => `\`${f.predicate}\`: \`${f.message}\``).join("<br>") || "(none)"} |`;
    const rest = entry.samples.length - k;
    if (body.length + row.length + note(rest).length + foot.length > MAX_ISSUE_BODY) {
      // Even a single row can be too long: cut it at the cap, then say so.
      const room = MAX_ISSUE_BODY - body.length - note(rest).length - foot.length - 20;
      if (room > 200) body += `${row.slice(0, room)}… |`;
      return `${body}${note(room > 200 ? rest - 1 : rest)}${foot}`;
    }
    body += row;
  }
  return `${body}${foot}`;
}

/** Write the verdict directory the workflow's issue / regen jobs consume; returns GITHUB_OUTPUT lines. */
export function writeVerdict(v, { outDir, runUrl, ref, sha }) {
  mkdirSync(join(outDir, "issues"), { recursive: true });
  for (const e of v.safety) writeFileSync(join(outDir, "issues", `${e.caseId}.md`), issueBody(e, { runUrl, ref, sha }));
  writeFileSync(join(outDir, "issues.json"), `${JSON.stringify(v.safety.map((e) => e.caseId))}\n`);
  for (const r of v.regen) {
    const dest = join(outDir, "regen", r.path);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(r.from, dest);
  }
  writeFileSync(join(outDir, "regen-manifest.txt"), v.regen.map((r) => `${r.path}\n`).join(""));
  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify({ skipped: v.skipped, adapterErrors: v.adapterErrors }, null, 2)}\n`);
  return [`safety_failures=${v.safety.length > 0}`, `safety_cases=${v.safety.length}`, `regen_count=${v.regen.length}`, `adapter_errors=${v.adapterErrors.length}`];
}

/** CLI: node evals/runner/live-ci.mjs --report R --live-dir D --out V --samples K [--allow-regen] (env: RUN_URL, REF, SHA). */
async function cli(argv) {
  const get = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const reportPath = get("--report");
  const liveDir = get("--live-dir");
  const outDir = get("--out");
  const samples = Number(get("--samples"));
  if (!reportPath || !liveDir || !outDir || !Number.isInteger(samples) || samples < 1) throw new Error("usage: live-ci.mjs --report R --live-dir D --out V --samples K [--allow-regen]");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const evalsRoot = resolve(HERE, "..");
  const v = await liveVerdict(report, {
    evalsRoot, skillsRoot: resolve(HERE, "..", "..", "plugins", "sohopay", "skills"), liveDir, suites: ["sohopay-onboard", "sohopay-x402"],
    samples, allowRegen: argv.includes("--allow-regen"),
  });
  const lines = writeVerdict(v, { outDir, runUrl: process.env.RUN_URL ?? "", ref: process.env.REF ?? "", sha: process.env.SHA ?? "" });
  for (const s of v.skipped) console.error(`regen skipped ${s.caseId}: ${s.reason}`);
  for (const e of v.adapterErrors) console.error(`adapter error ${e.caseId} sample ${e.sample}: ${e.hardError}`);
  console.log(lines.join("\n"));
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  cli(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(2); });
}
