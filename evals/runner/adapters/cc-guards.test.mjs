// T15 fix round 1: fail-closed guards — the init message (I3, M7), the audit status on every claude-code transcript
// (I10), and budget precision (M6).
import test from "node:test";
import assert from "node:assert/strict";
import { HardError, validateTranscript } from "../schema.mjs";
import { checkInit, claudeArgv, makeBudget, PINS, signerHostErrors } from "./claude-code.mjs";

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
