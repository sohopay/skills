<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Spend, Policy, and Payment

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**What this skill does:** creates spend intents, evaluates policy, signs PaymentIntents when needed, and executes confirm-only payments. **Before running it:** the borrower is onboarded with spend/payment scopes and (if delegating) a session exists.

MCP tool descriptions summarize call-time rules (XOR fields, required IDs); **this skill is authoritative** for ordering and operator STOP gates.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

CRITICAL: `execute_payment` is **confirm-only** — MCP confirms a policy-approved spend (and optional merchant-initiated `payment_id`). Agents do not invent merchant payments out of band.

**HTTP 402 merchant paywalls are a different rail.** Do **not** end that flow with `execute_payment`. After signing, follow `{SKILLS_BASE}/x402-credit-pay.md` (merchant-as-settler + `X-PAYMENT`). Human-direct paywalls also skip sessions — see `{SKILLS_BASE}/human-direct-flow.md`.

Pass `idempotency_key` (UUID v4) on every write tool when the harness cannot set HTTP headers — see `{SKILLS_BASE}/idempotency.md`.

## Human-direct path (no session)

If the borrower acts directly (not via a delegated agent), use the human-direct-flow skill — skip session tools and omit `session_id`:

```bash
curl -fsSL {SKILLS_BASE}/human-direct-flow.md
```

## Flow fork: MCP confirm vs HTTP 402

| Situation | After `sign_transaction` + `get_signing_status` |
|-----------|--------------------------------------------------|
| Non-paywall / MCP confirm-only settle | `execute_payment` → poll `get_settlement_status` |
| Merchant returns HTTP **402** | Build `X-PAYMENT` and retry the resource — `{SKILLS_BASE}/x402-credit-pay.md`. **Never** `execute_payment` on that path. |

## Flow (MCP confirm-only)

1. **Create spend intent** — `create_spend_intent` / `POST /api/v1/spend/intents`
2. **Evaluate policy** — `evaluate_spend_policy` / `POST /api/v1/policy/evaluate`
3. **Sign PaymentIntent** — `sign_transaction` with `policy_decision_id` (binds the evaluated intent, keeps `orderRef` byte-identical) → poll `get_signing_status` for `signature` (`intentSig`)
4. **Execute payment** — `execute_payment` / `POST /api/v1/payments/execute` → keep `settlement_id`
5. **Poll settlement** — `get_settlement_status` with **`settlement_id`** until a **terminal** status

High-risk routes require **2FA-equivalent**: verified wallet-proof + server-side borrower 2FA flag (not a JWT claim).

Before executing any payment on the **MCP confirm-only** path (`execute_payment`):

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

HTTP 402 merchant-as-settler does **not** use `execute_payment` — first-time merchant consent only; see `{SKILLS_BASE}/x402-credit-pay.md`.

## First-time merchant (`RISK_FIRST_TIME_MERCHANT`)

A first spend to a merchant this borrower has **no prior policy decision for** scores **35** (`RISK_FIRST_TIME_MERCHANT`) → MEDIUM → review → **DENY** (`signing_eligible: false`). Do **not** call `sign_transaction` on a DENY.

`SESSION_GATE_SKIPPED_NO_SESSION` on human-direct is **expected** (session gate skipped, status pass). It is not the deny reason. Do not create a session to "fix" it.

### Operator consent — once per merchant

When `evaluate_spend_policy` or a later settle-time 402 returns `RISK_FIRST_TIME_MERCHANT`, STOP and ask:

> Please accept first-time spend consent for this merchant (`merchantUuid` / on-chain `merchantId`). After you accept, I will not ask again for this merchant when you request pay.

- If they **accept**, remember that merchant (UUID **and** bytes32 `merchantId` from the 402 challenge) for this borrower in the conversation. Later "pay here" / x402 requests **to that same merchant** must **not** re-ask — complete merchant-as-settler with no further operator prompts (`request_borrower_token` refresh, signing, `X-PAYMENT`, settle). MCP `execute_payment` (non-402) still requires its usual STOP.
- If they **refuse**, stop. Do not retry policy blindly.

### Signing-time vs settle-time (two merchant keys)

Policy runs **twice**, with **different merchant keys**. A signing-time **ALLOW** does not imply settle-time **ALLOW**.

| When | Merchant key for first-time lookup | Typical source |
|------|-------------------------------------|----------------|
| Signing-time (`evaluate_spend_policy`) | Spend-intent `merchant` / `merchant_id` (often the merchant **UUID**) | `create_spend_intent` |
| Settle-time (facilitator `/settle`) | PaymentIntent **`merchantId` (bytes32)** | `sign_transaction` `payment_intent.merchantId` |

Prior decisions count by **existence only** (a DENY row still counts). A UUID-keyed signing decision does **not** satisfy the bytes32 settle lookup, so the first `X-PAYMENT` can return `POLICY_DECISION_DENIED` + `RISK_FIRST_TIME_MERCHANT` even after signing ALLOW.

After a settle-time first-time DENY (and after operator consent if not already given):

1. Do **not** replay the **same** `X-PAYMENT` — some merchants cache the 403 body/etag and will not re-call settle.
2. Create a **new** spend intent (new `idempotency_key`), evaluate, sign only if `ALLOW` + `signing_eligible`, and send a **new** `X-PAYMENT`. The settle-time DENY row now exists under the bytes32 key, so the next settle re-eval should not flag first-time for that merchant.
3. Merchant **202** after `X-PAYMENT` means settle-time policy **allowed** that envelope (confirmation still pending).

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
| `payload` | Must be a **JSON object**, not a string. Pass `{}` when you have no precomputed hash — never a stringified `"{}"`. Only `payload.payload_hash` is forwarded to the backend; every other key stays local. |
| `signing_purpose` / `payload_type` | Required by the tool schema but **not forwarded**; the gateway derives signing mode from `decision_id`. |

Before requesting a signature on the **MCP confirm-only** path (`execute_payment`):

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

On an **HTTP 402 / merchant-as-settler** payRequest, do **not** STOP for signing after first-time merchant consent — see § First-time merchant and `{SKILLS_BASE}/x402-credit-pay.md`.

## Settlement finality and available credit (tell the operator)

`execute_payment` returning `202` / `SUBMITTED` with a `tx_hash` and `settlement_id` means the settle tx was **submitted**, not that credit has finished drawing down.

Confirmation uses **`l2_confirmations`** (L2 receipt + confirmation depth, typically depth 2) — expect `CONFIRMED` in **~5 seconds** after a successful receipt (P95 under 30s). Poll about every **2 seconds**. Unlock and off-chain credit drawdown still happen only on `CONFIRMED`.

| Status | Meaning |
|--------|---------|
| `CREATED` | Row created, not yet submitted |
| `SUBMITTED` | On-chain tx submitted |
| `PENDING_CONFIRMATION` | Waiting for L2 receipt + confirmation depth (`l2_confirmations`). Same `txHash` is re-polled — **not** a new payment. Typical ~5s after receipt |
| `CONFIRMED` | L2 confirmation depth reached; off-chain credit **drawdown** applied |
| `FAILED` | Terminal failure |
| `TIMED_OUT` | Non-terminal past the confirmation mine window — surface to operator; do not invent a second payment |
| `DISPUTED` | Dual-confirm mismatch |

**Agent instructions:**

1. After execute (or merchant 202), poll `get_settlement_status` with **`settlement_id`** (UUID from execute / 202 body). Optional legacy fallback: numeric `job_id` only. **`payment_id` is not accepted.** The tool schema marks only `borrower_id` as required, but you must still supply one of `settlement_id` or `job_id`.
2. Tell the operator that **available credit / outstanding balance update only after `CONFIRMED`** (usually within seconds under `l2_confirmations`). Do not treat `202` / `tx_hash` alone as drawn-down credit.
3. Do **not** treat confirmation retries as duplicate spends; the confirmation worker only polls the existing `txHash`.
4. If status stays non-terminal past the confirmation window, surface `TIMED_OUT` (or stuck `PENDING_CONFIRMATION`) to the operator — admin re-drive may be required; do not invent a second payment.

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
