<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Spend, Policy, and Payment

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**What this skill does:** creates spend intents, evaluates policy, signs PaymentIntents when needed, and executes confirm-only payments. **Before running it:** the borrower is onboarded with spend/payment scopes and (if delegating) a session exists.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

CRITICAL: `execute_payment` is **confirm-only** — MCP confirms a policy-approved spend (and optional merchant-initiated `payment_id`). Agents do not invent merchant payments out of band.

Pass `idempotency_key` (UUID v4) on every write tool when the harness cannot set HTTP headers — see `{SKILLS_BASE}/idempotency.md`.

## Human-direct path (no session)

If the borrower acts directly (not via a delegated agent), use the human-direct-flow skill — skip session tools and omit `session_id`:

```bash
curl -fsSL {SKILLS_BASE}/human-direct-flow.md
```

## Flow

1. **Create spend intent** — `create_spend_intent` / `POST /api/v1/spend/intents`
2. **Evaluate policy** — `evaluate_spend_policy` / `POST /api/v1/policy/evaluate`
3. **Sign PaymentIntent** — `sign_transaction` with `policy_decision_id` (binds the evaluated intent, keeps `orderRef` byte-identical) → poll `get_signing_status` for `signature` (`intentSig`)
4. **Execute payment** — `execute_payment` / `POST /api/v1/payments/execute` → keep `settlement_id`
5. **Poll settlement** — `get_settlement_status` with **`settlement_id`** until a **terminal** status

High-risk routes require **2FA-equivalent**: verified wallet-proof + server-side borrower 2FA flag (not a JWT claim).

Before executing any payment (especially the first or any high-risk one):

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

## create_spend_intent — field rules

| Rule | Detail |
|------|--------|
| Merchant | Supply **`merchant`** (EVM address) **XOR** **`merchant_id`** (string). Do **not** rely on cross-fill — the MCP mapper no longer copies one into the other. |
| Amount | Supply **`amount`** (uint256 base units) **XOR** **`amount_decimal`** (USDC decimal ≤6 fractional digits). |
| Agent-only | `memo` and `currency` may appear in the tool schema but are **not forwarded** to the backend. |
| x402 / paywall | Prefer `order_ref` and `resource_identifier` from the merchant 402 challenge when paying a protected resource. |

## Signing and intentSig

1. Call `sign_transaction` with `borrower_id`, `signing_purpose`, `payload_type`, `payload`, and **`policy_decision_id`** (the `decision_id` returned by `evaluate_spend_policy`), plus optional `session_id`.
2. Keep `request_id` from the accepted response. The response also echoes **`payment_intent`** — `agentId`, `merchantId`, `asset`, `amount`, `feeAmount`, `orderRef`, `nonce`, `deadline`. Keep it: these are the exact wire values an `X-PAYMENT` envelope needs, and `nonce` / `deadline` are not available from any other tool.
3. Poll `get_signing_status` until `COMPLETED`.
4. The returned **`signature`** is the unredacted **`intentSig`** (Envelope 1 over PaymentIntent). Use it for merchant `X-PAYMENT` envelopes and for borrower-direct x402 settle. It is the only tool response field exempt from MCP redaction.

### sign_transaction — field rules

| Rule | Detail |
|------|--------|
| Binding | **`policy_decision_id` is required in practice.** The gateway maps it to `decision_id` and hydrates merchant / asset / amount / `orderRef` from the bound policy decision, keeping the PaymentIntent byte-identical across sign → execute / settle. The backend signing DTO declares `decision_id` as a required UUID. |
| `spend_intent_id` | **Not accepted by this tool.** It is absent from the MCP signing schema and silently stripped, so passing it changes nothing. Bind through `policy_decision_id` — the decision already points at the spend intent. |
| `payload` | Must be a **JSON object**, not a string. ⚠️ The published MCP JSON Schema mis-advertises this field as `"type": "string"`, but the server validates it as an object and rejects a string with `Expected object, received string`. Trust this rule over the advertised schema. Only `payload.payload_hash` is forwarded to the backend — every other key stays local. Pass `{}` when you have no precomputed hash. |
| `signing_purpose` / `payload_type` | Required by the tool schema but **not forwarded**; the gateway derives signing mode from `decision_id`. |

Before requesting a signature:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

## Settlement finality and available credit (tell the operator)

`execute_payment` returning `202` / `SUBMITTED` with a `tx_hash` and `settlement_id` means the settle tx was **submitted**, not that credit has finished drawing down.

| Status | Meaning |
|--------|---------|
| `CREATED` | Row created, not yet submitted |
| `SUBMITTED` | On-chain tx submitted |
| `PENDING_CONFIRMATION` | Waiting for Base L2 `finalized` (~15–19 min typical). Same `txHash` is re-polled — **not** a new payment |
| `CONFIRMED` | Dual-confirm + finality passed; off-chain credit **drawdown** applied |
| `FAILED` | Terminal failure |
| `TIMED_OUT` | Non-terminal past ~30 minutes — surface to operator; do not invent a second payment |
| `DISPUTED` | Dual-confirm mismatch |

**Agent instructions:**

1. After execute, poll `get_settlement_status` with **`settlement_id`** (UUID from execute). Optional legacy fallback: numeric `job_id` only. **`payment_id` is not accepted.** The tool schema marks only `borrower_id` as required, but you must still supply one of `settlement_id` or `job_id`.
2. Tell the operator that **available credit / outstanding balance may lag** until `CONFIRMED`. `get_outstanding_balance` can look unchanged for many minutes even when Basescan already shows the tx.
3. Do **not** treat confirmation retries as duplicate spends; the confirmation worker only polls the existing `txHash`.
4. If status stays non-terminal past ~30 minutes, surface `TIMED_OUT` (or stuck `PENDING_CONFIRMATION`) to the operator — admin re-drive may be required; do not invent a second payment.

## MCP tools (catalog v2)

| Tool | Scope | Wallet proof | KYC | Idempotent |
|------|-------|:------------:|:---:|:----------:|
| `create_spend_intent` | spend:intent:create | ✅ | ✅ | Yes |
| `evaluate_spend_policy` | policy:evaluate | — | — | Yes |
| `sign_transaction` | signing:request | ✅ | — (+ 2FA-equiv) | Yes |
| `get_signing_status` | signing:request | — | — | No |
| `execute_payment` | payment:execute | ✅ | ✅ | Yes |
| `get_settlement_status` | payment:read | — | — | No |
| `get_outstanding_balance` | repayment:read | — | — | No |
| `create_repayment` | repayment:execute | — | — | Yes |
| `execute_repayment` | repayment:execute | — | — | Yes |

## Backend endpoints

| Method | Path | Scope |
|--------|------|-------|
| POST | `/api/v1/spend/intents` | spend:intent:create |
| GET | `/api/v1/spend/intents/:id` | spend:intent:create |
| POST | `/api/v1/policy/evaluate` | policy:evaluate |
| POST | `/api/v1/signing/request` | signing:request |
| GET | `/api/v1/signing/request/:id` | signing:request |
| POST | `/api/v1/payments/execute` | payment:execute |
| GET | `/api/v1/payments/by-settlement/:settlementId/status` | payment:read (preferred) |
| GET | `/api/v1/payments/:jobId/status` | payment:read (legacy job_id) |
| GET | `/api/v1/repayments/quote` | repayment:read |
| POST | `/api/v1/repayments/prepare` | repayment:execute |

## Before privileged calls

1. **Confirm the borrower token is still valid.** It is short-lived (staging: `expires_in: 900`, 15 minutes) and is not auto-refreshed. Re-request it via `request_borrower_token` immediately before spending rather than once per session — see `{SKILLS_BASE}/borrower-onboard.md` § Token lifetime.
2. Resolve live authz: `POST /api/v1/auth/authorization-context`
3. Confirm borrower not frozen/suspended for money movement
4. Attach `Idempotency-Key: <uuid-v4>` on all writes — or pass `idempotency_key` in tool args

## Account-state gate

Blocked for sanctioned/OFAC, fraud-held, inactive accounts. Frozen/suspended borrowers may still repay (separate flow).

## Next steps

- x402 HTTP rail (merchant-as-settler): `curl -fsSL {SKILLS_BASE}/x402-credit-pay.md`
- Idempotency: `curl -fsSL {SKILLS_BASE}/idempotency.md`
