// Mock backend (evals/mock/backend.mjs): MCP Streamable-HTTP transport, the per-scenario world it serves, the
// merchant, the REST twins, localhost-only binding and the no-egress rule for everything under evals/mock.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBackend, merchantUrl } from "../mock/backend.mjs";
import { buildRun } from "../mock/run-config.mjs";
import { computePaymentId, popMessage, publicFromPrivate, signWith, voucherSignedBytes } from "../mock/lib/keymodel.mjs";
import { loadScenario, SCENARIO_IDS } from "../mock/scenarios/index.mjs";
import { onboardingOf } from "../mock/lib/backend-tools.mjs";

const MOCK = join(dirname(fileURLToPath(import.meta.url)), "..", "mock");

const TEMP = [];
after(() => { for (const d of TEMP) rmSync(d, { recursive: true, force: true }); });

async function up(caseId) {
  const runDir = mkdtempSync(join(tmpdir(), "sp6-mb-"));
  TEMP.push(runDir);
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
      const o = onboardingOf(w.run);
      if (o) {
        // SOHO-475 / SOHO-479: the onboarding section and its next actions in the backend's own shape: a browser
        // step carries handoff_type OPEN_URL and no tool, PROVE_WALLET names its tool and carries no handoff_type,
        // and no action carries a URL. The first get_context read raises every condition that anchors the case.
        assert.equal(ctx.onboarding.profile_complete, o.profile_complete);
        assert.equal(ctx.onboarding.credit_eligibility.status, o.credit_eligibility);
        assert.equal(ctx.wallet_proof_verified, o.wallet === "VERIFIED");
        assert.deepEqual(ctx.next_actions.map((a) => a.action), o.actions);
        for (const a of ctx.next_actions) {
          assert.ok(!/https?:/.test(JSON.stringify(a)), `${a.action} carries no URL`);
          if (a.action === "PROVE_WALLET") assert.deepEqual(a, { action: "PROVE_WALLET", actor: "BORROWER", tool: "request_signature_challenge", handoff_required: true, reason_code: "WALLET_PROOF_REQUIRED" });
          else if (a.action === "PAY") assert.equal(a.tool, "prepare_x402_payment");
          // SOHO-436: the one OPEN_URL step that names its link tool (mcp-server v16).
          else if (a.action === "REVIEW_AND_ACCEPT_FACILITY") assert.deepEqual(a, { action: "REVIEW_AND_ACCEPT_FACILITY", actor: "BORROWER", tool: "review_facility_offer", handoff_required: true, handoff_type: "OPEN_URL", reason_code: "FACILITY_OFFER_ACCEPTANCE_REQUIRED" });
          else { assert.equal(a.handoff_type, "OPEN_URL"); assert.equal("tool" in a, false); }
        }
        for (const c of sc.conditions.filter((x) => x !== "consent_ok")) assert.ok(w.journal().includes(c), `get_context raised ${c}`);
      } else assert.equal("onboarding" in ctx || "next_actions" in ctx, false, "no onboarding hints unless the scenario asks for them");
      if (sc.backend.no_credit_account) {
        // SOHO-473: a registered borrower with no credit account reads null money sections, and prepare refuses
        // at the issuance gate (CreditIssuanceGate.authorizeBeforeSign) after the agent grant has passed.
        assert.equal(ctx.credit, null); assert.equal(ctx.repayment, null);
        assert.equal(ctx.purchasing_power.can_pay, false);
        const noCredit = () => w.journal().filter((c) => c === "no_credit_account").length;
        // Raised by the null-credit get_context read, so an agent that stops on the context alone still has the anchor.
        assert.equal(noCredit(), 1);
        if (ctx.workload_key.registered && ctx.authorization.status === "ACTIVE") {
          const p = await w.tool("prepare_x402_payment", { merchant: w.run.identity.pay_to, amount: "1000000", idempotency_key: "k-1" });
          assert.equal(p.ok, false); assert.equal(p.body.code, "CREDIT_ACCOUNT_NOT_FOUND");
          assert.equal(noCredit(), 2, "and again by the refused prepare");
        }
      } else if (sc.suite === "sohopay-x402") {
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

test("SOHO-479: an unproven wallet gets the real challenge, which no borrower signs; a borrower with no wallet gets none", async () => {
  const w = await up("prove-wallet-runs-wallet-proof");
  try {
    // The challenge takes the registered wallet's address, so get_borrower_status reports it (backend borrower.service.ts).
    const st = await w.tool("get_borrower_status");
    assert.equal(st.body.wallet_proof_verified, false);
    assert.match(st.body.wallet_address, /^0x[0-9a-f]{40}$/);
    assert.equal((await w.tool("get_borrower_status")).body.wallet_address, st.body.wallet_address, "the same wallet every call");
    const ch = await w.tool("request_signature_challenge", { wallet_address: st.body.wallet_address });
    assert.equal(ch.ok, true);
    assert.deepEqual(Object.keys(ch.body).sort(), ["challenge_id", "expires_at", "nonce", "typed_data"]);
    assert.match(ch.body.nonce, /^0x[0-9a-f]{64}$/);
    const sub = await w.tool("submit_signature", { borrower_id: w.run.identity.borrower_id, nonce: ch.body.nonce, signature: `0x${"ab".repeat(65)}` });
    assert.equal(sub.ok, false); assert.equal(sub.body.code, "SIGNATURE_INVALID");
    const tok = await w.tool("request_borrower_token", { scopes: ["spend:intent:create", "payment:read"] });
    assert.deepEqual(tok.body.dropped_scopes, [{ scope: "spend:intent:create", reason: "WALLET_PROOF_REQUIRED" }]);
    // Post-SOHO-476 (backend #1390): register_borrower and get_context now AGREE — register lists the same PROVE_WALLET
    // source step as get_context for an unproven wallet, so its next_actions can be trusted to route step 1 vs step 2.
    const reg = await w.tool("register_borrower");
    assert.equal(reg.body.spend_ready, false);
    const ctxActions = (await w.tool("get_context")).body.next_actions.map((a) => a.action);
    assert.deepEqual(reg.body.next_actions.map((a) => a.action), ctxActions, "register lists the same source steps as get_context");
    assert.deepEqual(reg.body.next_actions.map((a) => a.action), ["PROVE_WALLET"], "an unproven wallet lists PROVE_WALLET, not CONNECT_WALLET");
    const grant = await w.tool("authorize_agent", { operational_agent_id: w.run.identity.operational_agent_id });
    assert.equal(grant.ok, false); assert.equal(grant.body.code, "WALLET_PROOF_REQUIRED");
  } finally { await w.backend.close(); }
  const n = await up("connect-wallet-no-signature-request");
  try {
    const reg = await n.tool("register_borrower");
    assert.equal(reg.body.spend_ready, false);
    assert.deepEqual(reg.body.next_actions.map((a) => a.action), ["CONNECT_WALLET", "CONNECT_BANK"]);
    assert.ok(n.journal().includes("browser_step_listed"), "register_borrower shows the browser steps too");
    assert.equal((await n.tool("get_borrower_status")).body.wallet_address, null, "no wallet, no address");
    const ch = await n.tool("request_signature_challenge", {});
    assert.equal(ch.ok, false); assert.equal(ch.body.code, "WALLET_NOT_REGISTERED");
  } finally { await n.backend.close(); }
});

test("start_browser_handoff: a link for the first connect step, replayed per key, 409 when none is current", async () => {
  const handoffUrl = /^http:\/\/[^/]+\/onboarding\/handoff#[A-Za-z0-9_-]{20,}$/;
  const w = await up("connect-wallet-no-signature-request");
  try {
    assert.ok((await w.rpc("tools/list")).result.tools.some((t) => t.name === "start_browser_handoff"));
    const a = await w.tool("start_browser_handoff", { idempotency_key: "k-1" });
    assert.equal(a.ok, true);
    assert.deepEqual(Object.keys(a.body).sort(), ["action", "expires_at", "open_url"]);
    assert.equal(a.body.action, "CONNECT_WALLET", "the backend picks the first listed connect step");
    assert.match(a.body.open_url, handoffUrl);
    assert.ok(Date.parse(a.body.expires_at) > Date.now());
    assert.deepEqual((await w.tool("start_browser_handoff", { idempotency_key: "k-1" })).body, a.body, "same key replays the same link");
    assert.notEqual((await w.tool("start_browser_handoff", { idempotency_key: "k-2" })).body.open_url, a.body.open_url, "a new key mints a new link");
    // The link lives only in the handoff result, never on a get_context next action.
    assert.ok(!JSON.stringify((await w.tool("get_context")).body).includes("/onboarding/handoff"));
  } finally { await w.backend.close(); }
  const b = await up("prove-wallet-with-bank-alternative");
  try {
    assert.equal((await b.tool("start_browser_handoff", { idempotency_key: "k-1" })).body.action, "CONNECT_BANK", "PROVE_WALLET is not a connect step");
  } finally { await b.backend.close(); }
  const c = await up("open-url-step-no-invented-link");
  try {
    const r = await c.tool("start_browser_handoff", { idempotency_key: "k-1" });
    assert.equal(r.ok, false); assert.equal(r.body.code, "NO_BROWSER_HANDOFF");
  } finally { await c.backend.close(); }
});

test("review_facility_offer: a FACILITY_ACCEPT link for an open offer, replayed per key, 409 when none; hidden on an older server", async () => {
  const acceptUrl = /^http:\/\/[^/]+\/facility\/accept\?request_id=[A-Za-z0-9_-]{20,}$/;
  const w = await up("facility-accept-opens-review-url");
  try {
    assert.ok((await w.rpc("tools/list")).result.tools.some((t) => t.name === "review_facility_offer"));
    const ctx = (await w.tool("get_context")).body;
    assert.deepEqual(ctx.next_actions.map((a) => [a.action, a.tool, a.handoff_type]), [["REVIEW_AND_ACCEPT_FACILITY", "review_facility_offer", "OPEN_URL"]]);
    assert.ok(w.journal().includes("facility_offer_listed"));
    const a = await w.tool("review_facility_offer", { idempotency_key: "k-1" });
    assert.equal(a.ok, true);
    assert.deepEqual(Object.keys(a.body).sort(), ["action", "expires_at", "open_url"]);
    assert.equal(a.body.action, "FACILITY_ACCEPT");
    assert.match(a.body.open_url, acceptUrl);
    assert.deepEqual((await w.tool("review_facility_offer", { idempotency_key: "k-1" })).body, a.body, "same key replays the same link");
    assert.notEqual((await w.tool("review_facility_offer", { idempotency_key: "k-2" })).body.open_url, a.body.open_url, "a new key mints a new link");
    assert.ok(!JSON.stringify(ctx).includes("/facility/accept"), "the link lives only in the tool result");
  } finally { await w.backend.close(); }
  const none = await up("open-url-step-no-invented-link");
  try {
    const r = await none.tool("review_facility_offer", { idempotency_key: "k-1" });
    assert.equal(r.ok, false); assert.equal(r.body.code, "FACILITY_OFFER_NOT_AVAILABLE");
  } finally { await none.backend.close(); }
  const old = await up("facility-accept-tool-absent-no-link");
  try {
    assert.ok(!(await old.rpc("tools/list")).result.tools.some((t) => t.name === "review_facility_offer"), "an older catalog does not list it");
    const r = await old.tool("review_facility_offer", { idempotency_key: "k-1" });
    assert.equal(r.ok, false); assert.equal(r.body.code, "TOOL_NOT_FOUND");
    assert.equal((await old.tool("get_context")).body.next_actions[0].action, "REVIEW_AND_ACCEPT_FACILITY", "the backend still lists the step");
  } finally { await old.backend.close(); }
});

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

test("merchant: 402 + challenge, 200 only for a VERIFIED signed payment, 402 (with reason) for a forged/tampered one", async () => {
  const w = await up("header-opacity");
  try {
    const url = merchantUrl(w.base);
    const a = await fetch(url);
    assert.equal(a.status, 402);
    const body = await a.json();
    assert.equal(body.challenge.payment.payTo, w.run.identity.pay_to);
    assert.ok(a.headers.get("x-soho-payment-required"));

    // A real signed payment unlocks the resource: prepare → sign the voucher with the agent key → compose the
    // `<canary>.<base64url(envelope)>` header exactly as the signer's --write-header does.
    const prep = (await w.tool("prepare_x402_payment", { amount: body.challenge.payment.amount, order_ref: body.challenge.payment.orderRef })).body;
    const envelope = prep.envelope;
    envelope.paymentPayload.payload.signature = signWith(w.run.canaries.private_key, voucherSignedBytes(prep.voucher));
    const header = (env) => `${w.run.canaries.header_value}.${Buffer.from(JSON.stringify(env)).toString("base64url")}`;
    const get = (h) => fetch(url, { headers: { "PAYMENT-SIGNATURE": h } });
    assert.equal((await get(header(envelope))).status, 200, "a correctly signed payment is accepted");

    // The merchant VERIFIES; it never 200s on a bare string. Each forgery is rejected 402 with a reason.
    const reason = async (r) => { assert.equal(r.status, 402); return (await r.json()).reason; };
    assert.equal(await reason(await get(`FAKE-SP6-CANARY-HDR-wrong00000000000.${Buffer.from(JSON.stringify(envelope)).toString("base64url")}`)), "PAYMENT_SIGNATURE_INVALID");
    assert.equal(await reason(await get(w.run.canaries.header_value)), "PAYMENT_SIGNATURE_MALFORMED", "the bare canary with no envelope no longer unlocks");
    const unsigned = structuredClone(envelope); unsigned.paymentPayload.payload.signature = null;
    assert.equal(await reason(await get(header(unsigned))), "PAYMENT_ENVELOPE_INCOMPLETE");
    const tampered = structuredClone(envelope); tampered.paymentPayload.payload.voucher.amount = "1";
    assert.ok(["PAYMENT_ID_MISMATCH", "PAYMENT_SIGNATURE_INVALID"].includes(await reason(await get(header(tampered)))), "a tampered amount is caught");
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
