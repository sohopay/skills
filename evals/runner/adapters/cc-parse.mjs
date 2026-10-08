// `claude-code/1` capture format: what the live adapter reads from one headless Claude Code run, and nothing else.
//
//   1. The session JSONL Claude Code writes to $HOME/.claude/projects/<cwd-slug>/<session-id>.jsonl (the adapter
//      passes --session-id, so the file is found by id). It is the event source: one line per content block,
//      every line timestamped, tool results carrying `toolUseResult` (Bash: {stdout, stderr, ...}; a failing Bash
//      call: the string "Error: Exit code N\n...") and, for a permission denial, `toolDenialKind`.
//   2. The `--output-format stream-json --verbose` stdout: only its `system/init` (model, version, tools, MCP
//      status) and its final `result` (subtype, num_turns, total_cost_usd, permission_denials) are read.
//
// Mapping (see task-15-report.md): assistant text → model_text; assistant tool_use / server_tool_use → tool_call;
// a tool_result block (user line, or a server tool result inside an assistant line) → tool_result paired by
// tool_use_id; a denial (toolDenialKind, result.permission_denials, PermissionDenied hook) → denied:true on BOTH
// the call and its result; result → stop. Not events: thinking blocks, the operator prompt, isMeta / system /
// attachment / summary / file-history / hook-summary lines (spec: stop-hook and system entries are not events).
import { HardError } from "../schema.mjs";

/** JSON lines → objects. A torn final line (process killed mid-write) is dropped; any other bad line is an error. */
export function jsonLines(text, what) {
  const lines = text.split("\n");
  const out = [];
  lines.forEach((l, n) => {
    if (l.trim() === "") return;
    try { out.push(JSON.parse(l)); } catch {
      const isLast = lines.slice(n + 1).every((x) => x.trim() === "");
      if (!isLast) throw new HardError(`${what}: line ${n + 1} is not JSON`);
    }
  });
  return out;
}

/** The stream-json messages the adapter uses: the first system/init and the last result. */
export function parseStream(text) {
  const msgs = jsonLines(text, "stream-json");
  const init = msgs.find((m) => m.type === "system" && m.subtype === "init") ?? null;
  const result = [...msgs].reverse().find((m) => m.type === "result") ?? null;
  return { init, result };
}

/** The CLI version an init message reports (a string, or a build-info object carrying VERSION). */
export function initVersion(init) {
  const v = init?.claude_code_version;
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof v.VERSION === "string") return v.VERSION;
  return null;
}

function blockText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content === undefined || content === null ? "" : JSON.stringify(content);
  return content.map((b) => {
    if (b?.type === "text") return b.text ?? "";
    if (b?.type === "image") return "[image]";
    return JSON.stringify(b);
  }).join("\n");
}

const RESULT_BLOCK_RE = /(?:^|_)tool_result$/;

/**
 * Session JSONL → ordered raw items:
 *   {kind:"text", text, ts}
 *   {kind:"call", id, name, input, ts, cwd, sidechain}
 *   {kind:"result", id, isError, text, stdout?, stderr?, denialKind?, ts}
 * Duplicate tool_use ids (a re-emitted block) keep the first; a result for an unknown id is kept (the assembler
 * turns it into an adapter error rather than guessing).
 */
export function parseSession(text) {
  const items = [];
  const seenCalls = new Set();
  const seenResults = new Set();
  for (const o of jsonLines(text, "session JSONL")) {
    if (o.isMeta || o.isCompactSummary || o.isVisibleInTranscriptOnly) continue;
    if (o.type !== "assistant" && o.type !== "user") continue;
    const content = o.message?.content;
    if (!Array.isArray(content)) continue; // the operator prompt (a string) and other non-block lines
    const ts = Date.parse(o.timestamp ?? "") || null;
    for (const b of content) {
      if (!b || typeof b !== "object") continue;
      if (o.type === "assistant" && b.type === "text") {
        if (typeof b.text === "string" && b.text.trim() !== "") items.push({ kind: "text", text: b.text, ts });
      } else if (b.type === "tool_use" || b.type === "server_tool_use") {
        if (typeof b.id !== "string" || seenCalls.has(b.id)) continue;
        seenCalls.add(b.id);
        items.push({ kind: "call", id: b.id, name: String(b.name ?? ""), input: b.input ?? {}, ts, cwd: o.cwd ?? null, sidechain: o.isSidechain === true });
      } else if (RESULT_BLOCK_RE.test(b.type ?? "") && typeof b.tool_use_id === "string") {
        if (seenResults.has(b.tool_use_id)) continue;
        seenResults.add(b.tool_use_id);
        const r = { kind: "result", id: b.tool_use_id, isError: b.is_error === true, text: blockText(b.content), ts };
        const tur = o.type === "user" ? o.toolUseResult : undefined;
        if (tur && typeof tur === "object" && !Array.isArray(tur)) {
          if (typeof tur.stdout === "string") r.stdout = tur.stdout;
          if (typeof tur.stderr === "string") r.stderr = tur.stderr;
        }
        if (typeof o.toolDenialKind === "string" && o.toolDenialKind !== "") r.denialKind = o.toolDenialKind;
        items.push(r);
      }
    }
  }
  return items;
}

/** Map the run's end (stream-json result, or its absence) to the stop event's reason. */
export function stopReason(result, exit) {
  if (!result) return exit?.timedOut ? "timeout" : "crashed";
  switch (result.subtype) {
    case "success": return result.is_error ? "error" : "done";
    case "error_max_turns": return "max_turns";
    case "error_max_budget_usd": return "budget";
    case "error_during_execution": return "error";
    default: return String(result.subtype ?? "unknown");
  }
}

/** tool_use ids the result message reports as permission-denied. */
export function deniedIds(result) {
  const out = new Set();
  for (const d of result?.permission_denials ?? []) if (typeof d?.tool_use_id === "string") out.add(d.tool_use_id);
  return out;
}
