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

Payment itself is the x402 merchant header rail (`PAYMENT-SIGNATURE` / `X-PAYMENT`), not an MCP settle tool — see `{SKILL:sohopay-x402}`.

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

## Before privileged calls

1. **Confirm the borrower token is still valid.** It is short-lived (staging: `expires_in: 900`, 15 minutes) and is not auto-refreshed. Re-request it via `request_borrower_token` immediately before spending rather than once per session — see `{SKILL:sohopay-onboard}` § Token lifetime.
2. Resolve live authz: `POST /api/v1/auth/authorization-context`
3. Confirm borrower not frozen/suspended for money movement
4. Attach `Idempotency-Key: <uuid-v4>` on all writes — or pass `idempotency_key` in tool args

## Account-state gate

Blocked for sanctioned/OFAC, fraud-held, inactive accounts. Frozen/suspended borrowers may still repay (separate flow).
