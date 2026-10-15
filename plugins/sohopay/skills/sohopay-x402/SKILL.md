---
name: sohopay-x402
description: >
  Pay HTTP 402 merchants with prepare_x402_payment, VOUCHER_ISSUED, and merchant-as-settler PAYMENT-SIGNATURE. Use when a URL returns 402, X-PAYMENT, facilitator settle, or borrower-direct /api/v2/x402 — never execute_payment or create_agent_session on human-direct.
license: Apache-2.0
metadata:
  hosted_name: x402-credit-pay
  title: SohoPay x402 Credit Settlement
  version: "1.0"
---

Execute the fast path. Do not write a plan. Do not fetch extra skills mid-pay if this file (or sticky `sohopay-x402`) is already loaded.

**Primary path:** `prepare_x402_payment` — V2 `VOUCHER_ISSUED` (agent Ed25519-signs) or V1 `COMPLETED`. Merchant settles. Never `execute_payment` / `create_agent_session` on human-direct.

**Before:** onboarding is complete — wallet proof, spend scopes, this host's terminal, a registered workload key, and an **ACTIVE** agent grant. If prepare returns `X402_AGENT_KEY_NOT_REGISTERED` or `AGENT_AUTHORIZATION_REQUIRED`, onboard was skipped — follow § Recovery if onboard was skipped before iterating prepare. Context comes from `{SKILL:sohopay-bootstrap}` (v8+ `get_context`; v7 `whoami` + `get_borrower_status`). If this chat has no `get_context` result yet, call it in Wave 1 (below), never as an extra wave; do not fetch the bootstrap skill mid-pay if this file is already loaded.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

A **payRequest** (“pay” / merchant 402 URL) is consent for a stale-token refresh, prepare, voucher sign, merchant retry, and first-time merchant. Complete a **warm** pay in **three waves, under 15 seconds**. Do not chat between waves. Skip `whoami`. `whoami.scopes` of `["borrower:token"]` is the OAuth JWT, not expiry.

Session cache: `borrower_id`, `operational_agent_id`, `token_requested_at` + `expires_in`, and the payment `idempotency_key` already used for this `orderRef`. Same `orderRef` → same payment key.

```text
Wave 1 (parallel): GET merchant URL | request_borrower_token ONLY if this chat has no successful token newer than 12 minutes (NO STOP) | get_context ONLY if this chat has no get_context result yet (else reuse cached borrower_id + operational_agent_id)
  get_context next_actions with handoff_type OPEN_URL (COMPLETE_PROFILE, CONNECT_BANK, …) → report them as the borrower's browser steps in the final message; they do NOT block the payment — keep paying. Never call `start_browser_handoff` from a pay, before or after the payment, and never invent a link. For CONNECT_WALLET / CONNECT_BANK, say the borrower can ask for the connect link once this payment is done (sohopay-onboard gets it). But get_context credit: null → STOP (No credit account gate below); do not prepare
Wave 2: prepare_x402_payment (one idempotency_key per orderRef)
  X402_AGENT_KEY_NOT_REGISTERED or AGENT_AUTHORIZATION_REQUIRED → § Recovery, then retry SAME key
  RISK_FIRST_TIME_MERCHANT → retry SAME key
  CREDIT_ACCOUNT_NOT_FOUND → STOP: no credit line yet (no retry, no sign, no merchant retry)
Wave 3: VOUCHER_ISSUED → route signing to the signer (references/signer.md): the signer's envelope mode (one file-based call) with the opaque --key (canonical path in references/signer.md); use the signer's header file (curl -fsS -H @<hdrfile>) and retry the URL. No signer → SIGNER_UNAVAILABLE, stop
  COMPLETED → header_name/header_value
  200 done | 202 poll get_settlement_status(~2s) by settlement_id; replay SAME header once CONFIRMED
SKIP: whoami, get_borrower_status, tools/list, authorization-context, register_borrower, authorize_agent
```

### Recovery if onboard was skipped

Do not discover prerequisites by serial 403s. `whoami.scopes` of `["borrower:token"]` is not a reason to re-onboard. Finish **sohopay-onboard** (`{SKILL:sohopay-onboard}`) once, then retry the **same** order / **same** key.

```text
whoami → register_borrower (store operational_agent_id)
  → request_borrower_token (include credit:facility:accept) — no chat prompt
  → keygen + register_agent_workload_key
  → authorize_agent: open consent URL in this turn — sohopay-authorize-agent
  → after Grant active: prepare SAME order / SAME idempotency_key
```

### STOP only if

| Gate | When |
|------|------|
| Wallet proof | Only if not already verified — off-device signature in this turn. Do not ask a chat question first |
| `authorize_agent` | Recovery only — `AGENT_AUTHORIZATION_REQUIRED`. Open the consent page in this turn. Do not ask first. Do not re-GET the merchant |
| Other policy deny | `POLICY_DECISION_DENIED` without `RISK_FIRST_TIME_MERCHANT` (or no payRequest) |
| No credit account | `credit: null` in the session's `get_context`, or `CREDIT_ACCOUNT_NOT_FOUND` (404) from prepare: the borrower has no credit line yet. Do not prepare again (any key, MCP or REST), sign, or retry the merchant. Tell the operator there is no credit line yet (never a zero limit) and follow `get_context` `next_actions`. Received gifts cannot be spent without a credit account either |

| Error | Action |
|-------|--------|
| `X402_AGENT_KEY_NOT_REGISTERED` | Terminal + key, retry same key — no custodial invent |
| `CUSTODIAL_SIGNING_DISABLED` | V2 voucher path only |
| `AGENT_AUTHORIZATION_REQUIRED` | Open consent page this turn — `{SKILL:sohopay-authorize-agent}` |
| `RISK_FIRST_TIME_MERCHANT` on payRequest | Accept; retry same order/key |
| `X402_INTENT_EXPIRED` | Retry same order/key — do not mint a new merchant `orderRef` |

Sign recipe + challenge map: [references/prepare-and-voucher.md](references/prepare-and-voucher.md). V1 `X-PAYMENT`: [references/v1-fallback.md](references/v1-fallback.md). Borrower-direct `/api/v2/x402`: [references/borrower-direct.md](references/borrower-direct.md). First-time merchant keys: **sohopay-spend**.

| Environment | `{API_BASE}` |
|-------------|--------------|
| Production | `https://api.sohopay.xyz` |
| Staging | `https://staging.api.sohopay.xyz` |
