import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { label, HardError } from "./schema.mjs";
import { grade } from "./grader.mjs";
import { loadSuite, validateJoin } from "./cases.mjs";
import { skillHash } from "./hashes.mjs";
import { run as replayRun } from "./adapters/replay.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_EVALS_ROOT = resolve(HERE, "..");
const DEFAULT_SKILLS_ROOT = resolve(HERE, "..", "..", "plugins", "sohopay", "skills");
const DEFAULT_SUITES = { onboard: "sohopay-onboard", x402: "sohopay-x402" };

/** Parse `--flag value` pairs; unknown flags are rejected so typos never silently widen a run. */
function parseArgs(argv) {
  const out = { adapter: "replay", suite: "all", case: undefined, samples: undefined, requireAudit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // Boolean flag: a live sample without a process-tree file audit is an adapter error (CI live mode; also SP6_AUDIT=require).
    if (a === "--require-audit") { out.requireAudit = true; continue; }
    const key = a.startsWith("--") ? a.slice(2) : null;
    if (!key || !(key in out) || key === "requireAudit") throw new HardError(`unknown argument: ${a}`);
    const v = argv[++i];
    if (v === undefined) throw new HardError(`missing value for ${a}`);
    out[key] = v;
  }
  if (!["replay", "claude-code"].includes(out.adapter)) throw new HardError(`unknown adapter: ${out.adapter}`);
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

function runReplaySuite(dir, ctx) {
  const { evalsRoot, skillsRoot, waivers, caseFilter } = ctx;
  const { cases, assertions } = loadSuite(join(evalsRoot, dir));
  const joinErrs = validateJoin(cases, assertions);
  if (joinErrs.length) return [{ caseId: dir, kind: "suite", pass: false, findings: joinErrs, hardError: `invalid suite ${dir}` }];
  const skillHashFor = () => skillHash(join(skillsRoot, dir, "SKILL.md"), skillsRoot);
  const results = [];
  for (const [id, assertion] of assertions) {
    if (caseFilter && caseFilter !== id) continue;
    const refs = [
      { kind: "golden", name: id, expectPass: true },
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
    for (const dir of dirs) cases.push(...runReplaySuite(dir, { evalsRoot, skillsRoot, waivers, caseFilter: args.case }));
  } else {
    // Loaded lazily: the live adapter must never be reachable from the static import graph.
    const live = await import("./adapters/claude-code.mjs");
    // opts.liveSampleRunner: a JS-only injection for tests of the sample loop; the CLI below never passes one.
    cases = await live.runSuites({ dirs, evalsRoot, skillsRoot, waivers, caseFilter: args.case, samples: args.samples && Number(args.samples), requireAudit: args.requireAudit, ...(opts.liveSampleRunner ? { runSample: opts.liveSampleRunner } : {}) });
  }
  const failed = cases.filter((c) => !c.pass).length;
  const report = {
    total: cases.length,
    passed: cases.length - failed,
    failed,
    hardErrors: cases.filter((c) => c.hardError).length,
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
