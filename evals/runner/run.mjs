import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { label, HardError } from "./schema.mjs";
import { grade } from "./grader.mjs";
import { loadSuite, validateJoin } from "./cases.mjs";
import { skillHash } from "./hashes.mjs";
import { run as replayRun } from "./adapters/replay.mjs";
import { loadPending } from "./pending.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_EVALS_ROOT = resolve(HERE, "..");
const DEFAULT_SKILLS_ROOT = resolve(HERE, "..", "..", "plugins", "sohopay", "skills");
const DEFAULT_SUITES = { onboard: "sohopay-onboard", x402: "sohopay-x402" };

const BOOLEAN_FLAGS = { "--require-audit": "requireAudit", "--live": "live" };

/** Parse `--flag value` pairs; unknown flags are rejected so typos never silently widen a run. */
export function parseArgs(argv) {
  const out = { adapter: "replay", suite: "all", case: undefined, samples: undefined, requireAudit: false, live: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // Boolean flags: --require-audit (a live sample without a process-tree file audit is an adapter error; also
    // SP6_AUDIT=require) and --live (T17 M4: the explicit opt-in to spawn the real, paid CLI).
    if (Object.hasOwn(BOOLEAN_FLAGS, a)) { out[BOOLEAN_FLAGS[a]] = true; continue; }
    const key = a.startsWith("--") ? a.slice(2) : null;
    if (!key || !Object.hasOwn(out, key) || Object.values(BOOLEAN_FLAGS).includes(key)) throw new HardError(`unknown argument: ${a}`);
    const v = argv[++i];
    if (v === undefined) throw new HardError(`missing value for ${a}`);
    out[key] = v;
  }
  if (!["replay", "claude-code"].includes(out.adapter)) throw new HardError(`unknown adapter: ${out.adapter}`);
  if (out.live && out.adapter !== "claude-code") throw new HardError("--live applies only to --adapter claude-code");
  return out;
}

/** Resolve requested suite names to dirs; only suites with an assertions.json exist (absent ones are skipped for "all"). */
function resolveSuites(suite, suites, evalsRoot) {
  const names = suite === "all" ? Object.keys(suites) : [suite];
  if (suite !== "all" && !(suite in suites)) throw new HardError(`unknown suite: ${suite}`);
  return names.map((n) => suites[n]).filter((dir) => existsSync(join(evalsRoot, dir, "assertions.json")));
}

function listAdversarials(evalsRoot, dir, caseId) {
  const d = join(evalsRoot, dir, "transcripts", "adversarial");
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.startsWith(`${caseId}.`) && f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length));
}

/** One report row; `audit` surfaces the transcript's meta.audit (a golden's file-audit status; null for synthetic). */
function record(caseId, kind, g, expectPass, audit = null) {
  const pass = g.pass === expectPass && !g.hardError;
  return { caseId, kind, pass, findings: g.findings, hardError: g.hardError, audit };
}

/**
 * goldens-pending.json for the replay gate. Validated against every suite dir present under evalsRoot (the default
 * suites plus any requested), so a subset run (live-ci replays one suite) still accepts the full file.
 */
function pendingFor(evalsRoot, suites) {
  try {
    const ids = new Map();
    for (const dir of new Set([...Object.values(DEFAULT_SUITES), ...Object.values(suites)])) {
      if (existsSync(join(evalsRoot, dir, "assertions.json"))) ids.set(dir, new Set(loadSuite(join(evalsRoot, dir)).assertions.keys()));
    }
    return loadPending(evalsRoot, ids);
  } catch (e) { throw e instanceof HardError ? e : new HardError(e.message); }
}

function runReplaySuite(dir, ctx) {
  const { evalsRoot, skillsRoot, waivers, caseFilter, pending } = ctx;
  const { cases, assertions } = loadSuite(join(evalsRoot, dir));
  const joinErrs = validateJoin(cases, assertions);
  if (joinErrs.length) return [{ caseId: dir, kind: "suite", pass: false, findings: joinErrs, hardError: `invalid suite ${dir}` }];
  const skillHashFor = () => skillHash(join(skillsRoot, dir, "SKILL.md"), skillsRoot);
  const results = [];
  for (const [id, assertion] of assertions) {
    if (caseFilter && caseFilter !== id) continue;
    // A listed case with no golden yet is reported, not failed; once its golden exists it is graded like any other.
    const goldenPending = pending.get(dir)?.has(id) && !existsSync(join(evalsRoot, dir, "transcripts", `${id}.json`));
    if (goldenPending) results.push({ caseId: id, kind: "golden", pass: true, pending: true, findings: [], hardError: null, audit: null });
    const refs = [
      ...(goldenPending ? [] : [{ kind: "golden", name: id, expectPass: true }]),
      ...listAdversarials(evalsRoot, dir, id).map((name) => ({ kind: "adversarial", name, expectPass: false })),
    ];
    for (const r of refs) {
      const rec = (() => {
        try {
          const t = replayRun({ suite: dir, caseId: id, kind: r.kind, name: r.name }, { rootDir: evalsRoot, skillHashFor });
          return record(id, r.kind, grade(label(t), assertion, waivers), r.expectPass, t.meta.audit ?? null);
        } catch (e) {
          if (e instanceof HardError) return { caseId: id, kind: r.kind, pass: false, findings: [], hardError: e.message, audit: null };
          throw e;
        }
      })();
      results.push(rec);
    }
  }
  return results;
}

/**
 * CLI entry. Returns `{ report, code }` so it is testable without spawning a process.
 * @param {string[]} argv flags only (no node/script prefix)
 * @param {{evalsRoot?:string, skillsRoot?:string, suites?:Record<string,string>, silent?:boolean, liveSampleRunner?:Function}} [opts]
 */
export async function main(argv, opts = {}) {
  const evalsRoot = opts.evalsRoot ?? DEFAULT_EVALS_ROOT;
  const skillsRoot = opts.skillsRoot ?? DEFAULT_SKILLS_ROOT;
  const args = parseArgs(argv);
  const dirs = resolveSuites(args.suite, opts.suites ?? DEFAULT_SUITES, evalsRoot);
  const waivers = JSON.parse(readFileSync(join(DEFAULT_EVALS_ROOT, "floor-waivers.json"), "utf8")).waivers;
  let cases = [];
  if (args.adapter === "replay") {
    const pending = pendingFor(evalsRoot, opts.suites ?? DEFAULT_SUITES);
    for (const dir of dirs) cases.push(...runReplaySuite(dir, { evalsRoot, skillsRoot, waivers, caseFilter: args.case, pending }));
  } else {
    // Loaded lazily: the live adapter must never be reachable from the static import graph.
    const live = await import("./adapters/claude-code.mjs");
    // M4 / m4: `live` (from --live only) is the adapter's sole permission to spawn a real CLI — an in-process option,
    // never an environment variable, so nothing inherited from the operator's shell can grant it.
    // opts.liveSampleRunner: a JS-only injection for tests of the sample loop; the CLI below never passes one.
    cases = await live.runSuites({ dirs, evalsRoot, skillsRoot, waivers, caseFilter: args.case, samples: args.samples && Number(args.samples), requireAudit: args.requireAudit, live: args.live, ...(opts.liveSampleRunner ? { runSample: opts.liveSampleRunner } : {}) });
  }
  const failed = cases.filter((c) => !c.pass).length;
  const report = {
    total: cases.length,
    passed: cases.length - failed,
    failed,
    hardErrors: cases.filter((c) => c.hardError).length,
    pending: cases.filter((c) => c.pending).length,
    cases,
  };
  if (!opts.silent) console.log(JSON.stringify(report, null, 2));
  return { report, code: failed > 0 || report.hardErrors > 0 ? 1 : 0 };
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  main(process.argv.slice(2)).then(
    ({ code }) => process.exit(code),
    (e) => { console.error(e.message); process.exit(2); },
  );
}
