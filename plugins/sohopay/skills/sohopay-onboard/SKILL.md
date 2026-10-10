---
name: sohopay-onboard
description: >
  Make this host spend-ready: register the terminal, wallet proof, scoped token, Protocol V2 workload key, an ACTIVE agent grant, and a claimed @handle. Use when whoami shows no borrower, wallet_proof is missing, dropped_scopes, X402_AGENT_KEY_NOT_REGISTERED, the operator asks to onboard or to claim/check a handle — not for a warm 402 pay or delegated sessions.
license: Apache-2.0
metadata:
  hosted_name: borrower-onboard
  title: SohoPay Borrower Onboarding
  version: "1.0"
---

Execute the numbered workflow in **one turn**. Do not plan. Do not defer the workload key or `authorize_agent` until the first payment. **Before:** MCP connected (`{SKILL:sohopay-mcp-connect}`).

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

Canonical identity: **borrowerId = User.id (UUID)**. Pass `idempotency_key` on writes — `{SKILL:sohopay-idempotency}`.

0. `get_context` (catalog v8+) or `whoami` (v7) — skip *user* register if borrower exists; still `register_borrower` if this host has no `operational_agent_id`. On v8+, `get_context` returns `borrower_id` + credit + authorization directly; on v7 use `whoami` (field caveats: [references/whoami.md](references/whoami.md)) + `get_borrower_status`. `{SKILL:sohopay-bootstrap}`
1. `register_borrower` — creates this host’s terminal; store `operational_agent_id` + `terminal_id`. If it returns `spend_ready: false` with `next_actions` (`CONNECT_WALLET`, `CONNECT_BANK`), the borrower signed in without a wallet (phone or passkey): that is a registered borrower, **not an error**. Run steps 3, 4, 7 and 8 only (steps 2 and 6 need a wallet, and step 5’s workload key is pointless until the step-6 grant can be made; spend scopes in step 4 come back in `dropped_scopes` with `WALLET_PROOF_REQUIRED`, which is expected). Then, once the step-8 handle gate is cleared, report the borrower as **onboarded but not spend-ready** and tell the operator a wallet or bank account must be connected before paying. Do not ask the borrower for a wallet signature to make the step pass
2. Wallet proof — skip if `wallet_proof_verified` is already true or step 1 returned `next_actions`. Otherwise `request_signature_challenge` → borrower signs EIP-712 off-device in this same turn → `submit_signature`. Never fabricate a signature, and do not insert a yes/no chat question before the challenge
3. `get_borrower_status`
4. `request_borrower_token` immediately with `spend:intent:create`, `policy:evaluate`, `signing:request`, `payment:read`, **`credit:facility:accept`**, `handle:claim`. Store `token_requested_at` + `expires_in`. Do **not** ask the operator, and do **not** wait for a chat reply, before `request_borrower_token`. `whoami.scopes` of `borrower:token` is the OAuth JWT, not expiry. A later pay refreshes only when this chat has no successful token newer than 12 minutes — `{SKILL:sohopay-x402}`
5. Protocol V2 workload key — **route keygen + PoP to the signer**, never hand-roll crypto: [references/workload-key.md](references/workload-key.md) (requires step 1). Skipping step 1 → `TERMINAL_NOT_OWNED`. Run this during onboarding, not on first pay
6. Agent grant — `{SKILL:sohopay-authorize-agent}` immediately after the key. Open the consent URL in this same turn. Onboarding is incomplete until the grant is ACTIVE. Do not invent a dummy `prepare_x402_payment` to poll
7. `POST /api/v1/auth/authorization-context` before privileged tools
8. Handle (**required gate**) — only **after** steps 4–6 (never a chat question before the token). Onboarding is **incomplete until a handle is claimed**. If step 1's `register_borrower` returned `handle: null` with `next_action: "claim_handle"`, present its `suggested_handles` and ask the borrower to pick one or propose their own; for a custom handle, `check_handle_availability` first. Show the exact handle and get an explicit yes (one allowed chat question), then `claim_handle` (write, `idempotency_key`). Recoverable errors → offer more candidates and keep going. When candidates are exhausted, or `handle:claim` was never granted, STOP and report — do **not** report the borrower as onboarded. Details: [references/handle-claim.md](references/handle-claim.md)

Dropped scopes are not fatal — re-request after gates complete. Scope table: [references/scopes.md](references/scopes.md). Operate: `{SKILL:sohopay-human-direct}`. Warm pay after the grant is ACTIVE: `{SKILL:sohopay-x402}`.
