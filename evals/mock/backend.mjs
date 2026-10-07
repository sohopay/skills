// Mock SohoPay backend for the SP6 live eval: ONE localhost HTTP server (127.0.0.1 only, Node stdlib only,
// never makes an outbound connection) serving
//   POST /mcp                         MCP over Streamable HTTP (JSON responses) — `claude --mcp-config` attaches with
//                                     {"mcpServers":{"sohopay":{"type":"http","url":"http://127.0.0.1:<port>/mcp"}}},
//                                     so tool names reach the transcript as mcp__sohopay__<tool>
//   POST /api/v1/agents/<id>/keys     REST twin of register_agent_workload_key (the path the skill names)
//   POST /api/v1/spend/x402/prepare   REST twin of prepare_x402_payment (raw-HTTP fallback in signer.md)
//   POST /api/v1/auth/authorization-context   onboard step 7
//   GET  /merchant/api/premium        the x402 merchant: 402 + challenge, 200 for the run's PAYMENT-SIGNATURE
//   GET  /agent/authorize             consent page stub (the grant turns ACTIVE on the next poll)
// Input conditions (register_failed, injection_present, consent_ok) are appended to the run journal; they are
// never part of a response body.
//   CLI: node evals/mock/backend.mjs --run <run.json> [--port <n>]   → prints {"url": "..."} once listening.
import { appendFileSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { initialState, merchantChallenge, ToolError, TOOLS } from "./lib/backend-tools.mjs";

export const HOST = "127.0.0.1";
const PROTOCOL_VERSION = "2025-06-18";
const MERCHANT_PATH = "/merchant/api/premium";
const KEYS_RE = /^\/api\/v1\/agents\/([A-Za-z0-9_.-]+)\/keys\/?$/;

const TOOL_LIST = Object.keys(TOOLS).map((name) => ({
  name,
  description: `SohoPay ${name.replace(/_/g, " ")}`,
  inputSchema: { type: "object", additionalProperties: true },
}));

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(text);
}

/** Create (not yet listening) the mock backend for one run config. */
export function createBackend(run) {
  const state = initialState(run);
  const emit = (condition, ref = {}) => {
    if (run.journal) appendFileSync(run.journal, `${JSON.stringify({ source: "backend", condition, ...ref, at: Date.now() })}\n`);
  };
  const ctx = { ...run, publicBase: "" };

  /** Call one tool; returns { ok, result } or { ok:false, error:{code,message,status} }. */
  function callTool(name, args) {
    const handler = TOOLS[name];
    if (!handler) return { ok: false, error: { code: "TOOL_NOT_FOUND", message: `unknown tool: ${name}`, status: 404 } };
    state.calls += 1;
    const ref = { tool: name, call_seq: state.calls };
    try {
      let result = handler(args ?? {}, state, ctx, (c) => emit(c, ref));
      const inj = run.backend.injection;
      if (inj && inj.tool === name) {
        result = { ...result, [inj.field ?? "notice"]: inj.text };
        emit("injection_present", ref);
      }
      return { ok: true, result };
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
      return { ok: false, error: { code: e.code, message: e.message, status: e.status } };
    }
  }

  function rpc(msg) {
    const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
    if (msg.id === undefined) return null; // notification (e.g. notifications/initialized)
    switch (msg.method) {
      case "initialize": return reply({ protocolVersion: msg.params?.protocolVersion ?? PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "sohopay", version: "8.0.0" } });
      case "ping": return reply({});
      case "tools/list": return reply({ tools: TOOL_LIST });
      case "tools/call": {
        const out = callTool(msg.params?.name, msg.params?.arguments);
        const payload = out.ok ? out.result : { status: "error", code: out.error.code, message: out.error.message };
        return reply({ content: [{ type: "text", text: JSON.stringify(payload) }], isError: !out.ok });
      }
      default: return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } };
    }
  }

  async function handle(req, res) {
    const url = new URL(req.url, `http://${HOST}`);
    if (url.pathname === "/mcp") {
      if (req.method !== "POST") return send(res, 405, { error: "method not allowed" }, { allow: "POST" });
      let parsed;
      try { parsed = JSON.parse(await readBody(req)); } catch { return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); }
      const replies = (Array.isArray(parsed) ? parsed : [parsed]).map(rpc).filter(Boolean);
      if (replies.length === 0) { res.writeHead(202); return res.end(); }
      return send(res, 200, Array.isArray(parsed) ? replies : replies[0]);
    }
    if (url.pathname === MERCHANT_PATH && req.method === "GET") {
      const header = req.headers["payment-signature"];
      if (header === undefined) {
        const body = merchantChallenge(state, `${ctx.publicBase}${MERCHANT_PATH}`);
        return send(res, 402, body, { "x-soho-payment-required": Buffer.from(JSON.stringify(body.challenge)).toString("base64") });
      }
      if (header === run.canaries.header_value) return send(res, 200, { resource: "premium report", content: "The quarterly figures are up 4%." });
      return send(res, 402, { error: "payment rejected", reason: "PAYMENT_SIGNATURE_INVALID" });
    }
    if (url.pathname === "/agent/authorize") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<html><body>Consent recorded. You can return to your agent.</body></html>"); }
    if (req.method === "POST") {
      const rest = restRoute(url.pathname);
      if (rest) {
        let args = {};
        try { args = JSON.parse((await readBody(req)) || "{}"); } catch { return send(res, 400, { success: false, message: "invalid JSON" }); }
        const out = callTool(rest.tool, { ...args, ...rest.args });
        return out.ok ? send(res, 200, out.result) : send(res, out.error.status, { success: false, message: out.error.message, data: { code: out.error.code } });
      }
    }
    return send(res, 404, { success: false, message: "not found" });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => send(res, 500, { success: false, message: String(e?.message ?? e) }));
  });
  return {
    server, state, callTool,
    /** Listen on 127.0.0.1 only; resolves to the base URL. */
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, HOST, () => {
        ctx.publicBase = `http://${HOST}:${server.address().port}`;
        resolve(ctx.publicBase);
      }));
    },
    close() { return new Promise((resolve) => server.close(() => resolve())); },
  };
}

function restRoute(path) {
  const m = KEYS_RE.exec(path);
  if (m) return { tool: "register_agent_workload_key", args: { terminal_id: m[1] } };
  if (path === "/api/v1/spend/x402/prepare") return { tool: "prepare_x402_payment", args: {} };
  if (path === "/api/v1/auth/authorization-context") return { tool: "get_context", args: {} };
  return null;
}

/** The merchant URL for a listening backend. */
export const merchantUrl = (base) => `${base}${MERCHANT_PATH}`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
  const run = JSON.parse(readFileSync(arg("--run"), "utf8"));
  const backend = createBackend(run);
  backend.listen(Number(arg("--port") ?? 0)).then((url) => process.stdout.write(`${JSON.stringify({ url, mcp: `${url}/mcp`, merchant: merchantUrl(url) })}\n`));
}
