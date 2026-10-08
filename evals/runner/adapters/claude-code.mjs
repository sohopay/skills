// Live host adapter: drives the pinned Claude Code CLI headless (`claude -p`) against the localhost mock world and
// turns its session into a graded transcript. Reachable ONLY via `await import()` from run.mjs (isolation.test.mjs).
//
// Per sample: a hermetic world (cc-world.mjs) → hook relay + key-store baseline (cc-relay.mjs) → spawn the CLI in its
// own process group (wrapped in strace where file auditing is available, cc-audit.mjs) → fail-closed checks
// (cc-guards.mjs) → parse the `claude-code/1` capture (cc-parse.mjs) → fetch the backend's in-memory logs over the
// control channel → assemble (cc-assemble.mjs) → validateTranscript → label + grade. Any capture problem is an
// adapter error (HardError), never a graded sample. Spend comes from the CLI's own per-session cost.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HardError, label, validateTranscript } from "../schema.mjs";
import { grade } from "../grader.mjs";
import { loadSuite, validateJoin } from "../cases.mjs";
import { skillHash } from "../hashes.mjs";
import { findOnPath, KEY_REL } from "../../mock/run-config.mjs";
import { snapshotTree } from "../../mock/lib/keystore-snapshot.mjs";
import { argPaths, resolveArgs } from "./cc-paths.mjs";
import { parseSession, parseStream } from "./cc-parse.mjs";
import { assemble } from "./cc-assemble.mjs";
import { assertHermetic, createWorld, writeSettings } from "./cc-world.mjs";
import { parseStrace, probeAudit, straceArgv } from "./cc-audit.mjs";
import { buildPrompt } from "./cc-prompts.mjs";
import { checkInit, DENIED_TOOLS, makeBudget, persistedReader, PINS } from "./cc-guards.mjs";
import { captureErrors, checkHooksApplied, startHookRelay } from "./cc-relay.mjs";

export { checkInit, makeBudget, persistedReader, PINS, captureErrors, startHookRelay };

/** The `claude` the harness PATH resolves (never the agent's PATH). */
export function resolveClaude(pathValue = process.env.PATH ?? "") {
  const [bin] = findOnPath("claude", pathValue);
  if (!bin) throw new HardError("claude-code adapter: no `claude` on PATH");
  return bin;
}

/** Refuse anything but the pinned exact CLI version. */
export function checkCliVersion(bin) {
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 30_000 });
  const v = /^(\d+\.\d+\.\d+)\b/.exec(String(r.stdout ?? "").trim())?.[1] ?? null;
  if (r.status !== 0 || v !== PINS.CLI_VERSION) throw new HardError(`claude-code adapter: CLI version ${v ?? "unknown"} != pinned ${PINS.CLI_VERSION}`);
  return v;
}

/** The exact argv the adapter spawns (documented in task-15-report.md). No token ever appears here. */
export function claudeArgv({ prompt, sessionId, settings, mcpConfig, budgetLeftUsd }) {
  return [
    "-p", prompt,
    "--output-format", "stream-json", "--verbose",
    "--model", PINS.MODEL_ID,
    "--max-turns", String(PINS.MAX_TURNS),
    "--max-budget-usd", String(budgetLeftUsd),
    "--session-id", sessionId,
    "--permission-mode", "dontAsk",
    "--permission-prompts", "none",
    "--settings", settings,
    "--disallowedTools", DENIED_TOOLS.join(","),
    "--mcp-config", mcpConfig,
    "--strict-mcp-config",
  ];
}

const killGroup = (pid, sig) => { try { process.kill(-pid, sig); } catch { /* group already gone */ } };

/**
 * I7: the CLI (or strace wrapping it) leads its own process group. On timeout the whole group gets SIGTERM, then
 * SIGKILL after the grace period; after any exit the group is SIGKILLed so no agent background process outlives the
 * sample.
 */
function spawnCli(argv0, argv, w, { timeoutMs, killGraceMs }) {
  return new Promise((done) => {
    const out = createWriteStream(w.paths.stream, { mode: 0o600 });
    const err = createWriteStream(w.paths.stderr, { mode: 0o600 });
    const child = spawn(argv0, argv, { cwd: w.home, env: w.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    child.stdout.pipe(out);
    child.stderr.pipe(err);
    let timedOut = false;
    let grace = null;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid, "SIGTERM");
      grace = setTimeout(() => killGroup(child.pid, "SIGKILL"), killGraceMs);
    }, timeoutMs);
    const finish = (code, signal, error) => {
      clearTimeout(timer);
      if (grace) clearTimeout(grace);
      if (child.pid) killGroup(child.pid, "SIGKILL");
      Promise.all([new Promise((r) => out.end(r)), new Promise((r) => err.end(r))]).then(() => done({ code, signal, timedOut, error }));
    };
    child.once("error", (e) => finish(null, null, e.message));
    child.once("close", (code, signal) => finish(code, signal, null));
  });
}

function findSessionFile(home, sessionId) {
  const root = join(home, ".claude", "projects");
  if (!existsSync(root)) return null;
  for (const d of readdirSync(root)) { const f = join(root, d, `${sessionId}.jsonl`); if (existsSync(f)) return f; }
  return null;
}

/** Re-resolve every call's path arguments after the run (the TOCTOU third observation; worst-of in cc-assemble). */
function postRunResolve(items, relay, home) {
  const out = new Map();
  for (const c of items.filter((x) => x.kind === "call")) {
    const cwd = c.cwd ?? relay.hooks.get(c.id)?.pre?.cwd ?? home;
    out.set(c.id, resolveArgs(argPaths(c.name, c.input, { cwd, home })));
  }
  return out;
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Parse + check + assemble + validate a finished run (throws HardError on any capture problem). */
async function capture(w, { exit, relay, keyCtx, sessionId, audit, opts, ref, onResult }) {
  const lateDiffs = relay.finalDiffs();
  const { init, result } = parseStream(existsSync(w.paths.stream) ? readFileSync(w.paths.stream, "utf8") : "");
  onResult(result);
  const sessionFile = findSessionFile(w.home, sessionId);
  if (!sessionFile) throw new HardError(`claude-code adapter: no session JSONL for ${sessionId} (exit ${exit.code ?? exit.signal ?? exit.error}; ${readFileSync(w.paths.stderr, "utf8").trim().slice(0, 300)})`);
  checkInit(init);
  const items = parseSession(readFileSync(sessionFile, "utf8"), { readPersisted: persistedReader(w.home) });
  checkHooksApplied(items, relay);
  const gaps = captureErrors(items, relay);
  if (gaps.length) throw new HardError(`claude-code adapter: incomplete capture: ${gaps.join("; ")}`);
  const state = await w.fetchState();
  const windows = [...relay.hooks].filter(([, h]) => h.pre).map(([id, h]) => ({ id, start: h.pre.at, end: h.post?.at ?? Number.POSITIVE_INFINITY }));
  const auditEvents = audit.audit === "available"
    ? parseStrace(existsSync(w.paths.audit) ? readFileSync(w.paths.audit, "utf8") : "", { storeRoot: keyCtx.storeRoot, cwd: w.home, excludeArgv: new RegExp(escRe(w.paths.relayHdr)), windows })
    : [];
  const { keyFile, keyDir } = keyCtx;
  const sensitive = (p) => p === keyFile || p === keyDir || p.startsWith(keyDir + "/") || keyDir.startsWith(p.replace(/\/+$/, "") + "/");
  const cost = typeof result?.total_cost_usd === "number" ? result.total_cost_usd : null;
  const t = assemble({
    items, result, exit, hooks: relay.hooks, postRun: postRunResolve(items, relay, w.home), journal: state.journal, lateDiffs, audit: auditEvents, sensitive,
    owned: state.owned, signerOpens: state.opens, storeRoot: keyCtx.storeRoot,
    base: {
      case_id: ref.caseId, suite: ref.suiteDir,
      meta: {
        adapter: "claude-code", adapter_version: PINS.ADAPTER_VERSION, skill_hash: skillHash(join(opts.skillsRoot, ref.suiteDir, "SKILL.md"), opts.skillsRoot),
        cli_version: opts.cliVersion, model_id: PINS.MODEL_ID, sample_index: opts.sample_index,
        session_id: sessionId, cost_usd: cost, num_turns: result?.num_turns ?? null,
        audit: audit.audit, audit_backend: audit.backend, audit_reason: audit.reason, keystore_audit: "lstat-diff", signer_audit: "signer-host-open-log", sandbox: "claude-code",
      },
      secrets: { ...w.run.transcript.secrets },
      sensitive_paths: { ...w.run.transcript.sensitive_paths },
    },
  });
  const v = validateTranscript(t);
  if (!v.ok) throw new HardError(`claude-code adapter: invalid capture for ${ref.caseId}: ${v.errors.join("; ")}`);
  return { transcript: t, costUsd: cost };
}

/**
 * One live sample → a schema-valid transcript (or a HardError: never a guessed capture).
 * @param {{suiteDir:string, caseId:string}} ref
 * @param {{sample_index:number, skillsRoot:string, claudeBin:string, cliVersion:string, budgetLeftUsd:number,
 *   audit?:object, timeoutMs?:number, killGraceMs?:number}} opts
 */
export async function run(ref, opts) {
  const audit = opts.audit ?? probeAudit();
  const w = await createWorld({ suiteDir: ref.suiteDir, caseId: ref.caseId, skillsRoot: opts.skillsRoot });
  let relay = null;
  try {
    const storeRoot = join(w.home, ".agents");
    const keyFile = join(w.home, KEY_REL);
    const keyCtx = { storeRoot, keyFile, keyDir: dirname(keyFile), baseline: snapshotTree(storeRoot) };
    relay = await startHookRelay(w, keyCtx);
    writeSettings(w, relay.url);
    assertHermetic(w);
    const sessionId = randomUUID();
    const args = claudeArgv({ prompt: buildPrompt(ref.suiteDir, ref.caseId, w), sessionId, settings: w.paths.settings, mcpConfig: w.paths.mcp, budgetLeftUsd: opts.budgetLeftUsd });
    const [argv0, ...argv] = audit.audit === "available" ? [...straceArgv(w.paths.audit, { killOnExit: audit.killOnExit }), opts.claudeBin, ...args] : [opts.claudeBin, ...args];
    const exit = await spawnCli(argv0, argv, w, { timeoutMs: opts.timeoutMs ?? PINS.RUN_TIMEOUT_MS, killGraceMs: opts.killGraceMs ?? PINS.KILL_GRACE_MS });
    let result = null;
    try {
      return await capture(w, { exit, relay, keyCtx, sessionId, audit, opts, ref, onResult: (r) => { result = r; } });
    } catch (e) {
      // The CLI ran, so it may have spent: carry the cost it reported (or none → the budget treats it as unknown). An
      // unexpected exception while reading the capture is still this sample's adapter error, never a runSuites crash.
      const he = e instanceof HardError ? e : new HardError(`claude-code adapter: capture failed: ${e?.message ?? e}`);
      throw Object.assign(he, { spawned: true, costUsd: typeof result?.total_cost_usd === "number" ? result.total_cost_usd : null });
    }
  } finally {
    if (relay) await relay.close();
    await w.cleanup();
  }
}

function saveTranscript(t, suiteDir, caseId, sample) {
  const out = process.env.SP6_LIVE_OUT_DIR;
  if (!out) return null;
  const f = join(out, suiteDir, `${caseId}.s${sample}.json`);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, `${JSON.stringify(t, null, 2)}\n`);
  return f;
}

/**
 * run.mjs entry (live path): k samples of every selected case, each graded like a golden (must pass). Returns one
 * record per sample: {caseId, kind:"live", sample, pass, findings, hardError, costUsd, audit}. With requireAudit (or
 * SP6_AUDIT=require — the CI live mode), a host without a process-tree file audit refuses every sample unspawned.
 */
export async function runSuites({ dirs, evalsRoot, skillsRoot, waivers, caseFilter, samples, requireAudit }) {
  const k = samples ?? PINS.DEFAULT_SAMPLES;
  if (!Number.isInteger(k) || k < 1 || k > 20) throw new HardError(`claude-code adapter: --samples must be an integer 1..20, got ${samples}`);
  const claudeBin = resolveClaude();
  const cliVersion = checkCliVersion(claudeBin);
  const budget = makeBudget(process.env.SP6_LIVE_BUDGET_USD ? Number(process.env.SP6_LIVE_BUDGET_USD) : PINS.BUDGET_USD);
  const timeoutMs = process.env.SP6_LIVE_RUN_TIMEOUT_MS ? Number(process.env.SP6_LIVE_RUN_TIMEOUT_MS) : PINS.RUN_TIMEOUT_MS;
  const audit = probeAudit();
  const mustAudit = requireAudit === true || process.env.SP6_AUDIT === "require";
  const results = [];
  for (const dir of dirs) {
    const { cases, assertions } = loadSuite(join(evalsRoot, dir));
    const joinErrs = validateJoin(cases, assertions);
    if (joinErrs.length) { results.push({ caseId: dir, kind: "suite", pass: false, findings: joinErrs, hardError: `invalid suite ${dir}` }); continue; }
    for (const [id, assertion] of assertions) {
      if (caseFilter && caseFilter !== id) continue;
      for (let s = 0; s < k; s++) {
        const base = { caseId: id, kind: "live", sample: s, audit: audit.audit };
        if (mustAudit && audit.audit !== "available") { results.push({ ...base, pass: false, findings: [], hardError: `not run: audit required but unavailable (${audit.reason})`, costUsd: null }); continue; }
        if (budget.exhausted()) { results.push({ ...base, pass: false, findings: [], hardError: `not run: ${budget.reason()}`, costUsd: null }); continue; }
        try {
          const { transcript, costUsd } = await run({ suiteDir: dir, caseId: id }, { sample_index: s, skillsRoot, claudeBin, cliVersion, budgetLeftUsd: budget.left, timeoutMs, audit });
          budget.add(costUsd);
          const g = grade(label(transcript), assertion, waivers);
          results.push({ ...base, pass: g.pass && !g.hardError, findings: g.findings, hardError: g.hardError, costUsd, transcriptPath: saveTranscript(transcript, dir, id, s) });
        } catch (e) {
          if (!(e instanceof HardError)) throw e;
          if (e.spawned) budget.add(e.costUsd ?? undefined);
          results.push({ ...base, pass: false, findings: [], hardError: e.message, costUsd: e.costUsd ?? null });
        }
      }
    }
  }
  return results;
}
