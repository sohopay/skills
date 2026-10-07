// Mock backend (evals/mock/backend.mjs): MCP Streamable-HTTP transport, the per-scenario world it serves, the
// merchant, the REST twins, localhost-only binding and the no-egress rule for everything under evals/mock.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBackend, merchantUrl } from "../mock/backend.mjs";
import { buildRun } from "../mock/run-config.mjs";
import { computePaymentId, popMessage, publicFromPrivate, signWith } from "../mock/lib/keymodel.mjs";
import { loadScenario, SCENARIO_IDS } from "../mock/scenarios/index.mjs";

const MOCK = join(dirname(fileURLToPath(import.meta.url)), "..", "mock");

async function up(caseId) {
  const runDir = mkdtempSync(join(tmpdir(), "sp6-mb-"));
  const run = buildRun(await loadScenario(caseId), { runDir, home: join(runDir, "home") });
  writeFileSync(run.journal, "");
  const backend = createBackend(run);
  const base = await backend.listen(0);
  let id = 0;
  const rpc = async (method, params) => {
    const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
    return r.json();
  };
  const tool = async (name, args = {}) => {
    const res = (await rpc("tools/call", { name, arguments: args })).result;
    return { ok: !res.isError, body: JSON.parse(res.content[0].text) };
  };
  const journal = () => readFileSync(run.journal, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).condition);
  return { run, backend, base, rpc, tool, journal };
}

test("MCP over Streamable HTTP: initialize, initialized notification, tools/list, unknown method, GET refused", async () => {
  const w = await up("keygen-routes-to-signer");
  try {
    const init = await w.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
    assert.equal(init.result.serverInfo.name, "sohopay");
    assert.ok(init.result.capabilities.tools);
    const note = await fetch(`${w.base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    assert.equal(note.status, 202);
    const names = (await w.rpc("tools/list")).result.tools.map((t) => t.name);
    for (const t of ["get_context", "whoami", "register_borrower", "request_borrower_token", "get_borrower_status", "register_agent_workload_key", "authorize_agent", "get_agent_authorization", "check_handle_availability", "claim_handle", "prepare_x402_payment", "get_settlement_status"]) {
      assert.ok(names.includes(t), t);
    }
    assert.equal((await w.rpc("nope/nope")).error.code, -32601);
    assert.equal((await fetch(`${w.base}/mcp`)).status, 405);
    assert.equal(w.backend.server.address().address, "127.0.0.1", "binds localhost only");
  } finally { await w.backend.close(); }
});

const NEXT = { "fresh-host": "register_borrower", "terminal-registered": "register_agent_workload_key", onboarded: "ready" };
for (const id of SCENARIO_IDS) {
  test(`[scenario] backend world for ${id}`, async () => {
    const w = await up(id);
    try {
      const sc = await loadScenario(id);
      const ctx = (await w.tool("get_context")).body;
      assert.equal(ctx.next_action, NEXT[sc.backend.state]);
      assert.equal(ctx.borrower_id, w.run.identity.borrower_id);
      if (sc.backend.state === "onboarded") assert.equal(ctx.workload_key.agent_key_jkt, publicFromPrivate(w.run.canaries.private_key).jkt);
      if (sc.backend.injection) {
        assert.match(ctx[sc.backend.injection.field], /secret\.json/);
        assert.deepEqual(w.journal(), ["injection_present"]);
      } else assert.equal(Object.keys(ctx).some((k) => /notice/.test(k)), false);
      if (sc.backend.register_fail_times) {
        await w.tool("register_borrower");
        const r = await w.tool("register_agent_workload_key", {});
        assert.equal(r.ok, false); assert.equal(r.body.code, "UPSTREAM_UNAVAILABLE");
        assert.deepEqual(w.journal(), ["register_failed"]);
      }
      if (sc.suite === "sohopay-x402") {
        const args = { merchant: w.run.identity.pay_to, amount: "1000000", idempotency_key: "k-1" };
        let p = await w.tool("prepare_x402_payment", args);
        if (sc.backend.first_time_merchant) {
          assert.equal(p.ok, false); assert.match(p.body.message, /RISK_FIRST_TIME_MERCHANT/);
          assert.deepEqual(w.journal(), [], "the gate has not passed: no consent_ok yet");
          p = await w.tool("prepare_x402_payment", args);
        }
        assert.equal(p.body.status, "VOUCHER_ISSUED");
        const { paymentId, agentKeyJkt, ...core } = p.body.voucher;
        assert.equal(paymentId, computePaymentId(core));
        assert.equal(agentKeyJkt, ctx.workload_key.agent_key_jkt);
        assert.deepEqual(p.body.envelope.paymentPayload.payload.voucher, p.body.voucher);
        assert.equal(p.body.envelope.paymentPayload.payload.signature, null);
        assert.ok(w.journal().includes("consent_ok"));
      }
      assert.ok(!JSON.stringify(ctx).includes("FAKE-SP6-CANARY-"), "the backend never serves a canary");
    } finally { await w.backend.close(); }
  });
}

test("m5: the first-time-merchant gate clears only on a retry with the SAME idempotency_key", async () => {
  const w = await up("sequencing-consent-before-sign");
  try {
    const args = (k) => ({ merchant: w.run.identity.pay_to, amount: "1000000", idempotency_key: k });
    const first = await w.tool("prepare_x402_payment", args("key-A"));
    assert.equal(first.ok, false); assert.match(first.body.message, /RISK_FIRST_TIME_MERCHANT/);
    const other = await w.tool("prepare_x402_payment", args("key-B-different"));
    assert.equal(other.ok, false, "a fresh idempotency_key is not consent for the denied attempt");
    assert.match(other.body.message, /RISK_FIRST_TIME_MERCHANT/);
    assert.deepEqual(w.journal(), []);
    const same = await w.tool("prepare_x402_payment", args("key-A"));
    assert.equal(same.body.status, "VOUCHER_ISSUED");
    assert.deepEqual(w.journal(), ["consent_ok"]);
  } finally { await w.backend.close(); }
});

test("merchant: 402 + challenge, 200 only for the run's PAYMENT-SIGNATURE, 402 PAYMENT_SIGNATURE_INVALID otherwise", async () => {
  const w = await up("header-opacity");
  try {
    const url = merchantUrl(w.base);
    const a = await fetch(url);
    assert.equal(a.status, 402);
    const body = await a.json();
    assert.equal(body.challenge.payment.payTo, w.run.identity.pay_to);
    assert.ok(a.headers.get("x-soho-payment-required"));
    assert.equal((await fetch(url, { headers: { "PAYMENT-SIGNATURE": w.run.canaries.header_value } })).status, 200);
    const bad = await fetch(url, { headers: { "PAYMENT-SIGNATURE": "eyJub3QiOiJpdCJ9" } });
    assert.equal(bad.status, 402); assert.equal((await bad.json()).reason, "PAYMENT_SIGNATURE_INVALID");
  } finally { await w.backend.close(); }
});

test("REST twin POST /api/v1/agents/<terminal>/keys verifies the PoP against the submitted public JWK", async () => {
  const w = await up("pop-routes-to-signer");
  try {
    const { borrower_id: borrowerId, terminal_id: terminalId } = w.run.identity;
    const { publicJwk, jkt } = publicFromPrivate(w.run.canaries.private_key);
    const nonce = randomBytes(32).toString("base64url"); const iat = 1790000000;
    const pop_signature = signWith(w.run.canaries.private_key, popMessage({ borrowerId, terminalId, jkt, nonce, iat }));
    const post = (b) => fetch(`${w.base}/api/v1/agents/${terminalId}/keys`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    const bad = await post({ public_jwk: publicJwk, jkt, nonce, iat: iat + 1, pop_signature });
    assert.equal(bad.status, 400); assert.equal((await bad.json()).data.code, "POP_SIGNATURE_INVALID");
    const ok = await post({ public_jwk: publicJwk, jkt, nonce, iat, pop_signature });
    assert.equal(ok.status, 200); assert.equal((await ok.json()).agent_key_jkt, jkt);
  } finally { await w.backend.close(); }
});

test("egress: nothing under evals/mock can open an outbound connection; the backend only listens on 127.0.0.1", () => {
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(mjs|js)$|sohopay-signer$/.test(f)) files.push(p); } };
  walk(MOCK);
  assert.ok(files.length > 10);
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const re of [/\bfetch\s*\(/, /node:(?:https|net|tls|dns|dgram|http2)\b/, /\b(?:http|https)\.(?:request|get)\s*\(/, /\bnew\s+WebSocket\b/, /\bconnect\s*\(/]) {
      assert.ok(!re.test(src), `${f} matches ${re}`);
    }
    if (/createServer/.test(src)) assert.match(src, /listen\(port, HOST/, `${f} must bind HOST`);
  }
  assert.match(readFileSync(join(MOCK, "backend.mjs"), "utf8"), /export const HOST = "127\.0\.0\.1";/);
});
