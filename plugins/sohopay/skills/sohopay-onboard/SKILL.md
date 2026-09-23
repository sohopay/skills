---
name: sohopay-onboard
description: >
  Register a borrower, complete EIP-712 wallet proof, request tokens, and register the Protocol V2 workload key. Use when whoami shows no borrower, wallet_proof is missing, dropped_scopes, X402_AGENT_KEY_NOT_REGISTERED, or the operator asks to onboard — not for delegated sessions or payments.
license: Apache-2.0
metadata:
  hosted_name: borrower-onboard
  title: SohoPay Borrower Onboarding
  version: "1.0"
---

Execute the numbered workflow. Do not plan. **Before:** MCP connected (`{SKILL:sohopay-mcp-connect}`).

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

Canonical identity: **borrowerId = User.id (UUID)**. Pass `idempotency_key` on writes — `{SKILL:sohopay-idempotency}`.

0. `whoami` — skip *user* register if borrower exists; still `register_borrower` if this host has no `operational_agent_id`. Field caveats: [references/whoami.md](references/whoami.md)
1. `register_borrower` — creates this host’s terminal; store `operational_agent_id` + `terminal_id`
2. Wallet proof — `request_signature_challenge` → borrower signs off-device → `submit_signature`

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

3. `get_borrower_status`
4. `request_borrower_token` with `requested_scopes[]`

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

On a 402 payRequest after first-time merchant consent, do **not** STOP for token refresh — `{SKILL:sohopay-x402}`.

5. Protocol V2 workload key — [references/workload-key.md](references/workload-key.md) (requires step 1). Skipping step 1 → `TERMINAL_NOT_OWNED`
6. `POST /api/v1/auth/authorization-context` before privileged tools

Dropped scopes are not fatal. Scope table: [references/scopes.md](references/scopes.md). Grant: `{SKILL:sohopay-authorize-agent}`. Operate: `{SKILL:sohopay-human-direct}`.
