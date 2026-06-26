# Skill: SohoPay Spend, Policy, and Payment

CRITICAL: `execute_payment` is **confirm-only** — MCP confirms an existing merchant-initiated `paymentId`. Agents do not initiate merchant payments.

## Flow

1. **Create spend intent** — `create_spend_intent` / `POST /api/v1/spend/intents`
2. **Evaluate policy** — `evaluate_spend_policy` / `POST /api/v1/policy/evaluate`
3. **Execute payment** — `execute_payment` / `POST /api/v1/payments/execute` (after merchant initiated payment)

High-risk routes require **2FA-equivalent**: verified wallet-proof + server-side borrower 2FA flag (not a JWT claim).

## MCP tools

| Tool | Scope | Wallet proof | KYC | Idempotent |
|------|-------|:------------:|:---:|:----------:|
| `create_spend_intent` | spend:intent:create | ✅ | ✅ | Yes |
| `evaluate_spend_policy` | policy:evaluate | — | — | Yes |
| `execute_payment` | payment:execute | ✅ | ✅ | Yes |

## Backend endpoints

| Method | Path | Scope |
|--------|------|-------|
| POST | `/api/v1/spend/intents` | spend:intent:create |
| GET | `/api/v1/spend/intents/:id` | spend:intent:create |
| POST | `/api/v1/policy/evaluate` | policy:evaluate |
| POST | `/api/v1/payments/execute` | payment:execute |

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
