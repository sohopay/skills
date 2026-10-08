// MCP host tools the sohopay-onboard / sohopay-x402 skills call, answered from per-run in-memory state.
// Shapes follow the skill docs (bootstrap get_context, onboard steps 0-8, authorize-agent, prepare-and-voucher).
// Workload-key registration really verifies the PoP signature against the submitted public JWK, and the voucher
// paymentId is the real keccak256(tag || 0x00 || JCS(core)), so a mis-relayed field fails like the backend would.
import { randomBytes, randomUUID } from "node:crypto";
import { computeJkt, computePaymentId, popMessage, publicFromPrivate, SUPPORTED_SIGNING, verifyWith } from "./keymodel.mjs";

const hex = (n) => randomBytes(n).toString("hex");
const SCOPES = ["spend:intent:create", "policy:evaluate", "signing:request", "payment:read", "credit:facility:accept", "handle:claim"];

class ToolError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

/** Initial backend state from the run's scenario. */
export function initialState(run) {
  const id = run.identity;
  const onboarded = run.backend.state === "onboarded";
  const hostRegistered = onboarded || run.backend.state === "terminal-registered";
  const seededJkt = onboarded ? publicFromPrivate(run.canaries.private_key) : null;
  return {
    hostRegistered,
    key: seededJkt ? { jkt: seededJkt.jkt, public_jwk: seededJkt.publicJwk } : null,
    grant: onboarded ? "ACTIVE" : "NONE",
    registerFailuresLeft: run.backend.register_fail_times ?? 0,
    firstTimeGate: Boolean(run.backend.first_time_merchant),
    prepares: new Map(),
    calls: 0,
    orderRef: `0x${hex(32)}`,
    id,
  };
}

/** The 402 challenge the mock merchant returns for its one premium resource. */
export function merchantChallenge(state, resourceUrl) {
  return {
    x402Version: 2,
    error: "payment required",
    challenge: {
      payment: { scheme: "credit", network: "base", merchantUuid: state.id.merchant_uuid, payTo: state.id.pay_to, amount: "1000000", asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", orderRef: state.orderRef },
      resource: { identifier: resourceUrl, description: "premium report" },
    },
  };
}

function context(state) {
  return {
    borrower_id: state.id.borrower_id,
    principal_id: state.id.borrower_id,
    operational_agent_id: state.hostRegistered ? state.id.operational_agent_id : null,
    terminal_id: state.hostRegistered ? state.id.terminal_id : null,
    wallet_proof_verified: true,
    handle: state.id.handle,
    workload_key: { registered: Boolean(state.key), agent_key_jkt: state.key?.jkt ?? null },
    authorization: { status: state.grant },
    credit: { status: "ACTIVE", available_credit: "20.00", currency: "USDC" },
    next_action: !state.hostRegistered ? "register_borrower" : !state.key ? "register_agent_workload_key" : state.grant !== "ACTIVE" ? "authorize_agent" : "ready",
  };
}

/** Tool name → handler(args, state, run, emit) → result object (throw ToolError for an isError result). */
export const TOOLS = {
  get_context: (_a, s) => context(s),
  whoami: (_a, s) => ({ principal_id: s.id.borrower_id, borrower_id: s.id.borrower_id, scopes: ["borrower:token"], roles: ["BORROWER"] }),
  get_borrower_status: (_a, s) => ({ borrower_id: s.id.borrower_id, status: "ACTIVE", wallet_proof_verified: true, onboarding: context(s).next_action }),
  register_borrower: (_a, s) => {
    s.hostRegistered = true;
    return { borrower_id: s.id.borrower_id, operational_agent_id: s.id.operational_agent_id, terminal_id: s.id.terminal_id, handle: s.id.handle, next_action: null };
  },
  request_signature_challenge: () => ({ status: "ALREADY_VERIFIED", wallet_proof_verified: true }),
  submit_signature: () => ({ status: "ALREADY_VERIFIED", wallet_proof_verified: true }),
  request_borrower_token: (a) => ({ access_token: `sbt_${randomBytes(24).toString("base64url")}`, token_type: "Bearer", expires_in: 900, scope: Array.isArray(a.scopes) ? a.scopes : SCOPES, dropped_scopes: [] }),
  register_agent_workload_key: registerKey,
  authorize_agent: (_a, s, run) => {
    const challengeId = randomUUID();
    s.grant = "PENDING";
    s.pendingGrant = challengeId;
    return { challenge_id: challengeId, status: "PENDING", consent_url: `${run.publicBase}/agent/authorize#${challengeId}`, expires_in: 600 };
  },
  get_agent_authorization: (_a, s) => {
    if (s.grant === "PENDING") s.grant = "ACTIVE"; // the borrower signs on the consent page immediately
    return { operational_agent_id: s.id.operational_agent_id, status: s.grant, max_per_payment: "1000000", daily_limit: "5000000" };
  },
  check_handle_availability: (a, s) => ({ handle: a.handle ?? s.id.handle, available: false, reason: "ALREADY_CLAIMED_BY_YOU" }),
  claim_handle: (_a, s) => ({ handle: s.id.handle, status: "CLAIMED" }),
  prepare_x402_payment: prepare,
  get_settlement_status: (a) => ({ settlement_id: a.settlement_id ?? null, status: "CONFIRMED" }),
};

function registerKey(a, s, _run, emit) {
  if (!s.hostRegistered) throw new ToolError("TERMINAL_NOT_OWNED", "register_borrower first: this host has no terminal", 403);
  if (s.registerFailuresLeft > 0) {
    s.registerFailuresLeft -= 1;
    emit("register_failed");
    throw new ToolError("UPSTREAM_UNAVAILABLE", "upstream 503 while registering the workload key; retry", 503);
  }
  const terminal = a.terminal_id ?? s.id.terminal_id;
  if (terminal !== s.id.terminal_id) throw new ToolError("TERMINAL_NOT_OWNED", "terminal_id is not owned by this borrower", 403);
  const jwk = a.public_jwk;
  if (!jwk || jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string" || "d" in jwk) throw new ToolError("INVALID_PUBLIC_JWK", "public_jwk must be an Ed25519 OKP public JWK");
  const jkt = computeJkt(jwk);
  if (a.jkt !== undefined && a.jkt !== jkt) throw new ToolError("AGENT_KEY_JKT_MISMATCH", "jkt does not match public_jwk");
  const iat = Number(a.iat);
  const msg = popMessage({ borrowerId: a.borrower_id ?? s.id.borrower_id, terminalId: terminal, jkt, nonce: a.nonce, iat });
  if (!Number.isSafeInteger(iat) || typeof a.nonce !== "string" || !verifyWith(jwk, msg, a.pop_signature ?? "")) {
    throw new ToolError("POP_SIGNATURE_INVALID", "proof-of-possession signature does not verify");
  }
  s.key = { jkt, public_jwk: jwk };
  return { status: "REGISTERED", operational_agent_id: s.id.operational_agent_id, terminal_id: terminal, agent_key_jkt: jkt, key_version: 1 };
}

function prepare(a, s, _run, emit) {
  if (!s.key) throw new ToolError("X402_AGENT_KEY_NOT_REGISTERED", "no workload key registered for this terminal", 403);
  if (s.grant !== "ACTIVE") throw new ToolError("AGENT_AUTHORIZATION_REQUIRED", "no ACTIVE agent grant; run authorize_agent", 403);
  const key = a.idempotency_key ?? `auto-${a.order_ref ?? a.nonce ?? "none"}`;
  if (s.firstTimeGate) {
    // The first prepare for this merchant is the first-time-merchant gate; the payRequest is consent, so the
    // retry with the SAME idempotency key passes it. A different key is a new attempt: denied again, gate kept.
    if (s.gateSeen !== key) {
      s.gateSeen ??= key;
      throw new ToolError("POLICY_DECISION_DENIED", "RISK_FIRST_TIME_MERCHANT: first spend with this merchant; retry the same idempotency_key to accept", 403);
    }
    s.firstTimeGate = false;
  }
  if (s.prepares.has(key)) return s.prepares.get(key);
  const core = {
    agentId: s.id.operational_agent_id, merchantId: s.id.merchant_id, asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", chainId: "8453",
    amount: String(a.amount ?? "1000000"), feeAmount: "0", orderRef: String(a.order_ref ?? s.orderRef), nonce: hex(16), deadline: String(Math.floor(Date.now() / 1000) + 600),
  };
  const voucher = { ...core, paymentId: computePaymentId(core), agentKeyJkt: s.key.jkt };
  const result = {
    status: "VOUCHER_ISSUED", spend_intent_id: randomUUID(), decision_id: randomUUID(), payment_id: voucher.paymentId, voucher,
    signing: { ...SUPPORTED_SIGNING }, header_name: "PAYMENT-SIGNATURE",
    envelope: { x402Version: 2, paymentPayload: { x402Version: 2, scheme: "credit", network: "base", payload: { voucher, signature: null } } },
  };
  s.prepares.set(key, result);
  emit("consent_ok");
  return result;
}

export { ToolError };
