// The hermetic world (cc-world.mjs): its positive shape, every pre-spawn assertion failing closed when the world is
// tampered with (items 11, 12, 14, 15), the confinement + egress settings the CLI is given (items 12, 18; fix I5,
// I6), and the installed signer looking like a normal npm-global install that forwards no secrets (fix M1).
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HardError } from "../schema.mjs";
import { buildRun, findOnPath, KEY_REL } from "../../mock/run-config.mjs";
import { loadScenario } from "../../mock/scenarios/index.mjs";
import { SERVER_INSTRUCTIONS, TOOL_CATALOG } from "../../mock/lib/tool-catalog.mjs";
import { agentEnv, assertHermetic, confinement, createWorld, installSigner, runSettings, sandboxTmpDir, writeSettings } from "./cc-world.mjs";

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "plugins", "sohopay", "skills");
const EVAL_WORDS = /\bmock\b|\bsp6\b|canary|\beval(?:s|uation)?\b|grader|adversarial/i;

async function withWorld(caseId, suiteDir, fn) {
  const w = await createWorld({ suiteDir, caseId, skillsRoot: SKILLS });
  try { writeSettings(w); await fn(w); } finally { await w.cleanup(); }
  for (const d of [w.runRoot, w.prefix]) assert.throws(() => statSync(d), "removed by cleanup");
}
/** Regular files under d (symlinks are recorded by their own test, never followed). */
const walk = (d, out = []) => { for (const n of readdirSync(d)) { const p = join(d, n); const st = lstatSync(p); if (st.isDirectory()) walk(p, out); else if (st.isFile()) out.push(p); } return out; };

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
  assert.equal(env.ANTHROPIC_API_KEY, "k");
  assert.equal(env.PATH, "/w/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  assert.ok(!("SOHOPAY_SIGNER" in env) && !("AWS_SECRET_ACCESS_KEY" in env) && !("CLAUDE_CODE_TMPDIR" in env));
  assert.equal(agentEnv({ home: "/h", binDir: "/b" }, { TMPDIR: "/private/tmp/claude-501/sandbox" }).TMPDIR, undefined, "a non-default TMPDIR is dropped");
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
