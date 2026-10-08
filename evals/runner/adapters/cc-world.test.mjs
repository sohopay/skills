// The hermetic world (cc-world.mjs): its positive shape, every pre-spawn assertion failing closed when the world is
// tampered with (items 11, 12, 14, 15), the confinement + egress settings the CLI is given (items 12, 18; fix I5,
// I6), and the installed signer looking like a normal npm-global install that forwards no secrets (fix M1).
import test from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HardError } from "../schema.mjs";
import { buildRun, findOnPath, KEY_REL } from "../../mock/run-config.mjs";
import { loadScenario } from "../../mock/scenarios/index.mjs";
import { SERVER_INSTRUCTIONS, TOOL_CATALOG } from "../../mock/lib/tool-catalog.mjs";
import { signerChildEnv } from "../../mock/lib/signer-sandbox.mjs";
import { AGENT_ENV_KEYS, BACKEND_ENV_KEYS, agentEnv, backendEnv, assertHermetic, confinement, createWorld, installSigner, runSettings, sandboxFilesystem, sandboxTmpDir, signerPolicy, writeSettings } from "./cc-world.mjs";

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "plugins", "sohopay", "skills");
const EVAL_WORDS = /\bmock\b|\bsp6\b|canary|\beval(?:s|uation)?\b|grader|adversarial/i;

async function withWorld(caseId, suiteDir, fn) {
  const w = await createWorld({ suiteDir, caseId, skillsRoot: SKILLS });
  try { writeSettings(w); await fn(w); } finally { await w.cleanup(); }
  for (const d of [w.runRoot, w.prefix]) assert.throws(() => statSync(d), "removed by cleanup");
}
/** Regular files under d (symlinks are recorded by their own test, never followed). */
const walk = (d, out = []) => { for (const n of readdirSync(d)) { const p = join(d, n); const st = lstatSync(p); if (st.isDirectory()) walk(p, out); else if (st.isFile()) out.push(p); } return out; };

/** A live process's environment as NAME=value strings (Linux /proc; macOS `ps -E` for our own child). */
function processEnv(pid) {
  if (process.platform === "linux") return readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").filter(Boolean);
  const out = execFileSync("ps", ["-E", "-ww", "-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return out.trim().split(/\s+/).filter((t) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
}

test("T17 m3: the mock backend is spawned with an ALLOWLISTED env — no API key, no token, nothing credential-shaped", () => {
  const parent = {
    PATH: "/usr/bin:/bin", HOME: "/h", LANG: "C", TMPDIR: "/tmp", USER: "u", LOGNAME: "u", SP6_SIMULATE_NO_SANDBOX: "1",
    ANTHROPIC_API_KEY: "sk-ant-x", CLAUDE_CODE_OAUTH_TOKEN: "o", GITHUB_TOKEN: "g", ACTIONS_RUNTIME_TOKEN: "r", NODE_AUTH_TOKEN: "n", AWS_SECRET_ACCESS_KEY: "s", SP6_LIVE: "1", NODE_OPTIONS: "--import=/evil.mjs",
  };
  const env = backendEnv(parent);
  for (const k of Object.keys(env)) assert.ok(BACKEND_ENV_KEYS.includes(k), `${k} not allowlisted`);
  assert.deepEqual(env, { PATH: "/usr/bin:/bin", HOME: "/h", LANG: "C", TMPDIR: "/tmp", USER: "u", LOGNAME: "u", SP6_SIMULATE_NO_SANDBOX: "1", UV_USE_IO_URING: "0" }, "sandbox detection inputs pass; credentials and NODE_OPTIONS do not");
});

test("R2-9: every process the adapter world starts runs with UV_USE_IO_URING=0 (libuv's file-op io_uring off) — the agent env, the backend, the signer child; never the parent's value", () => {
  for (const parent of [{}, { UV_USE_IO_URING: "1" }]) {
    assert.equal(agentEnv({ home: "/w/home", binDir: "/w/bin" }, parent).UV_USE_IO_URING, "0", "the CLI, its hooks and every agent tool subprocess inherit it");
    assert.equal(backendEnv(parent).UV_USE_IO_URING, "0");
  }
  assert.ok(AGENT_ENV_KEYS.includes("UV_USE_IO_URING") && BACKEND_ENV_KEYS.includes("UV_USE_IO_URING"));
  assert.deepEqual(signerChildEnv("/w/home"), { HOME: "/w/home", PATH: "/usr/bin:/bin", UV_USE_IO_URING: "0" });
});

test("[E2E] T17 m3: the running backend process holds no harness credential", async () => {
  const saved = { a: process.env.ANTHROPIC_API_KEY, g: process.env.GITHUB_TOKEN };
  process.env.ANTHROPIC_API_KEY = ["sk", "ant", "backend-must-not-see-this-0123456789"].join("-"); // assembled: committed-secrets
  process.env.GITHUB_TOKEN = "ghs_backendMustNotSeeThis0123456789";
  try {
    await withWorld("key-opacity", "sohopay-x402", async (w) => {
      assert.ok(Number.isInteger(w.backendPid), "createWorld exposes the backend pid");
      const env = processEnv(w.backendPid);
      assert.ok(env.some((e) => e.startsWith("PATH=")), `env read: ${env.slice(0, 3)}`);
      assert.ok(!env.some((e) => /^(ANTHROPIC_API_KEY|GITHUB_TOKEN|CLAUDE_CODE_OAUTH_TOKEN)=/.test(e)), env.join(" "));
      assert.ok(!env.join("\n").includes("must-not-see") && !env.join("\n").includes("MustNotSee"));
    });
  } finally {
    for (const [k, v] of [["ANTHROPIC_API_KEY", saved.a], ["GITHUB_TOKEN", saved.g]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("positive: key inside HOME, run root 0700 / outside HOME's parent / not under /tmp / no trust artifacts on disk, one signer", async () => {
  await withWorld("key-opacity", "sohopay-x402", async (w) => {
    assertHermetic(w);
    assert.ok(realpathSync(join(w.home, KEY_REL)).startsWith(realpathSync(w.home) + "/"));
    assert.equal(statSync(w.runRoot).mode & 0o777, 0o700);
    assert.ok(!w.runRoot.startsWith(dirname(w.home) + "/") && !w.runRoot.startsWith(w.home));
    assert.ok(!/^(?:\/private)?\/tmp\//.test(w.runRoot), w.runRoot);
    assert.deepEqual(readdirSync(w.runRoot).sort(), ["ctl.token", "host-private", "mcp.json", "run.json", "settings.json"]);
    assert.deepEqual(findOnPath("sohopay-signer", w.env.PATH), [join(w.binDir, "sohopay-signer")]);
    for (const s of ["sohopay-x402", "sohopay-onboard"]) assert.ok(statSync(join(w.home, ".claude", "skills", s, "SKILL.md")).isFile(), s);
    assert.equal(w.env.HOME, w.home);
    for (const f of walk(w.prefix).filter((p) => !p.startsWith(w.home))) {
      const body = readFileSync(f, "utf8");
      assert.ok(!EVAL_WORDS.test(body), `${f} carries eval vocabulary`);
      assert.ok(!body.includes(w.runRoot) && !body.includes(w.run.canaries.private_key) && !body.includes(w.ctlToken), `${f} names the run root, a canary or the control token`);
    }
  });
});

test("M1: the signer installs like npm does — bin symlinks into lib/node_modules, node on PATH", async () => {
  await withWorld("key-opacity", "sohopay-x402", async (w) => {
    const bin = join(w.binDir, "sohopay-signer");
    assert.ok(lstatSync(bin).isSymbolicLink());
    assert.equal(readlinkSync(bin), "../lib/node_modules/@sohopay/agent-signer/dist/cli/index.js");
    assert.ok(lstatSync(join(w.binDir, "node")).isSymbolicLink());
    assert.match(readFileSync(bin, "utf8"), /^#!\/usr\/bin\/env node\n/);
  });
});

test("M1: the installed client forwards an env ALLOWLIST (HOME, SOHOPAY_*), never API keys or tokens", async (t) => {
  const prefix = realpathSync(mkdtempSync(join(tmpdir(), "cc-client-")));
  t.after(() => rmSync(prefix, { recursive: true, force: true }));
  let got = null;
  const srv = createServer((req, res) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => { got = { headers: req.headers, body: JSON.parse(Buffer.concat(c).toString()) }; res.end(JSON.stringify({ stdout: "ok\n", stderr: "", exitCode: 0 })); }); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const run = buildRun(await loadScenario("key-opacity"), { runDir: prefix, home: join(prefix, "home") });
    const binDir = installSigner(run, prefix, `http://127.0.0.1:${srv.address().port}`, "c".repeat(48));
    const env = { PATH: `${binDir}:/usr/bin:/bin`, HOME: join(prefix, "home"), SOHOPAY_SIGNER_KEY_ROOTS: "/k", ANTHROPIC_API_KEY: "sk-ant-x", CLAUDE_CODE_OAUTH_TOKEN: "o", GITHUB_TOKEN: "g", FOO: "bar" };
    // Async spawn: the capture server lives in THIS process, so a sync spawn would deadlock it (item 13).
    const stdout = await new Promise((resolve, reject) => execFile(join(binDir, "sohopay-signer"), ["capabilities"], { env }, (e, out) => (e ? reject(e) : resolve(out))));
    assert.equal(stdout, "ok\n");
    assert.deepEqual(Object.keys(got.body.env).sort(), ["HOME", "SOHOPAY_SIGNER_KEY_ROOTS"]);
    assert.equal(got.headers["x-signer-client"], "c".repeat(48));
  } finally { await new Promise((r) => srv.close(r)); }
});

test("negative: each tampering is an adapter error before spawning", async () => {
  await withWorld("keygen-routes-to-signer", "sohopay-onboard", async (w) => {
    const outside = join(w.prefix, "elsewhere");
    mkdirSync(outside);
    symlinkSync(outside, join(w.home, ".agents"));
    assert.throws(() => assertHermetic(w), (e) => e instanceof HardError && /outside HOME/.test(e.message));
  });
  await withWorld("keygen-routes-to-signer", "sohopay-onboard", async (w) => {
    const other = join(w.prefix, "other-bin");
    mkdirSync(other);
    writeFileSync(join(other, "sohopay-signer"), "#!/bin/sh\n", { mode: 0o755 });
    assert.throws(() => assertHermetic({ ...w, env: { ...w.env, PATH: `${w.env.PATH}:${other}` } }), /sohopay-signer on PATH/);
  });
  await withWorld("keygen-routes-to-signer", "sohopay-onboard", async (w) => {
    chmodSync(w.runRoot, 0o755);
    assert.throws(() => assertHermetic(w), /not 0700/);
    chmodSync(w.runRoot, 0o700);
    assert.throws(() => assertHermetic({ ...w, env: { ...w.env, TMPDIR: "/private/tmp/claude-501/x" } }), /TMPDIR/);
    assert.throws(() => assertHermetic({ ...w, env: { ...w.env, CLAUDE_CODE_TMPDIR: "/var/x" } }), /sandbox TMPDIR/);
    assert.throws(() => assertHermetic({ ...w, env: { ...w.env, CLAUDE_TMPDIR: "/tmp/x" } }), /sandbox TMPDIR/);
    writeFileSync(join(w.binDir, "notes"), w.run.canaries.header_value);
    assert.throws(() => assertHermetic(w), /canary/);
  });
  await withWorld("keygen-routes-to-signer", "sohopay-onboard", async (w) => {
    const inside = join(w.prefix, "run");
    mkdirSync(inside, { mode: 0o700 });
    assert.throws(() => assertHermetic({ ...w, runRoot: inside }), /reachable from HOME/);
  });
});

test("I2: the sandbox TMPDIR the CLI will export is <CLAUDE_CODE_TMPDIR or /tmp>/claude-<uid>; the agent env leaves it default", () => {
  assert.equal(sandboxTmpDir({}, 501), "/tmp/claude-501");
  assert.equal(sandboxTmpDir({ CLAUDE_CODE_TMPDIR: "/x" }, 7), "/x/claude-7");
  assert.equal(sandboxTmpDir({ CLAUDE_TMPDIR: "/y" }, 7), "/y/claude-7");
  const env = agentEnv({ home: "/w/home", binDir: "/w/bin" }, { TMPDIR: "/var/folders/ab/cd/T/", ANTHROPIC_API_KEY: "k", SOHOPAY_SIGNER: "/evil", AWS_SECRET_ACCESS_KEY: "s", USER: "u", PATH: "/opt/x", CLAUDE_CODE_TMPDIR: "/q" });
  assert.equal(env.TMPDIR, "/var/folders/ab/cd/T/");
  assert.equal(env.ANTHROPIC_API_KEY, undefined, "C1: the CLI gets its key through apiKeyHelper, never through env");
  assert.equal(env.PATH, "/w/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  assert.ok(!("SOHOPAY_SIGNER" in env) && !("AWS_SECRET_ACCESS_KEY" in env) && !("CLAUDE_CODE_TMPDIR" in env));
  assert.equal(agentEnv({ home: "/h", binDir: "/b" }, { TMPDIR: "/private/tmp/claude-501/sandbox" }).TMPDIR, undefined, "a non-default TMPDIR is dropped");
});

test("C1: agentEnv is an ALLOWLIST — no credential of any kind (API key, OAuth, GitHub / Actions / npm tokens, *_KEY / *_TOKEN / *_SECRET) reaches the CLI or its tool subprocesses", () => {
  const parent = {
    ANTHROPIC_API_KEY: "sk-ant-api03-x", CLAUDE_CODE_OAUTH_TOKEN: "o", ANTHROPIC_AUTH_TOKEN: "a", GITHUB_TOKEN: "g", GH_TOKEN: "h",
    ACTIONS_RUNTIME_TOKEN: "r", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "i", NODE_AUTH_TOKEN: "n", AWS_SECRET_ACCESS_KEY: "s", MY_SECRET: "m",
    SOME_PASSWORD: "p", GITHUB_ACTIONS: "true", CI: "true", SP6_LIVE: "1", LANG: "C.UTF-8", USER: "runner", LOGNAME: "runner", TMPDIR: "/tmp",
  };
  const env = agentEnv({ home: "/w/home", binDir: "/w/bin" }, parent);
  assert.deepEqual(Object.keys(env).sort(), [...AGENT_ENV_KEYS].sort().filter((k) => k in env));
  for (const k of Object.keys(env)) assert.ok(AGENT_ENV_KEYS.includes(k), `${k} is not on the allowlist`);
  assert.ok(!Object.keys(env).some((k) => /(KEY|TOKEN|SECRET|PASSWORD)$/.test(k)), Object.keys(env).join(","));
  assert.ok(!Object.values(env).some((v) => ["sk-ant-api03-x", "o", "a", "g", "h", "r", "i", "n", "s", "m", "p"].includes(v)));
});

test("C1: the CLI's credential is an apiKeyHelper reading a 0600 key file in the agent-denied run root; no helper without a key", () => {
  const confine = { operatorHome: "/u/op", repoRoot: "/u/op/repo", sandboxTmp: "/tmp/claude-501", denyRead: ["/u/op", "/r/run"], denyWrite: ["/r/run"], allowRead: [] };
  const s = runSettings({ runRoot: "/r/run", home: "/w/h", hookWrapper: "/b/hook.mjs", node: "/n/node", confine, apiKeyFile: "/r/run/api-key" });
  assert.equal(s.apiKeyHelper, "/bin/cat '/r/run/api-key'");
  assert.ok(s.sandbox.filesystem.denyRead.includes("/r/run") && s.permissions.deny.includes("Read(//r/run/**)"), "the key file is unreachable from the agent");
  assert.equal(runSettings({ runRoot: "/r/run", home: "/w/h", hookWrapper: "/b/hook.mjs", node: "/n/node", confine }).apiKeyHelper, undefined);
  assert.throws(() => runSettings({ runRoot: "/r/run", home: "/w/h", hookWrapper: "/b/hook.mjs", node: "/n/node", confine, apiKeyFile: "/w/h/api-key" }), /inside the run root/);
});

test("I5/I6 settings: file tools confined to HOME + the sandbox TMPDIR; operator home, repo, run root, other claude temp dirs denied", () => {
  const confine = { operatorHome: "/u/op", repoRoot: "/u/op/repo", sandboxTmp: "/tmp/claude-501", denyRead: ["/u/op", "/u/op/repo", "/r/run", "/tmp/claude-501/old-session", "/tmp/claude-0"], denyWrite: ["/r/run", "/u/op", "/u/op/repo", "/w/h/.claude"], allowRead: [] };
  const s = runSettings({ runRoot: "/r/run", home: "/w/h", hookWrapper: "/b/hook.mjs", node: "/n/node", confine });
  assert.equal(s.permissions.defaultMode, "dontAsk");
  for (const a of ["Bash", "Skill", "TodoWrite", "mcp__sohopay", "Read(//w/h/**)", "Edit(//w/h/**)", "Read(//tmp/claude-501/**)", "Edit(//tmp/claude-501/**)"]) assert.ok(s.permissions.allow.includes(a), a);
  for (const bare of ["Read", "Write", "Edit", "Glob", "Grep", "MultiEdit"]) assert.ok(!s.permissions.allow.includes(bare), `no unscoped ${bare}`);
  for (const d of ["WebFetch", "WebSearch", "Agent", "Task", "ToolSearch", "Read(//r/run/**)", "Edit(//r/run/**)", "Read(//u/op/**)", "Edit(//u/op/**)", "Read(//u/op/repo/**)", "Read(//tmp/claude-501/old-session/**)", "Read(//tmp/claude-0/**)", "Edit(//w/h/.claude/**)"]) assert.ok(s.permissions.deny.includes(d), d);
  assert.deepEqual(s.sandbox.network.allowedDomains, ["127.0.0.1", "localhost"]);
  assert.equal(s.sandbox.enabled, true);
  assert.equal(s.sandbox.failIfUnavailable, true);
  assert.equal(s.sandbox.allowUnsandboxedCommands, false);
  assert.deepEqual(s.sandbox.filesystem.denyRead, [...confine.denyRead, "/w/h/.claude/projects"], "N1: session JSONL (hook commands) unreadable");
  for (const d of ["Read(//w/h/.claude/projects/**)", "Edit(//w/h/.claude/projects/**)"]) assert.ok(s.permissions.deny.includes(d), d);
  assert.deepEqual(s.sandbox.filesystem.denyWrite, confine.denyWrite);
  assert.equal(s.sandbox.filesystem.allowWrite, undefined, "no extra writable roots");
  for (const ev of ["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionDenied"]) {
    const cmd = s.hooks[ev][0].hooks[0].command;
    assert.match(cmd, /^'\/n\/node' '\/b\/hook\.mjs' '(pre|post|denied)'$/, ev);
    assert.ok(!cmd.includes("/r/run"), "N1: no run-root path (or token) in any hook command");
  }
});

test("I6: the confinement lists come from the HARNESS (operator home, repo checkout, existing claude temp dirs)", async () => {
  await withWorld("key-opacity", "sohopay-x402", async (w) => {
    const c = w.confine;
    assert.equal(c.operatorHome, realpathSync(homedir()));
    assert.ok(c.denyRead.includes(c.operatorHome) && c.denyRead.includes(c.repoRoot) && c.denyRead.includes(w.runRoot));
    assert.ok(c.denyWrite.includes(w.runRoot));
    assert.ok(statSync(join(c.repoRoot, "evals", "runner", "run.mjs")).isFile(), "repoRoot is the checkout");
    assert.equal(c.sandboxTmp, `/tmp/claude-${process.getuid()}`);
    assert.ok(!c.denyRead.includes(c.sandboxTmp), "the agent's own sandbox TMPDIR stays usable");
  });
});

test("the mock MCP surface reads like the real server: no eval vocabulary in tool descriptions or instructions", () => {
  assert.ok(!EVAL_WORDS.test(SERVER_INSTRUCTIONS));
  for (const [name, t] of Object.entries(TOOL_CATALOG)) assert.ok(!EVAL_WORDS.test(JSON.stringify(t)), name);
});

test("N9/R2-6 (macOS best effort): pre-existing $TMPDIR entries are denied one by one; no allowRead prefix covers ~/.claude/projects", () => {
  const listing = ["agent-home-1", "other-run", "tmp.ABC123", "op.txt"];
  const c = confinement({ home: "/T/agent-home-1/home", runRoot: "/r/run", prefix: "/T/agent-home-1", base: "/u/op/.cache/sp6-live", platform: "darwin", tmp: "/T", listTmp: () => listing });
  for (const d of ["/T/other-run", "/T/tmp.ABC123", "/T/op.txt"]) assert.ok(c.denyRead.includes(d), d);
  assert.ok(!c.denyRead.includes("/T") && !c.denyRead.includes("/T/agent-home-1"), "this run's workspace stays readable without an allow");
  const projects = "/T/agent-home-1/home/.claude/projects";
  assert.ok(!c.allowRead.some((p) => projects === p || projects.startsWith(`${p.replace(/\*.*$/, "")}`)), `no allowRead entry covers ${projects}: ${c.allowRead}`);
  const s = runSettings({ runRoot: "/r/run", home: "/T/agent-home-1/home", hookWrapper: "/b/hook.mjs", node: "/n/node", confine: c });
  for (const r of ["Read(//T/tmp.*/**)", "Edit(//T/tmp.*/**)"]) assert.ok(s.permissions.allow.includes(r), r);
  assert.ok(s.permissions.deny.includes("Read(//T/tmp.ABC123/**)"), "a pre-existing tmp.* dir stays denied (deny beats allow in permissions)");
  const linux = confinement({ home: "/tmp/agent-home-1/home", runRoot: "/r/run", prefix: "/tmp/agent-home-1", base: "/u/op/.cache/sp6-live", platform: "linux", tmp: "/tmp", listTmp: () => [] });
  assert.ok(!linux.denyRead.includes("/tmp"), "linux: the sandbox TMPDIR lives under /tmp");
});

test("R2-7: the run base (relay registry, hook wrapper) is denied explicitly, and assertHermetic refuses a base the agent can read", async () => {
  const c = confinement({ home: "/w/home", runRoot: "/b/run", prefix: "/w", base: "/b", platform: "linux", tmp: "/tmp", listTmp: () => [] });
  assert.ok(c.denyRead.includes("/b") && c.denyWrite.includes("/b"));
  await withWorld("keygen-routes-to-signer", "sohopay-onboard", async (w) => {
    for (const base of [join(w.home, "x"), join(w.prefix, "x"), join(c.sandboxTmp ?? "/tmp/claude-0", "x")]) {
      assert.throws(() => assertHermetic({ ...w, base }), (e) => e instanceof HardError && /run base/.test(e.message), base);
    }
    assert.ok(w.confine.denyRead.includes(w.base) && w.confine.denyWrite.includes(w.base));
  });
});

test("R3-2: the signer child / pre-check policy and the agent's sandbox filesystem come from ONE source and are equal (projects dir included)", async () => {
  await withWorld("key-opacity", "sohopay-x402", async (w) => {
    // The artifacts the run actually uses: the settings file the CLI gets and the tokens file the signer host gets.
    const settings = JSON.parse(readFileSync(w.paths.settings, "utf8"));
    const { policy } = JSON.parse(readFileSync(w.paths.tokens, "utf8"));
    const fs = settings.sandbox.filesystem;
    assert.deepEqual({ denyRead: policy.denyRead, denyWrite: policy.denyWrite, allowRead: policy.allowRead }, { denyRead: fs.denyRead, denyWrite: fs.denyWrite, allowRead: fs.allowRead });
    assert.ok(policy.denyRead.includes(join(w.home, ".claude", "projects")), "the session JSONL dir is denied to the signer child too");
    assert.deepEqual(sandboxFilesystem(w.confine, w.home), { denyRead: fs.denyRead, denyWrite: fs.denyWrite, allowRead: fs.allowRead });
    const p = signerPolicy({ home: w.home, confine: w.confine, since: 1 });
    assert.deepEqual([p.denyRead, p.denyWrite, p.allowRead], [fs.denyRead, fs.denyWrite, fs.allowRead]);
  });
});

test("R3-4: a sandbox path with a control character (e.g. a $TMPDIR entry named c\\x01x) is an adapter error before spawning", async () => {
  await withWorld("key-opacity", "sohopay-x402", async (w) => {
    assert.doesNotThrow(() => assertHermetic(w));
    const confine = { ...w.confine, denyRead: [...w.confine.denyRead, "/var/folders/ab/cd/T/c\x01x"] };
    assert.throws(() => assertHermetic({ ...w, confine }), (e) => e instanceof HardError && /control character/.test(e.message));
  });
});
