<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Human-Direct Flow (Protocol v1)

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**What this skill does:** runs the full 18-tool v1 path when the human borrower acts directly (no delegated agent session). **Before running it:** the MCP server is connected (`mcp-connect.md`).

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

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

Wallet proof, the token request, and payment execution are all consent-critical. At each of those points:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

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

- Onboarding: `curl -fsSL {SKILLS_BASE}/borrower-onboard.md`
- Spend/policy: `curl -fsSL {SKILLS_BASE}/spend-and-pay.md`
- x402 settlement: `curl -fsSL {SKILLS_BASE}/x402-credit-pay.md`
