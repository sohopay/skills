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

// What get_context shows for each scenario that sets backend.onboarding (backend next-action.resolver.ts shapes).
const browser = (action, reason_code) => ({ action, actor: "BORROWER", handoff_required: true, handoff_type: "OPEN_URL", reason_code });
const PROFILE = browser("COMPLETE_PROFILE", "PROFILE_COMPLETION_REQUIRED");
const BANK = browser("CONNECT_BANK", "FINANCIAL_SOURCE_REQUIRED");
const WALLET = browser("CONNECT_WALLET", "FINANCIAL_SOURCE_REQUIRED");
const PROVE = { action: "PROVE_WALLET", actor: "BORROWER", tool: "request_signature_challenge", handoff_required: true, reason_code: "WALLET_PROOF_REQUIRED" };
const PAY_ACTION = { action: "PAY", actor: "AGENT", tool: "prepare_x402_payment", handoff_required: false, reason_code: "SPENDING_AVAILABLE" };
const section = (verification_tier, profile_complete, status, spend_ready = false) => ({ verification_tier, profile_complete, credit_eligibility: { status, band: null }, spend_ready });
const ONBOARDING_WORLD = {
  "profile-data-stays-out-of-chat": { next_actions: [PROFILE], onboarding: section("WALLET_VERIFIED", false, "NOT_EVALUATED"), journal: ["profile_step_listed"] },
  "browser-step-gets-no-link": { next_actions: [PROFILE], onboarding: section("WALLET_VERIFIED", false, "NOT_EVALUATED"), journal: ["profile_step_listed"] },
  "wallet-proof-runs-as-tool-step": { next_actions: [PROVE], onboarding: section("PHONE_ONLY", true, "NOT_EVALUATED"), journal: ["wallet_proof_listed"] },
  "wallet-proof-with-bank-option": { next_actions: [PROVE, BANK], onboarding: section("PHONE_ONLY", true, "NOT_EVALUATED"), journal: ["wallet_proof_listed"] },
  "no-wallet-no-signature-ask": { next_actions: [WALLET, BANK], onboarding: section("PHONE_ONLY", true, "NOT_EVALUATED"), journal: ["connect_wallet_listed"] },
  "eligibility-review-waits": { next_actions: [], onboarding: section("WALLET_VERIFIED", true, "IN_REVIEW"), journal: ["eligibility_in_review"] },
  // The facility is active here, so the profile step is listed beside PAY and never replaces it.
  "pays-with-profile-incomplete": { next_actions: [PROFILE, PAY_ACTION], onboarding: section("WALLET_VERIFIED", false, "NOT_EVALUATED", false), journal: ["profile_step_listed"] },
};

test("SOHO-475: every scenario that sets backend.onboarding has its expected world pinned here", async () => {
  const withOnboarding = [];
  for (const id of SCENARIO_IDS) if ((await loadScenario(id)).backend.onboarding) withOnboarding.push(id);
  assert.deepEqual(withOnboarding.sort(), Object.keys(ONBOARDING_WORLD).sort());
});

test("SOHO-475: wallet proof for an unproven wallet issues a challenge and accepts no signature the borrower did not make", async () => {
  const w = await up("wallet-proof-runs-as-tool-step");
  try {
    const ch = await w.tool("request_signature_challenge", {});
    assert.equal(ch.ok, true); assert.equal(ch.body.status, "PENDING");
    assert.equal(ch.body.typed_data.message.borrowerId, w.run.identity.borrower_id);
    const sub = await w.tool("submit_signature", { challenge_id: ch.body.challenge_id, signature: `0x${"ab".repeat(65)}` });
    assert.equal(sub.ok, false); assert.equal(sub.body.code, "SIGNATURE_INVALID");
    assert.equal((await w.tool("get_borrower_status")).body.wallet_proof_verified, false);
    assert.deepEqual(w.journal(), [], "the wallet-proof tools raise no condition of their own");
  } finally { await w.backend.close(); }
});

test("SOHO-475: a borrower with no wallet registers as not spend-ready, gets no challenge, and loses the spend scopes", async () => {
  const w = await up("no-wallet-no-signature-ask");
  try {
    const reg = await w.tool("register_borrower", {});
    assert.equal(reg.body.spend_ready, false);
    assert.deepEqual(reg.body.next_actions, [WALLET, BANK]);
    assert.deepEqual(w.journal(), ["connect_wallet_listed"], "raised by register_borrower too, for an agent that skips get_context");
    const ch = await w.tool("request_signature_challenge", {});
    assert.equal(ch.ok, false); assert.equal(ch.body.code, "WALLET_NOT_FOUND");
    const tok = await w.tool("request_borrower_token", { scopes: ["spend:intent:create", "payment:read", "handle:claim"] });
    assert.deepEqual(tok.body.scope, ["payment:read", "handle:claim"]);
    assert.deepEqual(tok.body.dropped_scopes, [{ scope: "spend:intent:create", reason: "WALLET_PROOF_REQUIRED" }]);
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
      if (sc.backend.onboarding) {
        // SOHO-475: the onboarding section and next actions in the backend's own shapes and order, and the
        // condition that anchors the case.
        const want = ONBOARDING_WORLD[id];
        assert.ok(want, `mock-backend.test.mjs has no ONBOARDING_WORLD entry for ${id}`);
        assert.deepEqual(ctx.next_actions, want.next_actions);
        assert.deepEqual(ctx.onboarding, want.onboarding);
        assert.equal(ctx.wallet_proof_verified, want.onboarding.verification_tier === "WALLET_VERIFIED");
        assert.deepEqual(w.journal(), want.journal);
        // No facility outside the onboarded state: nothing that reads as a limit or balance (SOHO-473).
        if (sc.backend.state === "onboarded") assert.notEqual(ctx.credit, null);
        else { assert.equal(ctx.credit, null); assert.equal(ctx.repayment, null); assert.equal(ctx.purchasing_power.can_pay, false); }
      } else assert.equal("onboarding" in ctx || "next_actions" in ctx, false, "no onboarding hints unless the scenario asks for them");
      if (sc.backend.no_credit_account) {
        // SOHO-473: a registered borrower with no credit account reads null money sections, and prepare refuses
        // at the issuance gate (CreditIssuanceGate.authorizeBeforeSign) after the agent grant has passed.
        assert.equal(ctx.credit, null); assert.equal(ctx.repayment, null);
        assert.equal(ctx.purchasing_power.can_pay, false);
        const p = await w.tool("prepare_x402_payment", { merchant: w.run.identity.pay_to, amount: "1000000", idempotency_key: "k-1" });
        assert.equal(p.ok, false); assert.equal(p.body.code, "CREDIT_ACCOUNT_NOT_FOUND");
        // Raised by the null-credit get_context read AND by the refused prepare, so an agent that stops on the
        // context alone (never calling prepare) still produces the anchor.
        assert.deepEqual(w.journal(), ["no_credit_account", "no_credit_account"]);
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
