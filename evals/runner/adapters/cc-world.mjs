// The hermetic world for one live claude-code sample.
//
//   <tmp>/sp6-run-XXXX/   0700, the RUN ROOT — run.json (canaries), journal, signer state, settings, MCP config,
//                         stream/session capture. Outside HOME and outside HOME's parent; denied to Read/Edit and to
//                         the OS sandbox; named by nothing the agent can read (the signer runs out of process).
//   <tmp>/agent-home-XXXX/ the agent's world, neutrally named (the agent sees it in $HOME): home/ (HOME = cwd,
//                         skills under ~/.claude/skills, key store under ~/.agents) and an npm-global-shaped prefix
//                         (bin/, lib/node_modules/@sohopay/agent-signer).
import { spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { HardError } from "../schema.mjs";
import { closureFiles } from "../hashes.mjs";
import { buildRun, findOnPath, KEY_REL, seedHome } from "../../mock/run-config.mjs";
import { brokenInstallEntry } from "../../mock/signer-main.mjs";
import { loadScenario } from "../../mock/scenarios/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, "..", "..", "mock", "backend.mjs");
const CLIENT_SRC = join(HERE, "cc-signer-client.mjs");
export const MCP_SERVER = "sohopay";
/** Sandboxed Bash gets TMPDIR from CLAUDE_CODE_TMPDIR; /tmp keeps `mktemp -d` in the labeler's trusted shape. */
export const SANDBOX_TMPDIR = "/tmp";
/** The only `mktemp -d` parents the labeler trusts (sanction.mjs MKTEMP_DIR_RE), as TMPDIR values. */
const DEFAULT_TMPDIR_RE = /^(?:\/tmp\/?|(?:\/private)?\/var\/folders\/[^/]+\/[^/]+\/T\/?)$/;
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Start backend.mjs (+ the signer host) as its own process — a same-process server would deadlock a sync caller. */
function startBackend(runPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BACKEND, "--run", runPath, "--signer-host"], { stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    let err = "";
    const fail = (m) => { child.kill(); reject(new HardError(`mock backend: ${m}`)); };
    const timer = setTimeout(() => fail(`no startup line (${err.trim()})`), 15_000);
    child.stderr.on("data", (d) => { err += d; });
    child.stdout.on("data", (d) => {
      buf += d;
      if (!buf.includes("\n")) return;
      clearTimeout(timer);
      try {
        const urls = JSON.parse(buf.split("\n")[0]);
        resolve({ urls, close: () => new Promise((r) => { if (child.exitCode !== null) return r(); child.once("exit", r); child.kill(); }) });
      } catch { fail(`bad startup line ${buf}`); }
    });
    child.once("error", (e) => { clearTimeout(timer); reject(new HardError(`mock backend: ${e.message}`)); });
    child.once("exit", (c) => { clearTimeout(timer); if (!buf.includes("\n")) reject(new HardError(`mock backend exited ${c}: ${err.trim()}`)); });
  });
}

/** Install the signer the scenario calls for under the npm-global prefix `prefix`; returns the bin dir. */
export function installSigner(run, prefix, signerUrl) {
  const bin = join(prefix, "bin");
  mkdirSync(bin, { recursive: true });
  const presence = run.signer.presence ?? "path";
  if (presence !== "absent") {
    let entry;
    if (run.signer.answers === false) entry = brokenInstallEntry(prefix); // Node itself fails: ERR_MODULE_NOT_FOUND
    else {
      const pkg = join(prefix, "lib", "node_modules", "@sohopay", "agent-signer");
      entry = join(pkg, "dist", "cli", "index.js");
      mkdirSync(dirname(entry), { recursive: true });
      writeFileSync(join(pkg, "package.json"), `${JSON.stringify({ name: "@sohopay/agent-signer", version: "0.3.1", type: "module", bin: { "sohopay-signer": "dist/cli/index.js" } }, null, 2)}\n`);
      // The installed copy keeps code only: the repo comments describe the eval and must not reach the agent.
      const code = readFileSync(CLIENT_SRC, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
      writeFileSync(entry, code.replace("__SIGNER_ENDPOINT__", signerUrl), { mode: 0o755 });
    }
    writeFileSync(join(bin, "sohopay-signer"), `#!/bin/sh\nexec ${shq(process.execPath)} ${shq(entry)} "$@"\n`, { mode: 0o755 });
  }
  if (run.signer.npx === "unavailable") {
    writeFileSync(join(bin, "npx"), `#!/bin/sh\necho "npm error npx canceled due to missing packages and no YES option: [\\"$2\\"]" >&2\nexit 1\n`, { mode: 0o755 });
  }
  return bin;
}

/** Copy every skill in the suite's SKILL.md closure into ~/.claude/skills/<name>/ (raw source, as the plugin ships it). */
export function installSkills(suiteDir, skillsRoot, home) {
  const dirs = new Set(closureFiles(join(skillsRoot, suiteDir, "SKILL.md"), skillsRoot).filter((f) => basename(f) === "SKILL.md").map((f) => dirname(f)));
  if (!dirs.has(join(skillsRoot, suiteDir))) throw new HardError(`skill ${suiteDir} not found under ${skillsRoot}`);
  for (const d of dirs) cpSync(d, join(home, ".claude", "skills", basename(d)), { recursive: true });
  return [...dirs].map((d) => basename(d)).sort();
}

/** The agent's environment: nothing inherited except identity, locale, auth for the harness, and a default TMPDIR. */
export function agentEnv({ home, binDir }, parent = process.env) {
  const env = {
    HOME: home, PATH: `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`, SHELL: "/bin/bash", TERM: "dumb",
    LANG: parent.LANG ?? "en_US.UTF-8", USER: parent.USER ?? "agent", LOGNAME: parent.LOGNAME ?? parent.USER ?? "agent",
    CLAUDE_CODE_TMPDIR: SANDBOX_TMPDIR,
    DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    ENABLE_TOOL_SEARCH: "false",
  };
  if (parent.TMPDIR && DEFAULT_TMPDIR_RE.test(parent.TMPDIR)) env.TMPDIR = parent.TMPDIR;
  for (const k of ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]) if (parent[k]) env[k] = parent[k];
  return env;
}

/** Claude Code settings for the run (passed with --settings from the run root; never written into HOME). */
export function runSettings({ runRoot, home, hookUrl }) {
  const hook = (event) => [{ matcher: "*", hooks: [{ type: "command", command: `/usr/bin/curl -sS -o /dev/null --max-time 30 -H 'content-type: application/json' --data-binary @- ${shq(`${hookUrl}/${event}`)}`, timeout: 60 }] }];
  return {
    permissions: {
      defaultMode: "dontAsk",
      // dontAsk denies anything not listed; Skill must be here or the installed skills cannot be loaded.
      allow: ["Bash", "Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "LS", "TodoWrite", "Skill", `mcp__${MCP_SERVER}`],
      deny: ["WebFetch", "WebSearch", "Agent", "Task", `Read(/${runRoot}/**)`, `Edit(/${runRoot}/**)`, `Edit(/${join(home, ".claude")}/**)`],
    },
    sandbox: {
      enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false,
      network: { allowedDomains: ["127.0.0.1", "localhost"] },
      filesystem: { denyRead: [runRoot], denyWrite: [join(home, ".claude")], allowWrite: [SANDBOX_TMPDIR] },
    },
    hooks: { PreToolUse: hook("pre"), PostToolUse: hook("post"), PostToolUseFailure: hook("post"), PermissionDenied: hook("denied") },
  };
}

/** Is `p` equal to or below `dir` (both canonical)? */
const within = (p, dir) => p === dir || p.startsWith(dir.endsWith(sep) ? dir : dir + sep);
/** realpath of the deepest existing ancestor, plus the not-yet-existing remainder. */
function canonicalLoose(p) {
  const rest = [];
  let cur = p;
  while (!existsSync(cur)) { rest.unshift(basename(cur)); const up = dirname(cur); if (up === cur) break; cur = up; }
  return join(realpathSync(cur), ...rest);
}

/**
 * Fail-closed hermeticity checks, run BEFORE the CLI is spawned (any violation is an adapter error, never a case
 * result): the canonical key path is inside HOME; the run root is 0700 and outside HOME and HOME's parent; the
 * only sohopay-signer on PATH is the one installed for this run; TMPDIR is a platform default; nothing the agent
 * can reach (its prefix) names the run root or carries a canary.
 */
export function assertHermetic(w) {
  const home = realpathSync(w.home);
  const key = canonicalLoose(join(w.home, KEY_REL));
  if (!within(key, home)) throw new HardError(`hermetic: canonical key path ${key} is outside HOME ${home}`);
  const runRoot = realpathSync(w.runRoot);
  if (within(runRoot, home) || within(runRoot, realpathSync(dirname(w.home)))) throw new HardError(`hermetic: run root ${runRoot} is reachable from HOME or HOME's parent`);
  if ((statSync(runRoot).mode & 0o077) !== 0) throw new HardError(`hermetic: run root ${runRoot} is not 0700`);
  const signers = findOnPath("sohopay-signer", w.env.PATH);
  const expected = existsSync(join(w.binDir, "sohopay-signer")) ? [join(w.binDir, "sohopay-signer")] : [];
  if (JSON.stringify(signers) !== JSON.stringify(expected)) throw new HardError(`hermetic: sohopay-signer on PATH ${JSON.stringify(signers)} != ${JSON.stringify(expected)}`);
  if (w.env.TMPDIR !== undefined && !DEFAULT_TMPDIR_RE.test(w.env.TMPDIR)) throw new HardError(`hermetic: TMPDIR ${w.env.TMPDIR} is not a platform default`);
  if (w.env.CLAUDE_CODE_TMPDIR !== SANDBOX_TMPDIR) throw new HardError("hermetic: CLAUDE_CODE_TMPDIR must be /tmp");
  const secrets = [w.run.canaries.private_key, w.run.canaries.header_value, runRoot, w.runRoot];
  // The prefix (bin + installed packages) must not name the run root or carry a canary. HOME is skipped: the seeded
  // key file holds the private canary by design (that is what never_appears guards).
  const scan = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (p === w.home) continue;
      const st = statSync(p);
      if (st.isDirectory()) { scan(p); continue; }
      const body = readFileSync(p, "utf8");
      if (secrets.some((s) => body.includes(s))) throw new HardError(`hermetic: ${p} names the run root or a canary`);
    }
  };
  scan(w.prefix);
}

/**
 * Build the world for one sample. Returns { run, runRoot, prefix, home, binDir, env, urls, paths, cleanup }.
 * `cleanup()` stops the backend and removes both roots (they hold the canary key file and run.json).
 */
export async function createWorld({ suiteDir, caseId, skillsRoot }) {
  const runRoot = realpathSync(mkdtempSync(join(tmpdir(), "sp6-run-")));
  chmodSync(runRoot, 0o700);
  const prefix = realpathSync(mkdtempSync(join(tmpdir(), "agent-home-")));
  let backend = null;
  const cleanup = async () => {
    try { if (backend) await backend.close(); } finally {
      rmSync(prefix, { recursive: true, force: true });
      rmSync(runRoot, { recursive: true, force: true });
    }
  };
  try {
    const home = join(prefix, "home");
    mkdirSync(home, { mode: 0o700 });
    const scenario = await loadScenario(caseId);
    if (scenario.suite !== suiteDir) throw new HardError(`scenario ${caseId} belongs to ${scenario.suite}, not ${suiteDir}`);
    const run = buildRun(scenario, { runDir: runRoot, home });
    const runPath = join(runRoot, "run.json");
    writeFileSync(runPath, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(run.journal, "", { mode: 0o600 });
    seedHome(run);
    backend = await startBackend(runPath);
    const binDir = installSigner(run, prefix, backend.urls.signer);
    const skills = installSkills(suiteDir, skillsRoot, home);
    const env = agentEnv({ home, binDir });
    const paths = {
      runPath, settings: join(runRoot, "settings.json"), mcp: join(runRoot, "mcp.json"), stream: join(runRoot, "stream.jsonl"),
      stderr: join(runRoot, "claude.stderr"), owned: join(runRoot, "signer-owned.jsonl"), audit: join(runRoot, "audit.strace"),
    };
    writeFileSync(paths.mcp, JSON.stringify({ mcpServers: { [MCP_SERVER]: { type: "http", url: backend.urls.mcp } } }), { mode: 0o600 });
    return { scenario, run, runRoot, prefix, home, binDir, env, urls: backend.urls, paths, skills, cleanup };
  } catch (e) {
    await cleanup();
    throw e;
  }
}

/** Write the run's settings file once the hook endpoint is known. */
export function writeSettings(w, hookUrl) {
  writeFileSync(w.paths.settings, JSON.stringify(runSettings({ runRoot: w.runRoot, home: w.home, hookUrl }), null, 2), { mode: 0o600 });
}
