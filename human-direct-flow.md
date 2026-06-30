# Skill: SohoPay Human-Direct Flow (Protocol v1)

Use this path when the **human borrower** acts directly — no delegated agent session.

## Skip these tools

- `create_agent_session`
- `get_session_context`
- `revoke_session`

Never pass `session_id` on spend, payment, or signing tools.

## MCP v1 catalog (18 tools)

Protocol v1 adds: `get_outstanding_balance`, `create_repayment`, `execute_repayment`, `get_signing_status`, `get_settlement_status`.

## End-to-end flow

```text
register_borrower
  → request_signature_challenge + submit_signature (wallet proof)
  → request_borrower_token
  → create_spend_intent (include order_ref / resource_identifier when using x402)
  → evaluate_spend_policy
  → execute_payment
  → get_settlement_status (poll until terminal)
```

Optional repayment (permissionless payer model):

```text
get_outstanding_balance → create_repayment or execute_repayment → payer submits on-chain repay tx
```

## High-risk tools

`execute_payment`, `sign_transaction`, and `approve_credit_limit` require:

- Live `POST /api/v1/auth/authorization-context`
- `AUTH_INTROSPECTION_ENABLED=true` on the MCP server
- Wallet proof + 2FA-equivalent where applicable

## Related skills

- Onboarding: `borrower-onboard.md`
- Spend/policy: `spend-and-pay.md`
- x402 settlement: `x402-credit-pay.md`
