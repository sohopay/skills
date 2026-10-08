// T15 fix round 2: every live-run endpoint authenticates. N4 — /mcp requires the bearer Claude Code gets through the
// (agent-denied) mcp-config headers, so an agent curl to /mcp is rejected. N7 — the control channel and the signer
// host's /exec reject a missing or wrong token.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackend } from "../mock/backend.mjs";
import { buildRun } from "../mock/run-config.mjs";
import { loadScenario } from "../mock/scenarios/index.mjs";
import { createSignerHost, newLogs } from "../mock/signer-host.mjs";

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "sp6-auth-")));
after(() => rmSync(ROOT, { recursive: true, force: true }));
const MCP = "m".repeat(64);
const CTL = "c".repeat(64);
const CLIENT = "e".repeat(48);
const rpc = (base, headers = {}) => fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });

async function up() {
  const run = buildRun(await loadScenario("key-opacity"), { runDir: ROOT, home: join(ROOT, "home") });
  const logs = newLogs();
  const backend = createBackend(run, { sink: logs.journal, mcpToken: MCP, ctl: { token: CTL, state: () => ({ journal: logs.journal, execs: logs.execs, owned: logs.owned }) } });
  const base = await backend.listen(0);
  mkdirSync(join(ROOT, "priv"), { recursive: true });
  const host = createSignerHost(run, { logs, clientToken: CLIENT, policy: { home: join(ROOT, "home"), writeRoots: [join(ROOT, "home")], denyRead: [], denyWrite: [], allowRead: [], mktemp: [], since: Date.now() }, privateDir: join(ROOT, "priv") });
  const signer = await host.listen(0);
  return { base, signer, close: async () => { await backend.close(); await host.close(); } };
}

test("N4: /mcp without the bearer (an agent curl) is rejected; a wrong bearer too; the configured bearer works", async () => {
  const w = await up();
  try {
    assert.equal((await rpc(w.base)).status, 401);
    assert.equal((await rpc(w.base, { authorization: `Bearer ${"x".repeat(64)}` })).status, 401);
    const ok = await rpc(w.base, { authorization: `Bearer ${MCP}` });
    assert.equal(ok.status, 200);
    assert.ok((await ok.json()).result.tools.length > 5);
  } finally { await w.close(); }
});

test("N7: GET /__ctl/state without / with a wrong control token is an ordinary 404", async () => {
  const w = await up();
  try {
    assert.equal((await fetch(`${w.base}/__ctl/state`)).status, 404);
    assert.equal((await fetch(`${w.base}/__ctl/state`, { headers: { "x-ctl-token": "c".repeat(63) } })).status, 404);
    assert.equal((await fetch(`${w.base}/__ctl/state`, { headers: { "x-ctl-token": CTL } })).status, 200);
  } finally { await w.close(); }
});

test("N7: the signer host's /exec rejects a missing or wrong client token (and runs nothing)", async () => {
  const w = await up();
  try {
    const body = JSON.stringify({ argv: ["capabilities"], stdin: "", cwd: "/", env: { HOME: join(ROOT, "home") } });
    const post = (headers) => fetch(`${w.signer}/exec`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
    assert.equal((await post({})).status, 404);
    assert.equal((await post({ "x-signer-client": "e".repeat(47) })).status, 404);
    const state = await (await fetch(`${w.base}/__ctl/state`, { headers: { "x-ctl-token": CTL } })).json();
    assert.deepEqual(state.execs.map((e) => e.rejected), ["token", "token"], "R2-5: rejections are logged, and nothing ran");
    assert.equal((await post({ "x-signer-client": CLIENT })).status, 200);
  } finally { await w.close(); }
});
