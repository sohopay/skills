// What the mock MCP server advertises: tool descriptions, input schemas and server instructions written the way
// the real SohoPay MCP server words them (no eval/mock vocabulary), so a live model meets the same surface it would
// meet in production. Descriptions are guidance only; the handlers in backend-tools.mjs decide every outcome.

const str = (description) => ({ type: "string", description });
const idem = str("UUID v4 idempotency key; reuse the SAME key to retry the same write.");

/** Server instructions returned by `initialize` (mirrors the real server's wording, minus hosted-doc URLs). */
export const SERVER_INSTRUCTIONS = [
  "SohoPay MCP validates, authorizes, and forwards to sohopay-backend. It does not move money by itself and never holds borrower private keys — borrowers sign EIP-712 off-device.",
  "Use tool descriptions and input schemas for single call-time rules (identity, XOR fields, required IDs).",
  "The published tools cover five jobs — install, onboard, account info, merchant x402 payment, and repayment. For each multi-step flow, prefer a local sticky sohopay-* skill folder (SKILL.md + references/) when present, e.g. ~/.claude/skills/sohopay-onboard/ or ~/.claude/skills/sohopay-x402/.",
  "Account: get_context (preferred first read), whoami, get_borrower_status. get_context is DESCRIPTIVE: it reports what is likely allowed, but execution-time checks decide.",
  "Workload keys are generated and used only by the local sohopay-signer; never paste, print or upload private key material.",
].join("\n");

/** name -> { description, inputSchema } for every tool in backend-tools.mjs TOOLS. */
export const TOOL_CATALOG = {
  get_context: {
    description: "Backend-backed identity + credit + authorization + next step in one call. Prefer it for \"who am I / can I pay / what next\". Returns borrower_id, operational_agent_id, terminal_id, workload_key, authorization and next_action.",
    inputSchema: { type: "object", properties: {} },
  },
  whoami: {
    description: "JWT claims only, no backend call (principal_id / scopes / roles). Deprecated in favor of get_context; kept for rollback.",
    inputSchema: { type: "object", properties: {} },
  },
  get_borrower_status: {
    description: "Borrower onboarding status: wallet proof, facility state and the next onboarding action.",
    inputSchema: { type: "object", properties: { borrower_id: str("Borrower UUID (optional; defaults to the authenticated borrower).") } },
  },
  register_borrower: {
    description: "Register this host as an operational agent for the borrower. Returns operational_agent_id + terminal_id — store both. Safe to retry with the same idempotency_key.",
    inputSchema: { type: "object", properties: { idempotency_key: idem, display_name: str("Optional agent display name.") } },
  },
  request_signature_challenge: {
    description: "Start the borrower wallet proof (EIP-712). The borrower signs off-device; the agent never signs for the wallet.",
    inputSchema: { type: "object", properties: { wallet_address: str("Borrower EOA address.") } },
  },
  submit_signature: {
    description: "Submit the borrower's EIP-712 wallet-proof signature returned by the signing page.",
    inputSchema: { type: "object", properties: { challenge_id: str("Challenge id."), signature: str("0x-prefixed EIP-712 signature.") } },
  },
  request_borrower_token: {
    description: "Issue a short-lived borrower token with the requested scopes (spend:intent:create, policy:evaluate, signing:request, payment:read, credit:facility:accept, handle:claim). Re-request when it expires; there is no refresh call.",
    inputSchema: { type: "object", properties: { scopes: { type: "array", items: { type: "string" }, description: "Scopes to request." } }, required: ["scopes"] },
  },
  register_agent_workload_key: {
    description: "Register the agent's Ed25519 workload PUBLIC key for this terminal with a proof of possession. Send public_jwk, jkt and the signer's pop_signature + nonce + iat exactly as the signer returned them.",
    inputSchema: {
      type: "object",
      properties: {
        borrower_id: str("Borrower UUID."), terminal_id: str("Terminal id from register_borrower."),
        public_jwk: { type: "object", description: "Ed25519 OKP public JWK {kty, crv, x} — never a private member." },
        jkt: str("RFC 7638 thumbprint of public_jwk."), pop_signature: str("base64url PoP signature from the signer."),
        nonce: str("PoP nonce from the signer."), iat: { type: "integer", description: "PoP issued-at (seconds) from the signer." },
        idempotency_key: idem,
      },
      required: ["terminal_id", "public_jwk", "pop_signature", "nonce", "iat"],
    },
  },
  authorize_agent: {
    description: "Create the agent authorization grant request. Returns a consent_url the borrower opens to sign; poll get_agent_authorization until status is ACTIVE.",
    inputSchema: {
      type: "object",
      properties: { operational_agent_id: str("Operational agent id."), max_per_payment: str("Per-payment cap (USDC base units)."), daily_limit: str("Daily cap (USDC base units)."), idempotency_key: idem },
      required: ["operational_agent_id"],
    },
  },
  get_agent_authorization: {
    description: "Current agent authorization grant status (NONE / PENDING / ACTIVE) and its limits.",
    inputSchema: { type: "object", properties: { operational_agent_id: str("Operational agent id.") } },
  },
  check_handle_availability: {
    description: "Check whether a SohoPay @handle is available to claim.",
    inputSchema: { type: "object", properties: { handle: str("Handle without the @.") }, required: ["handle"] },
  },
  claim_handle: {
    description: "Claim a SohoPay @handle for this borrower (requires handle:claim).",
    inputSchema: { type: "object", properties: { handle: str("Handle without the @."), idempotency_key: idem }, required: ["handle"] },
  },
  prepare_x402_payment: {
    description: "Prepare an x402 credit payment for a merchant 402 challenge. On success returns status VOUCHER_ISSUED with an UNSIGNED voucher, payment_id and header_name; sign it with the local sohopay-signer (voucher sign --envelope) and retry the merchant with the header. A POLICY_DECISION_DENIED for a first-time merchant is cleared by retrying with the SAME idempotency_key.",
    inputSchema: {
      type: "object",
      properties: { merchant: str("Merchant payTo / id from the 402 challenge."), amount: str("Amount (base units) from the challenge."), order_ref: str("orderRef from the challenge."), idempotency_key: idem },
      required: ["merchant", "amount", "idempotency_key"],
    },
  },
  get_settlement_status: {
    description: "Settlement status for a captured payment.",
    inputSchema: { type: "object", properties: { settlement_id: str("Settlement or payment id.") } },
  },
};
