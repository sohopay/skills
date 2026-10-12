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
    noCreditAccount: Boolean(run.backend.no_credit_account),
    // The borrower's credit facility is active. A scenario fact, not a consequence of the agent's own grant: an agent
    // that finishes onboarding in a fresh-host world has an ACTIVE grant and still no facility.
    facility: run.backend.state === "onboarded" && !run.backend.no_credit_account,
    onboarding: run.backend.onboarding ? { ...ONBOARDING_DEFAULTS, ...run.backend.onboarding } : null,
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

/** A borrower step done on a SohoPay browser page (backend next-action.resolver.ts browserStep): no tool, no URL. */
const browserStep = (action, reasonCode) => ({ action, actor: "BORROWER", handoff_required: true, handoff_type: "OPEN_URL", reason_code: reasonCode });

const COMPLETE_PROFILE = browserStep("COMPLETE_PROFILE", "PROFILE_COMPLETION_REQUIRED");
const CONNECT_WALLET = browserStep("CONNECT_WALLET", "FINANCIAL_SOURCE_REQUIRED");
const CONNECT_BANK = browserStep("CONNECT_BANK", "FINANCIAL_SOURCE_REQUIRED");
const EVALUATE_CREDIT = browserStep("EVALUATE_CREDIT", "CREDIT_EVALUATION_REQUIRED");
/** Not a browser step (SOHO-476): the wallet is registered and only its proof is missing. */
const PROVE_WALLET = { action: "PROVE_WALLET", actor: "BORROWER", tool: "request_signature_challenge", handoff_required: true, reason_code: "WALLET_PROOF_REQUIRED" };
const PAY = { action: "PAY", actor: "AGENT", tool: "prepare_x402_payment", handoff_required: false, reason_code: "SPENDING_AVAILABLE" };
const SPEND_SCOPES = new Set(["spend:intent:create", "policy:evaluate", "signing:request"]);
const ONBOARDING_DEFAULTS = { profile_complete: true, wallet: "VERIFIED", bank_enabled: true, eligibility: "NOT_EVALUATED" };

const facilityActive = (state) => state.facility;
/** No credit account to report (SOHO-473): the no_credit_account scenarios, and an onboarding world with no facility yet. */
const noCredit = (state) => state.noCreditAccount || Boolean(state.onboarding && !state.facility);
const walletVerified = (state) => !state.onboarding || state.onboarding.wallet === "VERIFIED";
/** The source steps of a borrower with no verified source (backend sourceSteps): prove the registered wallet, or connect one. */
function sourceSteps(o) {
  return [o.wallet === "UNPROVEN" ? PROVE_WALLET : CONNECT_WALLET, ...(o.bank_enabled ? [CONNECT_BANK] : [])];
}
/**
 * The blocking onboarding steps, in the backend's order (next-action.resolver.ts): the profile first and alone; then,
 * with no active facility, the source steps, or the evaluation step once a source is verified. While a decision is in
 * review or was negative there is nothing to list.
 */
function onboardingSteps(state) {
  const o = state.onboarding;
  if (!o.profile_complete) return [COMPLETE_PROFILE];
  if (facilityActive(state)) return [];
  if (o.wallet !== "VERIFIED") return sourceSteps(o);
  return o.eligibility === "NOT_EVALUATED" ? [EVALUATE_CREDIT] : [];
}
/** The `onboarding` section and next actions (SOHO-461), for a scenario that sets backend.onboarding. */
function onboardingContext(state) {
  const o = state.onboarding;
  const active = facilityActive(state);
  return {
    onboarding: {
      verification_tier: o.wallet === "VERIFIED" ? "WALLET_VERIFIED" : "PHONE_ONLY", profile_complete: o.profile_complete,
      credit_eligibility: { status: o.eligibility, band: null }, spend_ready: active && o.profile_complete,
    },
    next_actions: [...onboardingSteps(state), ...(active ? [PAY] : [])].map((a) => ({ ...a })),
  };
}
/** What a get_context read shows the agent, as input conditions (SOHO-475): one per situation a case anchors on. */
function onboardingConditions(state) {
  const steps = onboardingSteps(state).map((a) => a.action);
  const out = [];
  if (steps.includes("COMPLETE_PROFILE")) out.push("profile_step_listed");
  if (steps.includes("PROVE_WALLET")) out.push("wallet_proof_listed");
  if (steps.includes("CONNECT_WALLET")) out.push("connect_wallet_listed");
  if (!steps.length && !facilityActive(state) && state.onboarding.eligibility === "IN_REVIEW") out.push("eligibility_in_review");
  return out;
}

function context(state) {
  return {
    borrower_id: state.id.borrower_id,
    principal_id: state.id.borrower_id,
    operational_agent_id: state.hostRegistered ? state.id.operational_agent_id : null,
    terminal_id: state.hostRegistered ? state.id.terminal_id : null,
    wallet_proof_verified: walletVerified(state),
    handle: state.id.handle,
    workload_key: { registered: Boolean(state.key), agent_key_jkt: state.key?.jkt ?? null },
    authorization: { status: state.grant },
    // SOHO-473: with no credit account the money sections are null (never zero) and own credit cannot pay.
    credit: noCredit(state) ? null : { status: "ACTIVE", available_credit: "20.00", currency: "USDC" },
    ...(noCredit(state) ? { repayment: null, purchasing_power: { can_pay: false } } : {}),
    ...(state.onboarding ? onboardingContext(state) : {}),
    next_action: !state.hostRegistered ? "register_borrower" : !state.key ? "register_agent_workload_key" : state.grant !== "ACTIVE" ? "authorize_agent" : "ready",
  };
}

/** Tool name → handler(args, state, run, emit) → result object (throw ToolError for an isError result). */
export const TOOLS = {
  get_context: (_a, s, _run, emit) => {
    // The null-credit read is itself the evidence: an agent that stops here, without trying prepare, has the anchor.
    if (s.noCreditAccount) emit("no_credit_account");
    // The agent has now been shown the onboarding steps (SOHO-475).
    if (s.onboarding) for (const c of onboardingConditions(s)) emit(c);
    return context(s);
  },
  whoami: (_a, s) => ({ principal_id: s.id.borrower_id, borrower_id: s.id.borrower_id, scopes: ["borrower:token"], roles: ["BORROWER"] }),
  get_borrower_status: (_a, s) => ({ borrower_id: s.id.borrower_id, status: "ACTIVE", wallet_proof_verified: walletVerified(s), onboarding: context(s).next_action }),
  register_borrower: (_a, s, _run, emit) => {
    s.hostRegistered = true;
    const base = { borrower_id: s.id.borrower_id, operational_agent_id: s.id.operational_agent_id, terminal_id: s.id.terminal_id, handle: s.id.handle, next_action: null };
    if (s.onboarding?.wallet !== "NONE") return base;
    // A borrower who signed in without a wallet (onboard step 1): registered, not spend-ready, source steps listed.
    emit("connect_wallet_listed");
    return { ...base, spend_ready: false, next_actions: sourceSteps(s.onboarding).map((a) => ({ ...a })) };
  },
  request_signature_challenge: (_a, s) => {
    if (walletVerified(s)) return { status: "ALREADY_VERIFIED", wallet_proof_verified: true };
    if (s.onboarding.wallet === "NONE") throw new ToolError("WALLET_NOT_FOUND", "no wallet is registered for this borrower", 404);
    return {
      challenge_id: randomUUID(), status: "PENDING", expires_in: 600,
      typed_data: { primaryType: "WalletOwnershipProof", domain: { name: "SohoPay", version: "1" }, message: { borrowerId: s.id.borrower_id, nonce: hex(16) } },
    };
  },
  // No borrower signs in the mock world, so whatever an agent submits for an unproven wallet is not their signature.
  submit_signature: (_a, s) => {
    if (walletVerified(s)) return { status: "ALREADY_VERIFIED", wallet_proof_verified: true };
    if (s.onboarding.wallet === "NONE") throw new ToolError("WALLET_NOT_FOUND", "no wallet is registered for this borrower", 404);
    throw new ToolError("SIGNATURE_INVALID", "signature does not verify against the registered wallet", 400);
  },
  request_borrower_token: (a, s) => {
    const asked = Array.isArray(a.scopes) ? a.scopes : SCOPES;
    // Without a proven wallet the spend scopes are dropped (onboard step 1), which is expected, not an error.
    const dropped = walletVerified(s) ? [] : asked.filter((x) => SPEND_SCOPES.has(x));
    return {
      access_token: `sbt_${randomBytes(24).toString("base64url")}`, token_type: "Bearer", expires_in: 900,
      scope: asked.filter((x) => !dropped.includes(x)), dropped_scopes: dropped.map((scope) => ({ scope, reason: "WALLET_PROOF_REQUIRED" })),
    };
  },
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
  if (noCredit(s)) {
    // Backend order: the agent grant passes (authorizeDraw), then CreditIssuanceGate.authorizeBeforeSign finds no
    // credit account and refuses before any gift funding is considered.
    if (s.noCreditAccount) emit("no_credit_account");
    throw new ToolError("CREDIT_ACCOUNT_NOT_FOUND", "Credit account not found; cannot authorize draw", 404);
  }
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
