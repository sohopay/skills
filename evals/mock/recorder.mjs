// A scripted-agent transcript recorder over the mock world: runs REAL Bash commands (mock signer on PATH, curl to
// the localhost backend), REAL MCP tool calls (Streamable HTTP) against the backend process, and the Write tool, and records the
// normalised transcript the grader consumes. Used by the scenario tests (an honest doc-faithful agent must PASS
// every case) and as the reference for how the live adapter folds journal input conditions into a transcript:
// after each tool_result, every journal entry written during that call becomes an `input_condition` event.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const ADAPTER = { adapter: "synthetic", adapter_version: "synthetic/1", grader_hash: "sp6-mock-recorder", sample_index: 0, cli_version: null, model_id: null };

/**
 * @param {object} o
 * @param {object} o.run          run config (run-config.mjs)
 * @param {(tool: string, args: object) => {ok: boolean, payload: object}} o.callTool  a SYNCHRONOUS MCP caller
 *   (httpMcpCaller below: the backend runs in its own process, so blocking Bash calls can reach it too)
 * @param {object} o.env          the agent's Bash environment (HOME, PATH with the mock bin dir first)
 * @param {string} [o.mcpServer]  MCP server name as configured (tool names become mcp__<server>__<tool>)
 */
export function createRecorder({ run, callTool, env, mcpServer = "sohopay" }) {
  const events = [];
  let journalOffset = 0;
  const push = (e) => { events.push({ i: events.length, ...e }); return events.length - 1; };
  const drainJournal = () => {
    let text = "";
    try { text = readFileSync(run.journal, "utf8"); } catch { return; }
    const fresh = text.slice(journalOffset);
    journalOffset = text.length;
    for (const line of fresh.split("\n").filter(Boolean)) push({ type: "input_condition", label: JSON.parse(line).condition });
  };

  return {
    events,
    /** One Bash tool call; `paths` = [{arg, path}] for its path-bearing arguments (what the live adapter resolves). */
    bash(command, paths = []) {
      const callI = push({ type: "tool_call", name: "Bash", args: { command }, args_text: command, ...(paths.length ? { resolved_paths: paths } : {}) });
      const r = spawnSync("/bin/bash", ["-c", command], { env, cwd: env.HOME, encoding: "utf8" });
      const stdout = r.stdout ?? ""; const stderr = r.stderr ?? "";
      push({ type: "tool_result", call_i: callI, name: "Bash", ok: r.status === 0, stdout, stderr, text: stdout + stderr });
      drainJournal();
      return { stdout, stderr, exitCode: r.status };
    },
    /** One MCP tool call against the mock backend, recorded the way Claude Code names MCP tools. */
    mcp(tool, args = {}) {
      const name = `mcp__${mcpServer}__${tool}`;
      const callI = push({ type: "tool_call", name, args, args_text: JSON.stringify(args) });
      const { ok, payload } = callTool(tool, args);
      const text = JSON.stringify(payload);
      push({ type: "tool_result", call_i: callI, name, ok, text });
      drainJournal();
      return { ok, payload, text };
    },
    /** The host's file-write tool (signer.md step 2: prep.json byte-for-byte). */
    write(filePath, content) {
      const args = { file_path: filePath, content };
      const callI = push({ type: "tool_call", name: "Write", args, args_text: JSON.stringify(args), resolved_paths: [{ arg: filePath, path: filePath }] });
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content);
      push({ type: "tool_result", call_i: callI, name: "Write", ok: true, text: `File created successfully at: ${filePath}` });
    },
    say(text) { push({ type: "model_text", text }); },
    stop(code = null, reason = "done") { push({ type: "stop", reason, code }); },
    /** The finished transcript (validateTranscript-clean). */
    transcript() {
      return { case_id: run.case_id, suite: run.suite, meta: { ...ADAPTER }, secrets: { ...run.transcript.secrets }, sensitive_paths: { ...run.transcript.sensitive_paths }, events: events.map((e) => ({ ...e })) };
    },
  };
}

/** Synchronous MCP `tools/call` over Streamable HTTP (curl), returning the tool's JSON payload and isError. */
export function httpMcpCaller(mcpUrl, headers = {}) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(mcpUrl)) throw new Error(`mock MCP caller only talks to 127.0.0.1, got ${mcpUrl}`);
  let id = 0;
  // Extra headers: the live run's mcp-config Authorization bearer, sent by the harness-side test stub only.
  const extra = Object.entries(headers).flatMap(([k, v]) => ["-H", `${k}: ${v}`]);
  return (tool, args) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name: tool, arguments: args } });
    const r = spawnSync("curl", ["-sS", "-X", "POST", "-H", "content-type: application/json", "-H", "accept: application/json, text/event-stream", ...extra, "--data-binary", "@-", mcpUrl], { input: body, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`MCP call ${tool} failed: ${r.stderr}`);
    const res = JSON.parse(r.stdout).result;
    return { ok: !res.isError, payload: JSON.parse(res.content[0].text) };
  };
}
