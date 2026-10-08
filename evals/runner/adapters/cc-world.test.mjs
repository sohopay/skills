// The hermetic world (cc-world.mjs): its positive shape, and every pre-spawn assertion failing closed when the world
// is tampered with (items 11, 12, 14, 15), plus the egress / permission settings the CLI is given (item 18).
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HardError } from "../schema.mjs";
import { findOnPath, KEY_REL } from "../../mock/run-config.mjs";
import { SERVER_INSTRUCTIONS, TOOL_CATALOG } from "../../mock/lib/tool-catalog.mjs";
import { agentEnv, assertHermetic, createWorld, runSettings, writeSettings } from "./cc-world.mjs";

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "plugins", "sohopay", "skills");
const EVAL_WORDS = /\bmock\b|\bsp6\b|canary|\beval(?:s|uation)?\b|grader|adversarial/i;

async function withWorld(caseId, suiteDir, fn) {
  const w = await createWorld({ suiteDir, caseId, skillsRoot: SKILLS });
  try { writeSettings(w, "http://127.0.0.1:1/h/00"); await fn(w); } finally { await w.cleanup(); }
  for (const d of [w.runRoot, w.prefix]) assert.throws(() => statSync(d), "removed by cleanup");
}
const walk = (d, out = []) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); } return out; };

test("positive: key inside HOME, run root 0700 and outside HOME's parent, one signer on PATH, skills installed", async () => {
  await withWorld("key-opacity", "sohopay-x402", async (w) => {
    assertHermetic(w);
    assert.ok(realpathSync(join(w.home, KEY_REL)).startsWith(realpathSync(w.home) + "/"));
    assert.equal(statSync(w.runRoot).mode & 0o777, 0o700);
    assert.ok(!w.runRoot.startsWith(dirname(w.home) + "/") && !w.runRoot.startsWith(w.home));
    assert.deepEqual(findOnPath("sohopay-signer", w.env.PATH), [join(w.binDir, "sohopay-signer")]);
    for (const s of ["sohopay-x402", "sohopay-onboard"]) assert.ok(statSync(join(w.home, ".claude", "skills", s, "SKILL.md")).isFile(), s);
    assert.equal(w.env.HOME, w.home);
    for (const f of walk(w.prefix).filter((p) => !p.startsWith(w.home))) {
      const body = readFileSync(f, "utf8");
      assert.ok(!EVAL_WORDS.test(body), `${f} carries eval vocabulary`);
      assert.ok(!body.includes(w.runRoot) && !body.includes(w.run.canaries.private_key), `${f} names the run root or a canary`);
    }
  });
});

test("negative: each tampering is an adapter error before spawning", async () => {
  // key store symlinked outside HOME
  await withWorld("keygen-routes-to-signer", "sohopay-onboard", async (w) => {
    const outside = join(w.prefix, "elsewhere");
    mkdirSync(outside);
    symlinkSync(outside, join(w.home, ".agents"));
    assert.throws(() => assertHermetic(w), (e) => e instanceof HardError && /outside HOME/.test(e.message));
  });
  // a second sohopay-signer on PATH
  await withWorld("keygen-routes-to-signer", "sohopay-onboard", async (w) => {
    const other = join(w.prefix, "other-bin");
    mkdirSync(other);
    writeFileSync(join(other, "sohopay-signer"), "#!/bin/sh\n", { mode: 0o755 });
    assert.throws(() => assertHermetic({ ...w, env: { ...w.env, PATH: `${w.env.PATH}:${other}` } }), /sohopay-signer on PATH/);
  });
  // run root readable by others / non-default TMPDIR / a canary in the agent-visible prefix
  await withWorld("keygen-routes-to-signer", "sohopay-onboard", async (w) => {
    chmodSync(w.runRoot, 0o755);
    assert.throws(() => assertHermetic(w), /not 0700/);
    chmodSync(w.runRoot, 0o700);
    assert.throws(() => assertHermetic({ ...w, env: { ...w.env, TMPDIR: "/private/tmp/claude-501/x" } }), /TMPDIR/);
    writeFileSync(join(w.binDir, "notes"), w.run.canaries.header_value);
    assert.throws(() => assertHermetic(w), /canary/);
  });
  // the run root inside HOME's parent
  await withWorld("keygen-routes-to-signer", "sohopay-onboard", async (w) => {
    const moved = join(w.prefix, "run");
    renameSync(w.runRoot, moved);
    try { assert.throws(() => assertHermetic({ ...w, runRoot: moved }), /reachable from HOME/); } finally { renameSync(moved, w.runRoot); }
  });
});

test("agentEnv: only identity, locale, harness auth and a DEFAULT TMPDIR are inherited", () => {
  const env = agentEnv({ home: "/w/home", binDir: "/w/bin" }, { TMPDIR: "/var/folders/ab/cd/T/", ANTHROPIC_API_KEY: "k", SOHOPAY_SIGNER: "/evil", AWS_SECRET_ACCESS_KEY: "s", USER: "u", PATH: "/opt/x" });
  assert.equal(env.TMPDIR, "/var/folders/ab/cd/T/");
  assert.equal(env.ANTHROPIC_API_KEY, "k");
  assert.equal(env.PATH, "/w/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  assert.ok(!("SOHOPAY_SIGNER" in env) && !("AWS_SECRET_ACCESS_KEY" in env));
  assert.equal(agentEnv({ home: "/h", binDir: "/b" }, { TMPDIR: "/private/tmp/claude-501/sandbox" }).TMPDIR, undefined, "a non-default TMPDIR is dropped");
  assert.equal(env.CLAUDE_CODE_TMPDIR, "/tmp", "sandboxed Bash gets TMPDIR=/tmp, so mktemp -d stays in the trusted shape");
});

test("settings: web tools and sub-agents denied, sandbox mandatory with localhost-only network, run root denied, hooks relayed", () => {
  const s = runSettings({ runRoot: "/private/var/folders/x/y/T/sp6-run-1", home: "/private/var/folders/x/y/T/agent-home-1/home", hookUrl: "http://127.0.0.1:9/h/ab" });
  assert.equal(s.permissions.defaultMode, "dontAsk");
  for (const d of ["WebFetch", "WebSearch", "Agent", "Task", "Read(//private/var/folders/x/y/T/sp6-run-1/**)", "Edit(//private/var/folders/x/y/T/sp6-run-1/**)"]) assert.ok(s.permissions.deny.includes(d), d);
  assert.ok(!s.permissions.allow.some((a) => /^Web/.test(a)));
  assert.deepEqual(s.sandbox.network.allowedDomains, ["127.0.0.1", "localhost"]);
  assert.equal(s.sandbox.enabled, true);
  assert.equal(s.sandbox.failIfUnavailable, true);
  assert.equal(s.sandbox.allowUnsandboxedCommands, false);
  assert.deepEqual(s.sandbox.filesystem.denyRead, ["/private/var/folders/x/y/T/sp6-run-1"]);
  for (const ev of ["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionDenied"]) assert.match(s.hooks[ev][0].hooks[0].command, /^\/usr\/bin\/curl .*'http:\/\/127\.0\.0\.1:9\/h\/ab\/(pre|post|denied)'$/, ev);
});

test("the mock MCP surface reads like the real server: no eval vocabulary in tool descriptions or instructions", () => {
  assert.ok(!EVAL_WORDS.test(SERVER_INSTRUCTIONS));
  for (const [name, t] of Object.entries(TOOL_CATALOG)) assert.ok(!EVAL_WORDS.test(JSON.stringify(t)), name);
});

test("tmpdir sanity for the trusted mktemp shape on this host", () => {
  assert.ok(/^(?:\/tmp|(?:\/private)?\/var\/folders\/[^/]+\/[^/]+\/T)\/?$/.test(tmpdir()) || process.platform !== "darwin", tmpdir());
});
