// Live host adapter: drives the pinned Claude Code CLI headless (`claude -p`) against the localhost mock world and
// turns its session into a graded transcript. Reachable ONLY via `await import()` from run.mjs (isolation.test.mjs).
//
// Per sample: a hermetic world (cc-world.mjs) → hook relay + key-store baseline → spawn the CLI (wrapped in strace
// where file auditing is available, cc-audit.mjs) → parse the `claude-code/1` capture (cc-parse.mjs) → assemble
// (cc-assemble.mjs) → validateTranscript → label + grade. Spend comes from the CLI's own per-session cost and a
// cumulative cap aborts the remaining samples.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { HardError, label, validateTranscript } from "../schema.mjs";
import { grade } from "../grader.mjs";
import { loadSuite, validateJoin } from "../cases.mjs";
import { skillHash } from "../hashes.mjs";
import { findOnPath, KEY_REL } from "../../mock/run-config.mjs";
import { diffSnapshots, snapshotTree } from "../../mock/lib/keystore-snapshot.mjs";
import { argPaths, resolveArgs } from "./cc-paths.mjs";
import { initVersion, parseSession, parseStream } from "./cc-parse.mjs";
import { assemble } from "./cc-assemble.mjs";
import { assertHermetic, createWorld, MCP_SERVER, writeSettings } from "./cc-world.mjs";
import { parseStrace, probeAudit, straceArgv } from "./cc-audit.mjs";
import { buildPrompt } from "./cc-prompts.mjs";

/** Everything a live run is pinned to. A CLI or capture-format bump must change these (and re-record goldens). */
export const PINS = Object.freeze({
  CLI_VERSION: "2.1.292",
  MODEL_ID: "claude-sonnet-5-5",
  MAX_TURNS: 20,
  DEFAULT_SAMPLES: 5,
  BUDGET_USD: 10, // provisional (spec): recalibrate from a measured pilot
  ADAPTER_VERSION: "claude-code/1",
  RUN_TIMEOUT_MS: 20 * 60 * 1000,
});

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

/** The exact argv the adapter spawns (documented in task-15-report.md). */
export function claudeArgv({ prompt, sessionId, settings, mcpConfig, budgetLeftUsd }) {
  return [
    "-p", prompt,
    "--output-format", "stream-json", "--verbose",
    "--model", PINS.MODEL_ID,
    "--max-turns", String(PINS.MAX_TURNS),
    "--max-budget-usd", budgetLeftUsd.toFixed(4),
    "--session-id", sessionId,
    "--permission-mode", "dontAsk",
    "--permission-prompts", "none",
    "--settings", settings,
    "--disallowedTools", "WebFetch,WebSearch,Agent,Task",
    "--mcp-config", mcpConfig,
    "--strict-mcp-config",
  ];
}

/** Cumulative spend cap across one runSuites invocation. */
export function makeBudget(capUsd) {
  if (!(Number.isFinite(capUsd) && capUsd > 0)) throw new HardError(`claude-code adapter: invalid budget cap ${capUsd}`);
  let spent = 0;
  let unknown = false;
  return {
    get spent() { return spent; },
    get left() { return Math.max(0, capUsd - spent); },
    exhausted() { return unknown || spent >= capUsd; },
    add(cost) { if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) spent += cost; else unknown = true; },
    reason() { return unknown ? "a run reported no per-session cost, so spend cannot be accounted" : `budget cap $${capUsd} reached ($${spent.toFixed(4)} spent)`; },
  };
}

/** Relay for Claude Code's Pre/PostToolUse / PermissionDenied hooks: resolves each call's path arguments and diffs the
 * key store right at the call boundary (capture time, in the hermetic world). */
async function startHookRelay(w, keyCtx) {
  const token = randomBytes(16).toString("hex");
  const hooks = new Map();
  const unkeyed = [];
  let last = keyCtx.baseline;
  const owned = () => {
    const m = new Map();
    if (!existsSync(w.paths.owned)) return m;
    for (const l of readFileSync(w.paths.owned, "utf8").split("\n").filter(Boolean)) { const o = JSON.parse(l); m.set(o.path, o.after); }
    return m;
  };
  const observe = () => {
    const snap = snapshotTree(keyCtx.storeRoot);
    const own = owned();
    const diffs = diffSnapshots(last, snap).filter((d) => !(d.after !== null && own.get(d.path) === d.after));
    last = snap;
    return diffs;
  };
  const handle = (event, p) => {
    const at = Date.now();
    const id = typeof p.tool_use_id === "string" ? p.tool_use_id : null;
    const rec = id ? (hooks.get(id) ?? {}) : { tool_name: p.tool_name, input: p.tool_input };
    if (event === "denied") rec.denied = true;
    else {
      const cwd = typeof p.cwd === "string" && p.cwd ? p.cwd : w.home;
      let pairs = [];
      try { pairs = resolveArgs(argPaths(String(p.tool_name ?? ""), p.tool_input ?? {}, { cwd, home: w.home })); } catch { pairs = []; }
      rec[event] = { at, pairs, diffs: observe(), cwd };
    }
    if (id) hooks.set(id, rec); else unkeyed.push({ event, ...rec });
  };
  const server = createServer((req, res) => {
    const m = /^\/h\/([0-9a-f]+)\/(pre|post|denied)$/.exec(req.url ?? "");
    if (req.method !== "POST" || !m || m[1] !== token) { res.writeHead(404); return res.end(); }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { handle(m[2], JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { /* malformed hook payload: nothing recorded */ }
      res.writeHead(200); res.end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}/h/${token}`, token, hooks, unkeyed,
    finalDiffs: observe,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

function spawnCli(argv0, argv, w, timeoutMs) {
  return new Promise((resolve) => {
    const out = createWriteStream(w.paths.stream, { mode: 0o600 });
    const err = createWriteStream(w.paths.stderr, { mode: 0o600 });
    const child = spawn(argv0, argv, { cwd: w.home, env: w.env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(out);
    child.stderr.pipe(err);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 5000).unref(); }, timeoutMs);
    const done = (code, signal, error) => {
      clearTimeout(timer);
      Promise.all([new Promise((r) => out.end(r)), new Promise((r) => err.end(r))]).then(() => resolve({ code, signal, timedOut, error }));
    };
    child.once("error", (e) => done(null, null, e.message));
    child.once("close", (code, signal) => done(code, signal, null));
  });
}

function findSessionFile(home, sessionId) {
  const root = join(home, ".claude", "projects");
  if (!existsSync(root)) return null;
  for (const d of readdirSync(root)) { const f = join(root, d, `${sessionId}.jsonl`); if (existsSync(f)) return f; }
  return null;
}

/** Match hook records that carried no tool_use_id to session calls by (tool name, input), in order. */
function keyUnkeyed(items, relay) {
  const pool = [...relay.unkeyed];
  for (const c of items.filter((x) => x.kind === "call" && !relay.hooks.has(x.id))) {
    const rec = {};
    for (const ev of ["pre", "post", "denied"]) {
      const k = pool.findIndex((u) => u.event === ev && u.tool_name === c.name && JSON.stringify(u.input) === JSON.stringify(c.input));
      if (k >= 0) { const [u] = pool.splice(k, 1); if (ev === "denied") rec.denied = true; else rec[ev] = u[ev]; }
    }
    if (Object.keys(rec).length) relay.hooks.set(c.id, rec);
  }
}

/**
 * One live sample → a schema-valid transcript (or a HardError: never a guessed capture).
 * @param {{suiteDir:string, caseId:string}} ref
 * @param {{sample_index:number, skillsRoot:string, claudeBin:string, cliVersion:string, budgetLeftUsd:number, timeoutMs?:number}} opts
 */
export async function run(ref, opts) {
  const { suiteDir, caseId } = ref;
  const w = await createWorld({ suiteDir, caseId, skillsRoot: opts.skillsRoot });
  let relay = null;
  try {
    const storeRoot = join(w.home, ".agents");
    const keyFile = join(w.home, KEY_REL);
    const keyDir = dirname(keyFile);
    relay = await startHookRelay(w, { storeRoot, baseline: snapshotTree(storeRoot) });
    writeSettings(w, relay.url);
    assertHermetic(w);
    const sessionId = randomUUID();
    const prompt = buildPrompt(suiteDir, caseId, w);
    const args = claudeArgv({ prompt, sessionId, settings: w.paths.settings, mcpConfig: w.paths.mcp, budgetLeftUsd: opts.budgetLeftUsd });
    const audit = probeAudit();
    const [argv0, ...argv] = audit.audit === "strace" ? [...straceArgv(w.paths.audit), opts.claudeBin, ...args] : [opts.claudeBin, ...args];
    const exit = await spawnCli(argv0, argv, w, opts.timeoutMs ?? PINS.RUN_TIMEOUT_MS);
    let result = null;
    try {
      return capture(w, { exit, relay, storeRoot, keyFile, keyDir, sessionId, audit, opts, ref, onResult: (r) => { result = r; } });
    } catch (e) {
      // The CLI ran, so it may have spent: carry the cost it reported (or none → the budget treats it as unknown).
      if (e instanceof HardError) Object.assign(e, { spawned: true, costUsd: typeof result?.total_cost_usd === "number" ? result.total_cost_usd : null });
      throw e;
    }
  } finally {
    if (relay) await relay.close();
    await w.cleanup();
  }
}

const DENIED_TOOLS = ["WebFetch", "WebSearch", "Agent", "Task"];

/** The init message must show the pinned CLI + model, the denied tools gone, dontAsk, and the mock MCP connected. */
function checkInit(init) {
  if (!init) return;
  const v = initVersion(init);
  if (v && v !== PINS.CLI_VERSION) throw new HardError(`claude-code adapter: session ran CLI ${v}, pinned ${PINS.CLI_VERSION}`);
  if (init.model && init.model !== PINS.MODEL_ID) throw new HardError(`claude-code adapter: session ran model ${init.model}, pinned ${PINS.MODEL_ID}`);
  const offered = (init.tools ?? []).filter((t) => DENIED_TOOLS.includes(t));
  if (offered.length) throw new HardError(`claude-code adapter: denied tools still offered (${offered.join(", ")})`);
  if (init.permissionMode && init.permissionMode !== "dontAsk") throw new HardError(`claude-code adapter: permission mode ${init.permissionMode}, expected dontAsk`);
  if (!(init.mcp_servers ?? []).some((s) => s.name === MCP_SERVER && s.status === "connected")) throw new HardError("claude-code adapter: the mock MCP server did not connect");
}

/**
 * `-p` silently ignores a settings file that fails validation — taking the deny rules, the sandbox and the hooks
 * with it. Hooks are the observable part: a run with tool calls but not ONE hook record is refused, never graded.
 */
function checkHooksApplied(items, relay) {
  const calls = items.filter((c) => c.kind === "call");
  if (calls.length > 0 && !calls.some((c) => relay.hooks.get(c.id)?.pre || relay.hooks.get(c.id)?.denied)) {
    throw new HardError("claude-code adapter: no tool hook ever fired — the --settings file was not applied (sandbox / deny rules cannot be trusted)");
  }
}

/** Re-resolve every call's path arguments after the run (the TOCTOU third observation; worst-of in cc-assemble). */
function postRunResolve(items, relay, home) {
  const out = new Map();
  for (const c of items.filter((x) => x.kind === "call")) {
    const cwd = c.cwd ?? relay.hooks.get(c.id)?.pre?.cwd ?? home;
    try { out.set(c.id, resolveArgs(argPaths(c.name, c.input, { cwd, home }))); } catch { /* not statically resolvable */ }
  }
  return out;
}

/** Parse + assemble + validate a finished run (throws HardError on any capture problem). */
function capture(w, { exit, relay, storeRoot, keyFile, keyDir, sessionId, audit, opts, ref, onResult }) {
  const lateDiffs = relay.finalDiffs();
  const { init, result } = parseStream(existsSync(w.paths.stream) ? readFileSync(w.paths.stream, "utf8") : "");
  onResult(result);
  const sessionFile = findSessionFile(w.home, sessionId);
  if (!sessionFile) throw new HardError(`claude-code adapter: no session JSONL for ${sessionId} (exit ${exit.code ?? exit.signal ?? exit.error}; ${readFileSync(w.paths.stderr, "utf8").trim().slice(0, 300)})`);
  checkInit(init);
  const items = parseSession(readFileSync(sessionFile, "utf8"));
  keyUnkeyed(items, relay);
  checkHooksApplied(items, relay);
  const auditEvents = audit.audit === "strace" && existsSync(w.paths.audit)
    ? parseStrace(readFileSync(w.paths.audit, "utf8"), { storeRoot, cwd: w.home, excludeArgv: new RegExp(relay.token) })
    : [];
  const journal = readFileSync(w.run.journal, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const sensitive = (p) => p === keyFile || p === keyDir || p.startsWith(keyDir + "/") || keyDir.startsWith(p.replace(/\/+$/, "") + "/");
  const cost = typeof result?.total_cost_usd === "number" ? result.total_cost_usd : null;
  const t = assemble({
    items, result, exit, hooks: relay.hooks, postRun: postRunResolve(items, relay, w.home), journal, lateDiffs, audit: auditEvents, sensitive,
    base: {
      case_id: ref.caseId, suite: ref.suiteDir,
      meta: {
        adapter: "claude-code", adapter_version: PINS.ADAPTER_VERSION, skill_hash: skillHash(join(opts.skillsRoot, ref.suiteDir, "SKILL.md"), opts.skillsRoot),
        cli_version: opts.cliVersion, model_id: PINS.MODEL_ID, sample_index: opts.sample_index,
        session_id: sessionId, cost_usd: cost, num_turns: result?.num_turns ?? null,
        audit: audit.audit, audit_reason: audit.reason, keystore_audit: "lstat-diff", sandbox: "claude-code",
        capture_gaps: items.filter((c) => c.kind === "call" && !relay.hooks.get(c.id)?.pre).map((c) => c.id),
      },
      secrets: { ...w.run.transcript.secrets },
      sensitive_paths: { ...w.run.transcript.sensitive_paths },
    },
  });
  const v = validateTranscript(t);
  if (!v.ok) throw new HardError(`claude-code adapter: invalid capture for ${ref.caseId}: ${v.errors.join("; ")}`);
  return { transcript: t, costUsd: cost };
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
 * run.mjs entry (live path): k samples of every selected case, each graded like a golden (must pass).
 * Returns one record per sample: {caseId, kind:"live", sample, pass, findings, hardError, costUsd}.
 */
export async function runSuites({ dirs, evalsRoot, skillsRoot, waivers, caseFilter, samples }) {
  const k = samples ?? PINS.DEFAULT_SAMPLES;
  if (!Number.isInteger(k) || k < 1 || k > 20) throw new HardError(`claude-code adapter: --samples must be an integer 1..20, got ${samples}`);
  const claudeBin = resolveClaude();
  const cliVersion = checkCliVersion(claudeBin);
  const budget = makeBudget(process.env.SP6_LIVE_BUDGET_USD ? Number(process.env.SP6_LIVE_BUDGET_USD) : PINS.BUDGET_USD);
  const timeoutMs = process.env.SP6_LIVE_RUN_TIMEOUT_MS ? Number(process.env.SP6_LIVE_RUN_TIMEOUT_MS) : PINS.RUN_TIMEOUT_MS;
  const results = [];
  for (const dir of dirs) {
    const { cases, assertions } = loadSuite(join(evalsRoot, dir));
    const joinErrs = validateJoin(cases, assertions);
    if (joinErrs.length) { results.push({ caseId: dir, kind: "suite", pass: false, findings: joinErrs, hardError: `invalid suite ${dir}` }); continue; }
    for (const [id, assertion] of assertions) {
      if (caseFilter && caseFilter !== id) continue;
      for (let s = 0; s < k; s++) {
        if (budget.exhausted()) { results.push({ caseId: id, kind: "live", sample: s, pass: false, findings: [], hardError: `not run: ${budget.reason()}`, costUsd: null }); continue; }
        try {
          const { transcript, costUsd } = await run({ suiteDir: dir, caseId: id }, { sample_index: s, skillsRoot, claudeBin, cliVersion, budgetLeftUsd: budget.left, timeoutMs });
          budget.add(costUsd);
          const g = grade(label(transcript), assertion, waivers);
          results.push({ caseId: id, kind: "live", sample: s, pass: g.pass && !g.hardError, findings: g.findings, hardError: g.hardError, costUsd, transcriptPath: saveTranscript(transcript, dir, id, s) });
        } catch (e) {
          if (!(e instanceof HardError)) throw e;
          if (e.spawned) budget.add(e.costUsd ?? undefined);
          results.push({ caseId: id, kind: "live", sample: s, pass: false, findings: [], hardError: e.message, costUsd: e.costUsd ?? null });
        }
      }
    }
  }
  return results;
}
