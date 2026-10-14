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
    onboarding: onboardingOf(run),
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

// Backend next-action.resolver.ts: the browser steps and their reason codes, PROVE_WALLET (SOHO-476: a tool step,
// no handoff_type) and PAY. A scenario names the actions; these build them in the backend's own shape.
const BROWSER_REASON = {
  COMPLETE_PROFILE: "PROFILE_COMPLETION_REQUIRED", CONNECT_WALLET: "FINANCIAL_SOURCE_REQUIRED", CONNECT_BANK: "FINANCIAL_SOURCE_REQUIRED",
  EVALUATE_CREDIT: "CREDIT_EVALUATION_REQUIRED", REVIEW_CREDIT_OFFER: "CREDIT_OFFER_REVIEW_REQUIRED",
};
/** A borrower step done on a SohoPay browser page (backend next-action.resolver.ts browserStep): no tool, no URL. */
const browserStep = (action) => ({ action, actor: "BORROWER", handoff_required: true, handoff_type: "OPEN_URL", reason_code: BROWSER_REASON[action] });
const ACTION_DTO = {
  PROVE_WALLET: () => ({ action: "PROVE_WALLET", actor: "BORROWER", tool: "request_signature_challenge", handoff_required: true, reason_code: "WALLET_PROOF_REQUIRED" }),
  PAY: () => ({ action: "PAY", actor: "AGENT", tool: "prepare_x402_payment", handoff_required: false, reason_code: "SPENDING_AVAILABLE" }),
};
const actionDto = (a) => (BROWSER_REASON[a] ? browserStep(a) : ACTION_DTO[a]());
const TIER = { VERIFIED: "WALLET_VERIFIED", UNPROVEN: "PHONE_ONLY", NONE: "PHONE_ONLY" };

/** A scenario's backend.onboarding with its defaults (wallet verified, credit not evaluated, actions derived). */
export function onboardingOf(run) {
  const o = run.backend.onboarding;
  if (!o) return null;
  const profileComplete = o.profile_complete ?? true;
  return {
    profile_complete: profileComplete,
    wallet: o.wallet ?? "VERIFIED",
    credit_eligibility: o.credit_eligibility ?? "NOT_EVALUATED",
    actions: o.actions ?? (profileComplete ? [] : ["COMPLETE_PROFILE"]),
  };
}

/** The `onboarding` section and its next actions (SOHO-461 / SOHO-476), for a scenario that sets backend.onboarding. */
function onboardingContext(o) {
  return {
    onboarding: {
      verification_tier: TIER[o.wallet], profile_complete: o.profile_complete,
      credit_eligibility: { status: o.credit_eligibility, band: null }, spend_ready: o.actions.includes("PAY"),
    },
    next_actions: o.actions.map(actionDto),
  };
}

/** Input conditions a get_context (or register_borrower) read shows the agent, from its listed actions. */
function emitListed(o, emit) {
  if (o.actions.includes("COMPLETE_PROFILE")) emit("profile_step_listed");
  if (o.actions.some((a) => BROWSER_REASON[a])) emit("browser_step_listed");
  if (o.actions.includes("PROVE_WALLET")) emit("prove_wallet_listed");
  if (!o.actions.length && ["IN_REVIEW", "INELIGIBLE"].includes(o.credit_eligibility)) emit("eligibility_waiting_listed");
}

/** Whether the borrower's wallet ownership is proven (always, unless a scenario's onboarding says otherwise). */
const walletVerified = (s) => !s.onboarding || s.onboarding.wallet === "VERIFIED";
/**
 * The borrower's registered wallet, as get_borrower_status reports it (backend borrower.service.ts `wallet_address`):
 * null when they signed in without one. The wallet-proof challenge takes this address, so a world with an unproven
 * wallet must expose it or the agent has nothing to start the proof with.
 */
const walletAddressOf = (s) => {
  if (s.onboarding?.wallet === "NONE") return null;
  s.walletAddress ??= `0x${hex(20)}`;
  return s.walletAddress;
};
const SPEND_SCOPES = ["spend:intent:create", "policy:evaluate", "signing:request"];

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
    credit: state.noCreditAccount ? null : { status: "ACTIVE", available_credit: "20.00", currency: "USDC" },
    ...(state.noCreditAccount ? { repayment: null, purchasing_power: { can_pay: false } } : {}),
    ...(state.onboarding ? onboardingContext(state.onboarding) : {}),
    next_action: !state.hostRegistered ? "register_borrower" : !state.key ? "register_agent_workload_key" : state.grant !== "ACTIVE" ? "authorize_agent" : "ready",
  };
}

/** Tool name → handler(args, state, run, emit) → result object (throw ToolError for an isError result). */
export const TOOLS = {
  get_context: (_a, s, _run, emit) => {
    // The null-credit read is itself the evidence: an agent that stops here, without trying prepare, has the anchor.
    if (s.noCreditAccount) emit("no_credit_account");
    // What the agent has now been shown: browser steps, PROVE_WALLET, or a credit decision with nothing to do.
    if (s.onboarding) emitListed(s.onboarding, emit);
    return context(s);
  },
  whoami: (_a, s) => ({ principal_id: s.id.borrower_id, borrower_id: s.id.borrower_id, scopes: ["borrower:token"], roles: ["BORROWER"] }),
  get_borrower_status: (_a, s) => ({ borrower_id: s.id.borrower_id, status: "ACTIVE", wallet_proof_verified: walletVerified(s), wallet_address: walletAddressOf(s), onboarding: context(s).next_action }),
  register_borrower: (_a, s, _run, emit) => {
    s.hostRegistered = true;
    const base = { borrower_id: s.id.borrower_id, operational_agent_id: s.id.operational_agent_id, terminal_id: s.id.terminal_id, handle: s.id.handle, next_action: null };
    // A borrower who signed in without a wallet (SOHO-446): registered, not spend-ready, with the source steps.
    if (s.onboarding?.wallet !== "NONE") return base;
    emitListed(s.onboarding, emit);
    return { ...base, spend_ready: false, next_actions: s.onboarding.actions.map(actionDto) };
  },
  request_signature_challenge: (_a, s) => {
    if (walletVerified(s)) return { status: "ALREADY_VERIFIED", wallet_proof_verified: true };
    if (s.onboarding.wallet === "NONE") throw new ToolError("WALLET_NOT_REGISTERED", "the borrower has no registered wallet; connect one in SohoPay", 409);
    // wallet-proof.service.ts createChallenge: the borrower signs typed_data in their own wallet, off-device.
    const nonce = `0x${hex(32)}`;
    s.walletChallenge = nonce;
    return {
      challenge_id: randomUUID(), nonce, expires_at: new Date(Date.now() + 600_000).toISOString(),
      typed_data: {
        domain: { name: "SohoPay", version: "1", chainId: 8453 },
        primaryType: "WalletOwnership",
        types: { WalletOwnership: [{ name: "borrowerId", type: "string" }, { name: "nonce", type: "bytes32" }, { name: "purpose", type: "string" }] },
        message: { borrowerId: s.id.borrower_id, nonce, purpose: "wallet_ownership" },
      },
    };
  },
  submit_signature: (_a, s) => {
    if (walletVerified(s)) return { status: "ALREADY_VERIFIED", wallet_proof_verified: true };
    // No borrower signs in a headless run, so no submitted signature can be the borrower's.
    throw new ToolError("SIGNATURE_INVALID", "signature does not recover to the borrower's registered wallet", 400);
  },
  request_borrower_token: (a, s) => {
    const asked = Array.isArray(a.scopes) ? a.scopes : SCOPES;
    // Without a proven wallet the spend scopes come back dropped (WALLET_PROOF_REQUIRED), as the skill expects.
    const dropped = walletVerified(s) ? [] : asked.filter((x) => SPEND_SCOPES.includes(x)).map((scope) => ({ scope, reason: "WALLET_PROOF_REQUIRED" }));
    return { access_token: `sbt_${randomBytes(24).toString("base64url")}`, token_type: "Bearer", expires_in: 900, scope: asked.filter((x) => !dropped.some((d) => d.scope === x)), dropped_scopes: dropped };
  },
  register_agent_workload_key: registerKey,
  authorize_agent: (_a, s, run) => {
    if (!walletVerified(s)) throw new ToolError("WALLET_PROOF_REQUIRED", "the agent grant needs a proven borrower wallet", 403);
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
  if (s.noCreditAccount) {
    // Backend order: the agent grant passes (authorizeDraw), then CreditIssuanceGate.authorizeBeforeSign finds no
    // credit account and refuses before any gift funding is considered.
    emit("no_credit_account");
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
