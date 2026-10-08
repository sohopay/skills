// Stub `claude` CLI for the live adapter's tests (item 19: no live, paid session without user approval).
// Behaves like headless Claude Code 2.1.292 at the boundary the adapter depends on:
//   * `--version` prints the pinned version;
//   * `-p <prompt> --output-format stream-json --verbose ...` writes system/init, SDK assistant/user messages and a
//     final result (total_cost_usd, num_turns, permission_denials) to stdout;
//   * writes the session JSONL to $HOME/.claude/projects/<cwd-slug>/<session-id>.jsonl in the recorded shape
//     (one line per content block; Bash toolUseResult {stdout, stderr, …} or "Error: Exit code N…" on failure;
//     toolDenialKind on a denial; MCP results as text-block arrays);
//   * runs the --settings PreToolUse / PostToolUse / PostToolUseFailure / PermissionDenied hook commands with the
//     real hook payloads on stdin.
// The "model" is a script module (default export async (agent, ctx)) whose tool calls are EXECUTED for real
// against the world the adapter built: Bash via /bin/bash in the given env and cwd, MCP over HTTP to the
// --mcp-config server, Write to disk.
// Usage: node stub-claude.mjs <script.mjs> <recordDir> [<version>] [nohooks] -- <claude args...>
//   recordDir gets argv.jsonl; <version> overrides --version; `nohooks` behaves like a CLI that ignored --settings.
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { httpMcpCaller } from "../../../mock/recorder.mjs";

const sep = process.argv.indexOf("--", 2);
const [scriptPath, recordDir, ...flags] = process.argv.slice(2, sep);
const argv = process.argv.slice(sep + 1);
const VERSION = flags.find((f) => /^\d/.test(f)) ?? "2.1.292";
const NO_HOOKS = flags.includes("nohooks");
const DROP_HOOK = Number(flags.find((f) => f.startsWith("drophook="))?.slice(9) ?? 0); // 1-based tool call whose hooks are lost
let BAD_HOOK = flags.includes("badhook"); // the first PreToolUse sends a malformed payload
const GARBAGE = flags.includes("garbage"); // a non-JSON line in the middle of the session JSONL
if (argv[0] === "--version") { process.stdout.write(`${VERSION} (Claude Code)\n`); process.exit(0); }

const opts = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-p") { opts.prompt = argv[++i]; continue; }
  if (a === "--verbose" || a === "--strict-mcp-config") { opts[a.slice(2)] = true; continue; }
  if (a.startsWith("--")) { opts[a.slice(2)] = argv[++i]; continue; }
}
const { ANTHROPIC_API_KEY: _k, CLAUDE_CODE_OAUTH_TOKEN: _t, ...recordedEnv } = process.env;
const runRootListing = readdirSync(dirname(opts.settings)).sort();
appendFileSync(join(recordDir, "argv.jsonl"), `${JSON.stringify({ argv, cwd: process.cwd(), env: recordedEnv, runRootListing })}\n`);

const settings = JSON.parse(readFileSync(opts.settings, "utf8"));
const mcpUrl = JSON.parse(readFileSync(opts["mcp-config"], "utf8")).mcpServers.sohopay.url;
const sessionId = opts["session-id"];
const cwd = process.cwd();
const sessionFile = join(process.env.HOME, ".claude", "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), `${sessionId}.jsonl`);
mkdirSync(dirname(sessionFile), { recursive: true });
const model = opts.model;
let parent = null;
let turns = 0;
let lastText = "";
const denials = [];
let callCount = 0;
// Claude Code's Bash sandbox exports TMPDIR=<CLAUDE_CODE_TMPDIR or /tmp>/claude-<uid>; emulate it for Bash calls.
const bashEnv = { ...process.env };
if (settings.sandbox?.enabled) {
  bashEnv.TMPDIR = join(process.env.CLAUDE_CODE_TMPDIR || "/tmp", `claude-${process.getuid()}`);
  if (!existsSync(bashEnv.TMPDIR)) mkdirSync(bashEnv.TMPDIR, { recursive: true, mode: 0o700 });
}

const common = () => ({ parentUuid: parent, isSidechain: false, userType: "external", cwd, sessionId, version: VERSION, gitBranch: "" });
function line(o) { const uuid = randomUUID(); appendFileSync(sessionFile, `${JSON.stringify({ ...common(), ...o, uuid, timestamp: new Date().toISOString() })}\n`); parent = uuid; return uuid; }
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const toolId = () => `toolu_01${randomBytes(11).toString("base64url")}`;

function assistant(blocks) {
  turns += 1;
  const id = `msg_01${randomBytes(11).toString("base64url")}`;
  let last = null;
  for (const b of blocks) {
    const message = { model, id, type: "message", role: "assistant", content: [b], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } };
    last = line({ message, requestId: `req_${randomBytes(8).toString("hex")}`, type: "assistant" });
    out({ type: "assistant", message, parent_tool_use_id: null, session_id: sessionId, uuid: last });
  }
  return last;
}
function userResult(srcUuid, block, toolUseResult, extra = {}) {
  const message = { role: "user", content: [block] };
  const uuid = line({ type: "user", message, toolUseResult, sourceToolAssistantUUID: srcUuid, ...extra });
  out({ type: "user", message, parent_tool_use_id: null, session_id: sessionId, uuid, tool_use_result: toolUseResult });
}
function hook(event, payload, callNo) {
  if (NO_HOOKS || callNo === DROP_HOOK) return;
  for (const group of settings.hooks?.[event] ?? []) {
    for (const h of group.hooks ?? []) {
      const bad = BAD_HOOK && event === "PreToolUse";
      if (bad) BAD_HOOK = false;
      const r = spawnSync("/bin/sh", ["-c", h.command], { input: bad ? "{not json" : JSON.stringify({ session_id: sessionId, transcript_path: sessionFile, cwd, permission_mode: "dontAsk", hook_event_name: event, ...payload }), env: process.env, encoding: "utf8" });
      if (r.status !== 0) process.stderr.write(`hook ${event} failed: ${r.stderr}\n`);
    }
  }
}

/** Execute one tool for real; returns {block, toolUseResult, ok, raw}. */
function execute(name, input) {
  if (name === "Bash") {
    const r = spawnSync("/bin/bash", ["-c", input.command], { cwd, env: bashEnv, encoding: "utf8" });
    const stdout = r.stdout ?? ""; const stderr = r.stderr ?? "";
    const both = [stdout.replace(/\n$/, ""), stderr.replace(/\n$/, "")].filter(Boolean).join("\n");
    if (r.status === 0) return { ok: true, raw: { stdout, stderr, exitCode: 0 }, content: both, tur: { stdout, stderr, interrupted: false, isImage: false, noOutputExpected: false } };
    const text = `Exit code ${r.status}\n${both}`;
    return { ok: false, raw: { stdout, stderr, exitCode: r.status }, content: text, tur: `Error: ${text}` };
  }
  if (name.startsWith("mcp__sohopay__")) {
    const { ok, payload } = httpMcpCaller(mcpUrl)(name.slice("mcp__sohopay__".length), input);
    const text = JSON.stringify(payload);
    return { ok, raw: { ok, payload, text }, content: [{ type: "text", text }], tur: [{ type: "text", text }] };
  }
  if (name === "Write") {
    mkdirSync(dirname(input.file_path), { recursive: true });
    writeFileSync(input.file_path, input.content);
    return { ok: true, raw: {}, content: `File created successfully at: ${input.file_path}`, tur: { type: "create", filePath: input.file_path, content: input.content, structuredPatch: [], originalFile: null } };
  }
  if (name === "Read") {
    const body = readFileSync(resolve(cwd, input.file_path), "utf8");
    return { ok: true, raw: { body }, content: body.split("\n").map((l, k) => `${k + 1}\t${l}`).join("\n"), tur: { type: "text", file: { filePath: input.file_path, content: body } } };
  }
  throw new Error(`stub: tool ${name} not implemented`);
}

/** One or more tool calls in a single assistant message; results come back in `order` (parallel calls). */
function calls(list, order) {
  const ids = list.map(() => toolId());
  const nos = list.map(() => ++callCount);
  const src = assistant(list.map(([name, input], k) => ({ type: "tool_use", id: ids[k], name, input, caller: { type: "direct" } })));
  const results = [];
  const run = list.map(([name, input], k) => () => {
    hook("PreToolUse", { tool_name: name, tool_input: input, tool_use_id: ids[k] }, nos[k]);
    const r = execute(name, input);
    if (r.ok) hook("PostToolUse", { tool_name: name, tool_input: input, tool_response: r.tur, tool_use_id: ids[k] }, nos[k]);
    else hook("PostToolUseFailure", { tool_name: name, tool_input: input, tool_use_id: ids[k], error: String(r.content).slice(0, 200), is_interrupt: false }, nos[k]);
    results[k] = r;
  });
  for (const k of order ?? list.map((_, j) => j)) run[k]();
  for (const k of order ?? list.map((_, j) => j)) userResult(src, { tool_use_id: ids[k], type: "tool_result", content: results[k].content, is_error: !results[k].ok }, results[k].tur);
  return results.map((r) => r.raw);
}

/** The scripted model's handle (sync, recorder-compatible: bash / mcp / write / say / stop). */
const agent = {
  bash: (command) => calls([["Bash", { command, description: "Run command" }]])[0],
  mcp: (tool, args = {}) => calls([[`mcp__sohopay__${tool}`, args]])[0],
  write: (filePath, content) => { calls([["Write", { file_path: filePath, content }]]); },
  read: (filePath) => calls([["Read", { file_path: filePath }]])[0],
  parallel: (list, order) => calls(list, order),
  say: (text) => { lastText = text; assistant([{ type: "text", text }]); },
  think: (thinking) => { assistant([{ type: "thinking", thinking, signature: "sig" }]); },
  /** A tool call the permission layer refuses: no execution, a denial result, a PermissionDenied hook. */
  deny: (name, input) => {
    const id = toolId();
    const src = assistant([{ type: "tool_use", id, name, input }]);
    hook("PermissionDenied", { tool_name: name, tool_input: input, tool_use_id: id }, ++callCount);
    const text = `Permission to use ${name} has been denied because Claude Code is running in don't ask mode.`;
    userResult(src, { tool_use_id: id, type: "tool_result", content: text, is_error: true }, `Error: ${text}`, { toolDenialKind: "permission-rule" });
    denials.push({ tool_name: name, tool_use_id: id, tool_input: input });
  },
  stop: () => {},
};

out({ type: "system", subtype: "init", cwd, session_id: sessionId, tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "mcp__sohopay__get_context"], mcp_servers: [{ name: "sohopay", status: "connected" }], model, permissionMode: opts["permission-mode"], apiKeySource: "ANTHROPIC_API_KEY", claude_code_version: VERSION, uuid: randomUUID() });
line({ type: "user", message: { role: "user", content: opts.prompt } });
if (GARBAGE) appendFileSync(sessionFile, "{this is not json\n");
line({ type: "attachment", attachment: { type: "skill_listing" } });
const mod = await import(pathToFileURL(scriptPath).href);
const merchant = /http:\/\/127\.0\.0\.1:\d+\/merchant\/api\/premium/.exec(opts.prompt ?? "")?.[0] ?? null;
let subtype = "success";
try { await mod.default(agent, { prompt: opts.prompt, merchant, home: process.env.HOME, cwd, recordDir }); } catch (e) { subtype = "error_during_execution"; process.stderr.write(`stub script failed: ${e.stack}\n`); }
line({ type: "system", subtype: "stop_hook_summary", hookCount: 0, hookInfos: [], hookErrors: [], preventedContinuation: false, stopReason: "", hasOutput: false, level: "suggestion" });
out({ type: "result", subtype, is_error: subtype !== "success", duration_ms: 1000, duration_api_ms: 800, num_turns: turns, result: lastText, stop_reason: "end_turn", session_id: sessionId, total_cost_usd: mod.costUsd ?? 0.0123, usage: { input_tokens: 100, output_tokens: 50 }, modelUsage: {}, permission_denials: denials, uuid: randomUUID() });
