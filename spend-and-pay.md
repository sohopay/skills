<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1
     SKILLS_HOST (CDN origin): https://agents.sohopay.xyz
     Fetch order: local sticky → {SKILLS_BASE} → GitHub raw last-resort.
     Publish rewrites SKILLS_BASE to Prod and {SKILLS_HOST} to the origin. -->
<!-- Generated from plugins/sohopay/skills — do not hand-edit this file. Run npm run generate:hosted -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Spend, Policy, and Signing

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

HTTP 402 → **sohopay-x402** (`prepare_x402_payment`). This skill is the non-x402 / V1 multi-step path and first-time merchant rules.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

`idempotency_key` on writes — `{SKILLS_BASE}/idempotency.md`. Default operate: `{SKILLS_BASE}/human-direct-flow.md`.

**V1 / non-x402:** `create_spend_intent` → `evaluate_spend_policy` → `sign_transaction(policy_decision_id, payload: {})` → `get_signing_status` (`signature` = `intentSig`) → x402 settle → poll `settlement_id`.

Merchant XOR `merchant`/`merchant_id`. Amount XOR `amount`/`amount_decimal`. `sign_transaction` does **not** accept `spend_intent_id`. Signing: [references/signing.md](#hosted-reference-signing).

First-time merchant: [references/first-time-merchant.md](#hosted-reference-first-time-merchant). On a payRequest treat as accepted. Settle uses bytes32 `merchantId` — signing ALLOW can still DENY at settle.

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

Only when there is **no** payRequest and policy is first-time / high-risk.

Settlement: [references/settlement.md](#hosted-reference-settlement). Poll `settlement_id`; credit after `CONFIRMED` (`l2_confirmations`, ~5s).

---

## Hosted references (load only when the skill says to)

Native Agent Skills read these from `references/` on demand. This hosted export inlines them so `curl -fsSL` bootstrap still works.

<a id="hosted-reference-first-time-merchant"></a>

### Hosted reference: first-time-merchant.md

## First-time merchant (`RISK_FIRST_TIME_MERCHANT`)

A first spend to a merchant this borrower has **no prior policy decision for** scores **35** (`RISK_FIRST_TIME_MERCHANT`) → MEDIUM → review → **DENY** (`signing_eligible: false`). Do **not** call `sign_transaction` on a DENY.

`SESSION_GATE_SKIPPED_NO_SESSION` on human-direct is **expected** (session gate skipped, status pass). It is not the deny reason. Do not create a session to "fix" it.

### Operator consent

When `evaluate_spend_policy` / prepare / settle returns `RISK_FIRST_TIME_MERCHANT`:

- **On a payRequest:** treat the pay utterance as accept for this merchant. Remember UUID **and** bytes32 `merchantId`. Retry without asking (`request_borrower_token` refresh, prepare, voucher sign / `X-PAYMENT`, settle). For prepare-route 403, reuse the **same** idempotency key.
- **No payRequest** (exploratory): STOP once and ask:

> Please accept first-time spend consent for this merchant (`merchantUuid` / on-chain `merchantId`). After you accept, I will not ask again for this merchant when you request pay.

- If they **refuse**, stop. Do not retry policy blindly.

### Signing-time vs settle-time (two merchant keys)

Policy runs **twice**, with **different merchant keys**. A signing-time **ALLOW** does not imply settle-time **ALLOW**.

| When | Merchant key for first-time lookup | Typical source |
|------|-------------------------------------|----------------|
| Signing-time (`evaluate_spend_policy`) | Spend-intent `merchant` / `merchant_id` (often the merchant **UUID**) | `create_spend_intent` |
| Settle-time (facilitator `/settle`) | PaymentIntent **`merchantId` (bytes32)** | `sign_transaction` `payment_intent.merchantId` |

Prior decisions count by **existence only** (a DENY row still counts). A UUID-keyed signing decision does **not** satisfy the bytes32 settle lookup, so the first `X-PAYMENT` can return `POLICY_DECISION_DENIED` + `RISK_FIRST_TIME_MERCHANT` even after signing ALLOW.

After a settle-time first-time DENY (payRequest already counts as consent; otherwise after explicit accept):

1. Do **not** replay the **same** `X-PAYMENT` — some merchants cache the 403 body/etag and will not re-call settle.
2. Create a **new** spend intent / prepare (new `idempotency_key` for settle-time envelope mint), evaluate, sign only if `ALLOW` + `signing_eligible`, and send a **new** payment header. The settle-time DENY row now exists under the bytes32 key, so the next settle re-eval should not flag first-time for that merchant.
3. Merchant **202** after the header means settle-time policy **allowed** that envelope (confirmation still pending).


<a id="hosted-reference-settlement"></a>

### Hosted reference: settlement.md

## Settlement finality and available credit (tell the operator)

An x402 settle returning `202` / `SUBMITTED` with a `tx_hash` and `settlement_id` means the settle tx was **submitted**, not that credit has finished drawing down.

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

1. After the x402 settle (merchant 202), poll `get_settlement_status` with **`settlement_id`** (UUID from the 202 body). Optional legacy fallback: numeric `job_id` only. **`payment_id` is not accepted.** The tool schema marks only `borrower_id` as required, but you must still supply one of `settlement_id` or `job_id`.
2. Tell the operator that **available credit / outstanding balance update only after `CONFIRMED`** (usually within seconds under `l2_confirmations`). Do not treat `202` / `tx_hash` alone as drawn-down credit.
3. Do **not** treat confirmation retries as duplicate spends; the confirmation worker only polls the existing `txHash`.
4. If status stays non-terminal past the confirmation window, surface `TIMED_OUT` (or stuck `PENDING_CONFIRMATION`) to the operator — admin re-drive may be required; do not invent a second payment.

## MCP tools

| Tool | Scope | Wallet proof | KYC | Idempotent |
|------|-------|:------------:|:---:|:----------:|
| `register_agent_workload_key` | borrower:token | — | — | Yes |
| `create_spend_intent` | spend:intent:create | ✅ | ✅ | Yes |
| `evaluate_spend_policy` | policy:evaluate | — | — | Yes |
| `sign_transaction` | signing:request | ✅ | — (+ 2FA-equiv) | Yes |
| `prepare_x402_payment` | spend + policy + signing | ✅ | ✅ | Yes |
| `get_signing_status` | signing:request | — | — | No |
| `get_settlement_status` | payment:read | — | — | No |
| `get_outstanding_balance` | repayment:read | — | — | No |
| `create_repayment` | repayment:execute | — | — | Yes |
| `execute_repayment` | repayment:execute | — | — | Yes |
| `request_repayment` | repayment:execute | — | — | Yes |
| `get_repayment_status` | repayment:read | — | — | No |

Payment itself is the x402 merchant header rail (`PAYMENT-SIGNATURE` / `X-PAYMENT`), not an MCP settle tool — see `{SKILLS_BASE}/x402-credit-pay.md`. Borrower wallet repay is `{SKILLS_BASE}/repay.md` — leave `create_repayment` / `execute_repayment` prepare-only.

## Backend endpoints

| Method | Path | Scope |
|--------|------|-------|
| POST | `/api/v1/agents/:terminalId/keys` | borrower:token |
| POST | `/api/v1/spend/intents` | spend:intent:create |
| GET | `/api/v1/spend/intents/:id` | spend:intent:create |
| POST | `/api/v1/spend/x402/prepare` | spend + policy + signing |
| POST | `/api/v1/policy/evaluate` | policy:evaluate |
| POST | `/api/v1/signing/request` | signing:request |
| GET | `/api/v1/signing/request/:id` | signing:request |
| GET | `/api/v1/payments/by-settlement/:settlementId/status` | payment:read (preferred) |
| GET | `/api/v1/payments/:jobId/status` | payment:read (legacy job_id) |
| GET | `/api/v1/repayments/quote` | repayment:read |
| POST | `/api/v1/repayments/prepare` | repayment:execute |
| POST | `/api/v1/repayments/consent/challenge` | repayment:execute |
| GET | `/api/v1/repayments/consent/:challengeId/status` | repayment:read |
| POST | `/api/v1/repayments/consent/:challengeId/submit` | repayment:execute |

## Before privileged calls

1. **Confirm the borrower token is still valid.** It is short-lived (staging: `expires_in: 900`, 15 minutes) and is not auto-refreshed. Re-request it via `request_borrower_token` immediately before spending rather than once per session — see `{SKILLS_BASE}/borrower-onboard.md` § Token lifetime.
2. Resolve live authz: `POST /api/v1/auth/authorization-context`
3. Confirm borrower not frozen/suspended for money movement
4. Attach `Idempotency-Key: <uuid-v4>` on all writes — or pass `idempotency_key` in tool args

## Account-state gate

Blocked for sanctioned/OFAC, fraud-held, inactive accounts. Frozen/suspended borrowers may still repay (separate flow).


<a id="hosted-reference-signing"></a>

### Hosted reference: signing.md

## Signing and intentSig

Use this section for **non-x402 spend** and the **V1 multi-step** path. For HTTP 402s under Protocol V2, prefer `prepare_x402_payment` — if prepare returns `VOUCHER_ISSUED` or `sign_transaction` returns `CUSTODIAL_SIGNING_DISABLED`, do **not** use this custodial path.

1. Call `sign_transaction` with `borrower_id`, `signing_purpose`, `payload_type`, `payload`, and **`policy_decision_id`** (the `decision_id` returned by `evaluate_spend_policy`).
2. Keep `request_id` from the accepted response. The response also echoes **`payment_intent`** — `agentId`, `merchantId`, `asset`, `amount`, `feeAmount`, `orderRef`, `nonce`, `deadline`. Keep it: these are the exact wire values an `X-PAYMENT` envelope needs, and `nonce` / `deadline` are not available from any other tool.
3. Poll `get_signing_status` until `COMPLETED`.
4. The returned **`signature`** is the unredacted **`intentSig`** (Envelope 1 over PaymentIntent). Use it for merchant `X-PAYMENT` envelopes and for borrower-direct x402 settle. It is the only tool response field exempt from MCP redaction on this path.

### sign_transaction — field rules

| Rule | Detail |
|------|--------|
| Binding | **`policy_decision_id` is required in practice.** The gateway maps it to `decision_id` and hydrates merchant / asset / amount / `orderRef` from the bound policy decision, keeping the PaymentIntent byte-identical across sign → settle. The backend signing DTO declares `decision_id` as a required UUID. |
| `spend_intent_id` | **Not accepted by this tool.** It is absent from the MCP signing schema and silently stripped, so passing it changes nothing. Bind through `policy_decision_id` — the decision already points at the spend intent. |
| `payload` | Must be a **JSON object**, not a string. Pass `{}` when you have no precomputed hash — never a stringified `"{}"`. Only `payload.payload_hash` is forwarded to the backend; every other key stays local. |
| `signing_purpose` / `payload_type` | Required by the tool schema but **not forwarded**; the gateway derives signing mode from `decision_id`. |

Before requesting a signature:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

On an **HTTP 402 / merchant-as-settler** payRequest, do **not** STOP for signing / voucher sign / first-time — see § First-time merchant and `{SKILLS_BASE}/x402-credit-pay.md` § Fast pay path.

