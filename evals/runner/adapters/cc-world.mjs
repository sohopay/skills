// The hermetic world for one live claude-code sample.
//
//   <run base>/sp6-run-XXXX/  0700, the RUN ROOT: run.json (canaries), ctl.token, settings, MCP config (with the /mcp
//                             bearer), host-private/, stream/stderr capture, strace output. The base is under the OPERATOR's home
//                             (SP6_RUN_ROOT_BASE overrides), never /tmp: outside HOME and HOME's parent, denied to the
//                             agent for read AND write (permissions + sandbox), named by nothing it can read. The journal,
//                             signer-owned changes, signer opens and hook records never touch a disk: they live in the
//                             backend / adapter processes and leave only over authenticated channels.
//   <tmp>/agent-home-XXXX/    the agent's world, neutrally named (it sees it in $HOME): home/ (HOME = cwd, skills under
//                             ~/.claude/skills, key store under ~/.agents) and an npm-global-shaped prefix (bin/ with node
//                             and the signer symlink, lib/node_modules/@sohopay/agent-signer).
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { HardError } from "../schema.mjs";
import { closureFiles } from "../hashes.mjs";
import { MKTEMP_DIR_RE, trustedMktempDir } from "../sanction.mjs";
import { buildRun, findOnPath, KEY_REL, seedHome } from "../../mock/run-config.mjs";
import { brokenInstallEntry } from "../../mock/signer-main.mjs";
import { loadScenario } from "../../mock/scenarios/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, "..", "..", "mock", "backend.mjs");
const CLIENT_SRC = join(HERE, "cc-signer-client.mjs");
const HOOK_SRC = join(HERE, "cc-hook.mjs");
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const SIGNER_ENTRY_REL = join("lib", "node_modules", "@sohopay", "agent-signer", "dist", "cli", "index.js");
export const MCP_SERVER = "sohopay";
/** TMPDIR values the agent env may inherit (the platform defaults; `mktemp -d` there is a trusted shape). */
const DEFAULT_TMPDIR_RE = /^(?:\/tmp\/?|(?:\/private)?\/var\/folders\/[^/]+\/[^/]+\/T\/?)$/;
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const uid = () => (typeof process.getuid === "function" ? process.getuid() : 0);

/** Where run roots live: under the operator's home (denied to the agent), never /tmp. */
export const runRootBase = () => process.env.SP6_RUN_ROOT_BASE ?? join(homedir(), ".cache", "sp6-live");

/** The TMPDIR Claude Code's Bash sandbox exports: <CLAUDE_CODE_TMPDIR or CLAUDE_TMPDIR or /tmp>/claude-<uid>. */
export function sandboxTmpDir(env, id = uid()) {
  return join(env.CLAUDE_CODE_TMPDIR || env.CLAUDE_TMPDIR || "/tmp", `claude-${id}`);
}

/** Validate the backend's control-channel state; anything malformed is an adapter error, never a crash. */
export function parseBackendState(s) {
  const ok = s && typeof s === "object" && ["journal", "owned", "execs"].every((k) => Array.isArray(s[k]));
  const fileRec = (o) => o && typeof o.role === "string" && typeof o.path === "string";
  const entries = ok && s.journal.every((e) => e && typeof e.condition === "string" && Number.isFinite(e.at))
    && s.owned.every((e) => e && typeof e.path === "string" && (e.after === null || typeof e.after === "string"))
    && s.execs.every((e) => e && Array.isArray(e.argv) && Number.isFinite(e.at) && Number.isFinite(e.done) && Array.isArray(e.opens) && e.opens.every(fileRec) && Array.isArray(e.refusals) && e.refusals.every((r) => r && typeof r.role === "string"));
  if (!entries) throw new HardError("mock backend: malformed control-channel state");
  return s;
}

/** Start backend.mjs (+ the signer host) as its own process — a same-process server would deadlock a sync caller. */
function startBackend(runPath, tokensPath, ctlToken) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [BACKEND, "--run", runPath, "--signer-host", "--tokens", tokensPath], { stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    let err = "";
    const fail = (m) => { child.kill(); reject(new HardError(`mock backend: ${m}`)); };
    const timer = setTimeout(() => fail(`no startup line (${err.trim()})`), 15_000);
    child.stderr.on("data", (d) => { err += d; });
    child.stdout.on("data", (d) => {
      buf += d;
      if (!buf.includes("\n")) return;
      clearTimeout(timer);
      let urls;
      try { urls = JSON.parse(buf.split("\n")[0]); } catch { return fail(`bad startup line ${buf}`); }
      done({
        urls,
        async fetchState() {
          let body;
          try {
            const r = await fetch(`${urls.url}/__ctl/state`, { headers: { "x-ctl-token": ctlToken } });
            if (!r.ok) throw new Error(`status ${r.status}`);
            body = await r.json();
          } catch (e) { throw new HardError(`mock backend: control channel failed: ${e.message}`); }
          return parseBackendState(body);
        },
        close: () => new Promise((r) => { if (child.exitCode !== null) return r(); child.once("exit", r); child.kill(); }),
      });
    });
    child.once("error", (e) => { clearTimeout(timer); reject(new HardError(`mock backend: ${e.message}`)); });
    child.once("exit", (c) => { clearTimeout(timer); if (!buf.includes("\n")) reject(new HardError(`mock backend exited ${c}: ${err.trim()}`)); });
  });
}

/**
 * Install the signer the scenario calls for under the npm-global prefix `prefix`, laid out the way npm does it:
 * bin/node, and bin/sohopay-signer a relative symlink to lib/node_modules/@sohopay/agent-signer/dist/cli/index.js.
 * Returns the bin dir.
 */
export function installSigner(run, prefix, signerUrl, clientToken) {
  const bin = join(prefix, "bin");
  mkdirSync(bin, { recursive: true });
  if (!existsSync(join(bin, "node"))) symlinkSync(process.execPath, join(bin, "node"));
  if ((run.signer.presence ?? "path") !== "absent") {
    let entry;
    if (run.signer.answers === false) entry = brokenInstallEntry(prefix); // Node itself fails: ERR_MODULE_NOT_FOUND
    else {
      const pkg = join(prefix, "lib", "node_modules", "@sohopay", "agent-signer");
      entry = join(prefix, SIGNER_ENTRY_REL);
      mkdirSync(dirname(entry), { recursive: true });
      writeFileSync(join(pkg, "package.json"), `${JSON.stringify({ name: "@sohopay/agent-signer", version: "0.3.1", type: "module", bin: { "sohopay-signer": "dist/cli/index.js" } }, null, 2)}\n`);
      // The installed copy keeps code only: the repo comments describe the eval and must not reach the agent.
      const code = readFileSync(CLIENT_SRC, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
      writeFileSync(entry, code.replace("__SIGNER_ENDPOINT__", signerUrl).replace("__SIGNER_CLIENT__", clientToken));
    }
    chmodSync(entry, 0o755);
    symlinkSync(relative(bin, entry), join(bin, "sohopay-signer"));
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

/**
 * N1: install the hook wrapper at the FIXED, secret-free path <base>/hook.mjs (comment lines stripped). The hook
 * command names only node and this path; the relay url + token are found per session in <base>/relays/.
 */
export function installHookWrapper(base) {
  const dest = join(base, "hook.mjs");
  const code = readFileSync(HOOK_SRC, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  writeFileSync(dest, code, { mode: 0o700 });
  return dest;
}

/** The agent's environment: nothing inherited except identity, locale, harness auth and a DEFAULT TMPDIR. */
export function agentEnv({ home, binDir }, parent = process.env) {
  const env = {
    HOME: home, PATH: `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`, SHELL: "/bin/bash", TERM: "dumb",
    LANG: parent.LANG ?? "en_US.UTF-8", USER: parent.USER ?? "agent", LOGNAME: parent.LOGNAME ?? parent.USER ?? "agent",
    DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    ENABLE_TOOL_SEARCH: "false",
  };
  if (parent.TMPDIR && DEFAULT_TMPDIR_RE.test(parent.TMPDIR)) env.TMPDIR = parent.TMPDIR;
  for (const k of ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]) if (parent[k]) env[k] = parent[k];
  return env;
}

/** Spellings of a /tmp path on this platform (macOS /tmp is a link to /private/tmp). */
const tmpSpellings = (p) => (process.platform === "darwin" && p.startsWith("/tmp/") ? [p, `/private${p}`] : [p]);

/**
 * What the agent's file tools and sandboxed Bash may not reach, resolved from the HARNESS (never the workspace):
 * the operator's home, the repo checkout, the run root, other users' Claude temp dirs and every pre-existing entry
 * of our own (the operator's Claude sessions live there). Node's install prefix is re-allowed if it sits inside a
 * denied root (nvm), since the installed signer runs on it.
 */
export function confinement({ home, runRoot, prefix = dirname(home), platform = process.platform, tmp = realpathSync(tmpdir()) }) {
  const operatorHome = realpathSync(homedir());
  const repoRoot = realpathSync(REPO_ROOT);
  const sandboxTmp = sandboxTmpDir({});
  const others = [];
  let names = [];
  try { names = readdirSync("/tmp"); } catch { names = []; }
  for (const n of names.filter((x) => /^claude-/.test(x))) {
    const dir = `/tmp/${n}`;
    if (dir !== sandboxTmp) { others.push(...tmpSpellings(dir)); continue; }
    let kids = [];
    try { kids = readdirSync(dir); } catch { kids = []; }
    for (const k of kids) others.push(...tmpSpellings(`${dir}/${k}`));
  }
  const nodePrefix = dirname(dirname(realpathSync(process.execPath)));
  const inside = (p, d) => p === d || p.startsWith(d + sep);
  // N9 (macOS, best effort): $TMPDIR (/var/folders/<a>/<b>/T) holds other runs' workspaces and operator temp files.
  // Deny it, re-allowing only this run's workspace and fresh `mktemp -d` dirs (tmp.*; macOS mktemp ignores TMPDIR).
  const darwinTmp = platform === "darwin" && !tmp.startsWith("/tmp") && !tmp.startsWith("/private/tmp") ? tmp : null;
  const mktempGlobs = darwinTmp ? [`${darwinTmp}/tmp.*`] : [];
  return {
    operatorHome, repoRoot, sandboxTmp, mktempGlobs,
    denyRead: [operatorHome, repoRoot, runRoot, ...others, ...(darwinTmp ? [darwinTmp] : [])],
    denyWrite: [runRoot, operatorHome, repoRoot, join(home, ".claude")],
    allowRead: [...([operatorHome, repoRoot].some((d) => inside(nodePrefix, d)) ? [nodePrefix] : []), ...(darwinTmp ? [prefix, ...mktempGlobs] : [])],
  };
}

/** Claude Code settings for the run (passed with --settings from the run root; never written into HOME). */
export function runSettings({ runRoot, home, hookWrapper, node, confine }) {
  // N1: no run-root path and no token in any hook command (Claude Code records the command in the session JSONL).
  const hook = (event) => [{ matcher: "*", hooks: [{ type: "command", command: `${shq(node)} ${shq(hookWrapper)} ${shq(event)}`, timeout: 60 }] }];
  const scoped = (p) => [`Read(/${p}/**)`, `Edit(/${p}/**)`];
  const darwinSpellings = (p) => (p.startsWith("/private/var/") ? [p, p.slice("/private".length)] : [p]);
  const projects = join(home, ".claude", "projects");
  return {
    permissions: {
      defaultMode: "dontAsk",
      // File tools only inside the workspace HOME (= cwd) and the sandbox TMPDIR (signer.md's scratch dir).
      allow: ["Bash", "TodoWrite", "Skill", `mcp__${MCP_SERVER}`, ...scoped(home), ...tmpSpellings(confine.sandboxTmp).flatMap(scoped), ...(confine.mktempGlobs ?? []).flatMap(darwinSpellings).flatMap(scoped)],
      // The session JSONL (hook attachments, tool results) under ~/.claude/projects is not the agent's to read.
      deny: ["WebFetch", "WebSearch", "Agent", "Task", "ToolSearch", ...confine.denyRead.flatMap(scoped), ...scoped(projects), `Edit(/${join(home, ".claude")}/**)`, `Edit(/${runRoot}/**)`],
    },
    sandbox: {
      enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false,
      network: { allowedDomains: ["127.0.0.1", "localhost"] },
      filesystem: { denyRead: [...confine.denyRead, projects], denyWrite: confine.denyWrite, allowRead: confine.allowRead },
    },
    hooks: { PreToolUse: hook("pre"), PostToolUse: hook("post"), PostToolUseFailure: hook("post"), PermissionDenied: hook("denied") },
  };
}

/** Is `p` equal to or below `dir`? */
const within = (p, dir) => p === dir || p.startsWith(dir.endsWith(sep) ? dir : dir + sep);
/** realpath of the deepest existing ancestor, plus the not-yet-existing remainder. */
function canonicalLoose(p) {
  const rest = [];
  let cur = p;
  while (!existsSync(cur)) { rest.unshift(basename(cur)); const up = dirname(cur); if (up === cur) break; cur = up; }
  return join(realpathSync(cur), ...rest);
}

/** Regular files under `d` (symlinks and HOME skipped). */
function filesUnder(d, skip, out = []) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (p === skip) continue;
    const st = lstatSync(p);
    if (st.isDirectory()) filesUnder(p, skip, out);
    else if (st.isFile()) out.push(p);
  }
  return out;
}

/**
 * Fail-closed hermeticity checks, run BEFORE the CLI is spawned (a violation is an adapter error, never a case
 * result): the canonical key path is inside HOME; the run root is 0700, outside HOME and HOME's parent, and denied to
 * the agent; the workspace is not inside a denied root; the only sohopay-signer on PATH is this run's; TMPDIR is a
 * platform default; the sandbox TMPDIR the CLI will export yields a trusted `mktemp -d` shape; nothing the agent can
 * reach names the run root or carries a canary or a token.
 */
export function assertHermetic(w) {
  const home = realpathSync(w.home);
  const key = canonicalLoose(join(w.home, KEY_REL));
  if (!within(key, home)) throw new HardError(`hermetic: canonical key path ${key} is outside HOME ${home}`);
  const runRoot = realpathSync(w.runRoot);
  if (within(runRoot, home) || within(runRoot, realpathSync(dirname(w.home)))) throw new HardError(`hermetic: run root ${runRoot} is reachable from HOME or HOME's parent`);
  if ((statSync(runRoot).mode & 0o077) !== 0) throw new HardError(`hermetic: run root ${runRoot} is not 0700`);
  const c = w.confine;
  if (!c.denyRead.includes(w.runRoot) || !c.denyWrite.includes(w.runRoot)) throw new HardError("hermetic: run root is not denied to the agent for read and write");
  if ([c.operatorHome, c.repoRoot].some((d) => within(realpathSync(w.prefix), d))) throw new HardError("hermetic: the workspace sits inside a root denied to the agent");
  const signers = findOnPath("sohopay-signer", w.env.PATH);
  const expected = existsSync(join(w.binDir, "sohopay-signer")) ? [join(w.binDir, "sohopay-signer")] : [];
  if (JSON.stringify(signers) !== JSON.stringify(expected)) throw new HardError(`hermetic: sohopay-signer on PATH ${JSON.stringify(signers)} != ${JSON.stringify(expected)}`);
  if (w.env.TMPDIR !== undefined && !DEFAULT_TMPDIR_RE.test(w.env.TMPDIR)) throw new HardError(`hermetic: TMPDIR ${w.env.TMPDIR} is not a platform default`);
  if (w.env.CLAUDE_CODE_TMPDIR !== undefined || w.env.CLAUDE_TMPDIR !== undefined) throw new HardError("hermetic: the sandbox TMPDIR must be the CLI default (CLAUDE_CODE_TMPDIR / CLAUDE_TMPDIR set)");
  const sbx = sandboxTmpDir(w.env);
  const probe = { type: "tool_call", name: "Bash", args_text: "mktemp -d" };
  if (sbx !== c.sandboxTmp || !trustedMktempDir(probe, { name: "Bash", ok: true, stdout: `${sbx}/tmp.AbCd1234Ef\n` }, () => false)) {
    throw new HardError(`hermetic: sandbox TMPDIR ${sbx} does not give a trusted mktemp -d shape`);
  }
  const secrets = [w.run.canaries.private_key, w.run.canaries.header_value, runRoot, w.runRoot, w.ctlToken, w.mcpToken];
  for (const f of filesUnder(w.prefix, w.home)) {
    const body = readFileSync(f, "utf8");
    if (secrets.some((s) => body.includes(s))) throw new HardError(`hermetic: ${f} names the run root or carries a canary or token`);
  }
}

/**
 * Build the world for one sample. Returns { run, runRoot, prefix, home, binDir, env, urls, paths, confine, ctlToken,
 * fetchState, cleanup }. `cleanup()` stops the backend and removes both roots.
 */
export async function createWorld({ suiteDir, caseId, skillsRoot }) {
  const base = runRootBase();
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const runRoot = realpathSync(mkdtempSync(join(base, "sp6-run-")));
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
    const paths = {
      runPath: join(runRoot, "run.json"), tokens: join(runRoot, "ctl.token"), settings: join(runRoot, "settings.json"), mcp: join(runRoot, "mcp.json"),
      stream: join(runRoot, "stream.jsonl"), stderr: join(runRoot, "claude.stderr"), audit: join(runRoot, "audit.strace"), privateDir: join(runRoot, "host-private"),
    };
    writeFileSync(paths.runPath, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
    mkdirSync(paths.privateDir, { mode: 0o700 });
    const ctlToken = randomBytes(32).toString("hex");
    const clientToken = randomBytes(24).toString("hex");
    const mcpToken = randomBytes(32).toString("hex");
    // N2: the signer host's confinement — the agent's sandbox set: HOME, the sandbox TMPDIR, fresh mktemp dirs — minus
    // what the sandbox denies inside them (the operator's pre-existing /tmp/claude-<uid> entries, …).
    const confine = confinement({ home, runRoot, prefix });
    const policy = {
      home, roots: [home, ...tmpSpellings(sandboxTmpDir({}))], mktemp: [MKTEMP_DIR_RE.source.replace(/^\^/, "").replace(/\$$/, "")],
      deny: confine.denyRead.filter((d) => !confine.allowRead.some((a) => a.startsWith(d + sep))),
    };
    writeFileSync(paths.tokens, JSON.stringify({ ctl: ctlToken, client: clientToken, mcp: mcpToken, policy, privateDir: paths.privateDir }), { mode: 0o600 });
    seedHome(run);
    backend = await startBackend(paths.runPath, paths.tokens, ctlToken);
    const binDir = installSigner(run, prefix, backend.urls.signer, clientToken);
    const skills = installSkills(suiteDir, skillsRoot, home);
    const env = agentEnv({ home, binDir });
    // N4: Claude Code sends the bearer from this (agent-denied) config; an agent curl to /mcp has none.
    writeFileSync(paths.mcp, JSON.stringify({ mcpServers: { [MCP_SERVER]: { type: "http", url: backend.urls.mcp, headers: { Authorization: `Bearer ${mcpToken}` } } } }), { mode: 0o600 });
    const hookWrapper = installHookWrapper(base);
    return { scenario, run, runRoot, base, prefix, home, binDir, env, urls: backend.urls, paths, skills, confine, ctlToken, mcpToken, hookWrapper, fetchState: backend.fetchState, cleanup };
  } catch (e) {
    await cleanup();
    throw e;
  }
}

/** Write the run's settings file. */
export function writeSettings(w) {
  writeFileSync(w.paths.settings, JSON.stringify(runSettings({ runRoot: w.runRoot, home: w.home, hookWrapper: w.hookWrapper, node: process.execPath, confine: w.confine }), null, 2), { mode: 0o600 });
}
