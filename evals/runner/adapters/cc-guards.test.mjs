// T15 fix round 1: fail-closed guards — the init message (I3, M7), the audit status on every claude-code transcript
// (I10), and budget precision (M6).
import test from "node:test";
import assert from "node:assert/strict";
import { HardError, validateTranscript } from "../schema.mjs";
import { auditRefusal, checkInit, claudeArgv, makeBudget, PINS, signerAuditError, signerAuditStatus, signerHostErrors } from "./claude-code.mjs";
import { harnessLeak, harnessSecrets } from "./cc-guards.mjs";

const GOOD = () => ({
  type: "system", subtype: "init", cwd: "/w/home", session_id: "s",
  tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "TodoWrite", "Skill", "mcp__sohopay__get_context", "mcp__sohopay__prepare_x402_payment"],
  mcp_servers: [{ name: "sohopay", status: "connected" }],
  model: PINS.MODEL_ID, permissionMode: "dontAsk", apiKeySource: "ANTHROPIC_API_KEY", claude_code_version: { VERSION: PINS.CLI_VERSION },
});
const refuses = (init, re) => assert.throws(() => checkInit(init), (e) => e instanceof HardError && re.test(e.message));

test("I3: a well-formed init passes (version as string or build-info object)", () => {
  checkInit(GOOD());
  checkInit({ ...GOOD(), claude_code_version: PINS.CLI_VERSION });
});

test("I3: no init message at all is a refusal", () => refuses(null, /no system\/init/));

test("I3: every expected field must be present and equal", () => {
  const without = (k) => { const g = GOOD(); delete g[k]; return g; };
  refuses(without("claude_code_version"), /CLI version/);
  refuses({ ...GOOD(), claude_code_version: "2.1.293" }, /CLI version/);
  refuses({ ...GOOD(), claude_code_version: { VERSION: "2.1.291" } }, /CLI version/);
  refuses(without("model"), /model/);
  refuses({ ...GOOD(), model: "claude-sonnet-5-5-20261001" }, /model/);
  refuses(without("permissionMode"), /permission mode/);
  refuses({ ...GOOD(), permissionMode: "bypassPermissions" }, /permission mode/);
  refuses(without("tools"), /tools/);
  refuses(without("mcp_servers"), /MCP servers/);
});

test("I3: denied tools and any non-mock MCP tool in `tools` are refusals", () => {
  for (const t of ["WebFetch", "WebSearch", "Agent", "Task", "ToolSearch"]) refuses({ ...GOOD(), tools: [...GOOD().tools, t] }, /tool/);
  refuses({ ...GOOD(), tools: [...GOOD().tools, "mcp__claude_ai_Gmail__send_message"] }, /non-mock MCP tool/);
});

test("I3: mcp_servers must be exactly [sohopay] and connected — claude.ai / managed connectors refuse", () => {
  refuses({ ...GOOD(), mcp_servers: [] }, /MCP servers/);
  refuses({ ...GOOD(), mcp_servers: [{ name: "sohopay", status: "failed" }] }, /MCP servers/);
  refuses({ ...GOOD(), mcp_servers: [{ name: "sohopay", status: "connected" }, { name: "claude.ai Gmail", status: "connected" }] }, /MCP servers/);
  refuses({ ...GOOD(), mcp_servers: [{ name: "corp-managed", status: "pending" }, { name: "sohopay", status: "connected" }] }, /MCP servers/);
});

const cc = (meta) => ({
  case_id: "c", suite: "s", meta: { adapter: "claude-code", adapter_version: "claude-code/1", skill_hash: "h", ...meta },
  secrets: { private_key: "p", header_value: "h" }, sensitive_paths: { key_path: "~/k" }, events: [{ i: 0, type: "stop", code: null }],
});

test("I10: a claude-code transcript (live capture or golden) must record meta.audit as available | unavailable", () => {
  assert.deepEqual(validateTranscript(cc({ audit: "available" })).errors, []);
  assert.deepEqual(validateTranscript(cc({ audit: "unavailable" })).errors, []);
  assert.ok(!validateTranscript(cc({})).ok);
  assert.ok(!validateTranscript(cc({ audit: "strace" })).ok);
  assert.ok(!validateTranscript(cc({ audit: "disabled" })).ok);
});

test("M6: a zero, negative or non-numeric cap is rejected; accounting and the per-run cap keep full precision", () => {
  for (const c of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => makeBudget(c), HardError, String(c));
  const b = makeBudget(10);
  b.add(0.1); b.add(0.2);
  assert.equal(b.spent, 0.1 + 0.2);
  assert.equal(b.left, 10 - (0.1 + 0.2));
  const a = claudeArgv({ prompt: "p", sessionId: "s", settings: "/s", mcpConfig: "/m", budgetLeftUsd: 0.00001234 });
  assert.equal(a[a.indexOf("--max-budget-usd") + 1], "0.00001234", "never rounded to 0.0000");
  const spent = makeBudget(1);
  spent.add(1);
  assert.ok(spent.exhausted(), "nothing left → no further run");
});

test("R2-1 fail closed: any signer /exec that could not run inside its OS sandbox makes the sample an adapter error", () => {
  const ok = { execs: [{ argv: ["capabilities"], at: 1, done: 2, opens: [], refusals: [], sandbox: "sandbox-exec" }, { malformed: "body", at: 3 }, { rejected: "token", at: 4 }] };
  assert.deepEqual(signerHostErrors(ok), []);
  const bad = { execs: [...ok.execs, { argv: ["voucher", "sign"], at: 5, done: 6, opens: [], refusals: [], sandboxFailed: true, sandboxError: "profile failed to load" }] };
  const errs = signerHostErrors(bad);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /without its OS sandbox.*profile failed to load/);
});

test("R3-3: a signer call that hit the per-call timeout makes the sample an adapter error", () => {
  const errs = signerHostErrors({ execs: [{ argv: ["payment-id", "--input"], at: 1, done: 2, opens: [], refusals: [], sandbox: "sandbox-exec", reachedChild: true, sandboxFailed: true, timedOut: true, sandboxError: "timed out after 20000 ms (process group killed)" }] });
  assert.equal(errs.length, 1);
  assert.match(errs[0], /payment-id --input timed out after 20000 ms/);
});

test("R3-1: an exec that ran under the test-only fake sandbox is an adapter error unless the run itself injected the fake", () => {
  const state = { execs: [{ argv: ["capabilities"], at: 1, done: 2, opens: [], refusals: [], sandbox: "fake", reachedChild: true }] };
  assert.match(signerHostErrors(state).join(";"), /test-only fake sandbox/);
  assert.match(signerHostErrors(state, {}).join(";"), /test-only fake sandbox/);
  assert.deepEqual(signerHostErrors(state, { allowFake: true }), []);
});

test("R3-6: signer_audit is 'child-strace' only when EVERY exec that reached the child was traced; none reached → 'no-signer-exec'", () => {
  const ran = (audit) => ({ argv: ["x"], at: 1, done: 2, opens: [], refusals: [], reachedChild: true, audit });
  assert.equal(signerAuditStatus([]), "no-signer-exec");
  assert.equal(signerAuditStatus([{ malformed: "body", at: 1 }, { argv: ["pop"], at: 1, done: 2, opens: [], refusals: [{ role: "key" }], audit: "unavailable" }]), "no-signer-exec", "pre-check refusals never reached a child");
  assert.equal(signerAuditStatus([ran("available"), ran("available")]), "child-strace");
  assert.equal(signerAuditStatus([ran("available"), ran("unavailable")]), "unavailable", "every, not some");
  assert.equal(signerAuditStatus([ran("unavailable")]), "unavailable");
});

test("R3-6: --require-audit / SP6_AUDIT=require also requires the signer child audit — before spawning and after the run", () => {
  const agentOk = { audit: "available", reason: null };
  assert.equal(auditRefusal({ audit: agentOk, childTrace: { ok: true } }), null);
  assert.match(auditRefusal({ audit: { audit: "unavailable", reason: "strace not installed" }, childTrace: { ok: true } }), /audit required but unavailable \(strace not installed\)/);
  assert.match(auditRefusal({ audit: agentOk, childTrace: { ok: false, reason: "bwrap not installed" } }), /signer audit required but unavailable \(bwrap not installed\)/);
  assert.equal(signerAuditError({ signer_audit: "child-strace" }), null);
  assert.equal(signerAuditError({ signer_audit: "no-signer-exec" }), null);
  assert.match(signerAuditError({ signer_audit: "unavailable" }), /signer audit required/);
});

// C1 defence in depth: the harness's own real secrets (the API key above all) must never leave in a transcript.
// Test-only key, assembled at runtime so no committed file carries an `sk-ant-` run (committed-secrets.test.mjs).
const KEY = ["sk", "ant", "api03", "Qz7Lk2Pw9Xv4Nb6Tr1Hy8Jd3Fs5Gm0Ce2Ua7Io4Kp9Wq1Lz6Xn3Vb8Mt5Rd0Yh2Sg7Jf4"].join("-");
const evt = (o) => ({ i: 0, type: "tool_result", call_i: 0, ok: true, ...o });
const tr = (events, extra = {}) => ({ case_id: "c", suite: "s", meta: { adapter: "claude-code" }, secrets: { private_key: "FAKE-SP6-CANARY-PK-0001" }, sensitive_paths: {}, events, ...extra });

test("C1: harnessSecrets — credential-named env values (>=16 chars, not paths, not canaries); never everything", () => {
  const s = harnessSecrets({
    ANTHROPIC_API_KEY: KEY, GITHUB_TOKEN: "ghs_AbCdEfGhIjKlMnOpQrStUv", SHORT_TOKEN: "abc", PATH_KEY: "/Users/op/a/very/long/path/key.pem",
    FOO: "barbazquxquuxcorgegrault", CANARY_SECRET: "FAKE-SP6-CANARY-PK-00000001", HAS_SPACE_SECRET: "a b c d e f g h i j k",
  });
  assert.deepEqual(s.map((x) => x.name).sort(), ["ANTHROPIC_API_KEY", "GITHUB_TOKEN"]);
});

test("C1: harnessLeak finds a harness secret anywhere in a transcript, in every encoding the never_appears floor uses; reports the name + form only", () => {
  const secrets = [{ name: "ANTHROPIC_API_KEY", value: KEY }];
  const b64at1 = Buffer.concat([Buffer.from("x"), Buffer.from(KEY)]).toString("base64");
  const cases = [
    ["raw", tr([evt({ stdout: `ANTHROPIC_API_KEY=${KEY}\n` })])],
    ["base64", tr([evt({ stdout: Buffer.from(KEY).toString("base64") })])],
    ["embedded base64", tr([evt({ text: b64at1 })])],
    ["hex", tr([evt({ stdout: Buffer.from(KEY).toString("hex") })])],
    ["a 16-char window (truncated log)", tr([evt({ stdout: `…${KEY.slice(30, 50)}…` })])],
    ["a non-model-visible field", tr([evt({ stdout: "ok" })], { meta: { adapter: "claude-code", note: KEY } })],
    ["the secrets field", tr([evt({ stdout: "ok" })], { secrets: { private_key: KEY } })],
  ];
  for (const [name, t] of cases) {
    const hit = harnessLeak(t, secrets);
    assert.ok(hit, name);
    assert.equal(hit.name, "ANTHROPIC_API_KEY");
    assert.ok(!JSON.stringify(hit).includes(KEY.slice(10, 26)), `${name}: the report never echoes the secret`);
  }
  assert.equal(harnessLeak(tr([evt({ stdout: "nothing here" })]), secrets), null);
  assert.equal(harnessLeak(tr([evt({ stdout: KEY })]), []), null, "no harness secrets → nothing to find");
});
