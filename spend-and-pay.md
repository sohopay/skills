# Skill: SohoPay Spend, Policy, and Payment

CRITICAL: `execute_payment` is **confirm-only** — MCP confirms an existing merchant-initiated `paymentId`. Agents do not initiate merchant payments.

## Human-direct path (no session)

If the borrower acts directly (not via a delegated agent), use the [human-direct-flow](https://agents.sohopay.xyz/skills/human-direct-flow.md) skill — skip session tools and omit `session_id`.

## Flow

1. **Create spend intent** — `create_spend_intent` / `POST /api/v1/spend/intents`
2. **Evaluate policy** — `evaluate_spend_policy` / `POST /api/v1/policy/evaluate`
3. **Execute payment** — `execute_payment` / `POST /api/v1/payments/execute` (after merchant initiated payment)
4. **Poll settlement** — `get_settlement_status` / `GET /api/v1/payments/:id/status` (protocol v1)

High-risk routes require **2FA-equivalent**: verified wallet-proof + server-side borrower 2FA flag (not a JWT claim).

## MCP tools (protocol v1)

| Tool | Scope | Wallet proof | KYC | Idempotent |
|------|-------|:------------:|:---:|:----------:|
| `create_spend_intent` | spend:intent:create | ✅ | ✅ | Yes |
| `evaluate_spend_policy` | policy:evaluate | — | — | Yes |
| `execute_payment` | payment:execute | ✅ | ✅ | Yes |
| `get_settlement_status` | payment:read | — | — | No |
| `get_outstanding_balance` | repayment:read | — | — | No |
| `create_repayment` | repayment:execute | — | — | Yes |
| `execute_repayment` | repayment:execute | — | — | Yes |
| `get_signing_status` | signing:request | — | — | No |

## Backend endpoints

| Method | Path | Scope |
|--------|------|-------|
| POST | `/api/v1/spend/intents` | spend:intent:create |
| GET | `/api/v1/spend/intents/:id` | spend:intent:create |
| POST | `/api/v1/policy/evaluate` | policy:evaluate |
| POST | `/api/v1/payments/execute` | payment:execute |
| GET | `/api/v1/payments/:id/status` | payment:read |
| GET | `/api/v1/repayments/quote` | repayment:read |
| POST | `/api/v1/repayments/prepare` | repayment:execute |

## Before privileged calls

1. Resolve live authz: `POST /api/v1/auth/authorization-context`
2. Confirm borrower not frozen/suspended for money movement
3. Attach `Idempotency-Key: <uuid-v4>` on all writes

## Signing (separate from payment confirm)

`sign_transaction` → `POST /api/v1/signing/request` (scope `signing:request`, wallet proof, 2FA-equivalent).

MCP never signs locally — backend orchestrator handles signing.

## Account-state gate

Blocked for sanctioned/OFAC, fraud-held, inactive accounts. Frozen/suspended borrowers may still repay (separate flow).

## Next steps

- x402 HTTP rail: `curl -sL https://agents.sohopay.xyz/skills/x402-credit-pay.md`
- Idempotency: `curl -sL https://agents.sohopay.xyz/skills/idempotency.md`
