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
1. `register_borrower` — creates this host’s terminal; store `operational_agent_id` + `terminal_id`
2. Financial source — if `get_context` or step 1 lists `FINANCIAL_SOURCE_REQUIRED` (`CONNECT_WALLET` and/or `CONNECT_BANK`), STOP and ask before wallet proof, the workload key, and `authorize_agent`. `CONNECT_WALLET` means there is no wallet. `PROVE_WALLET` plus `CONNECT_BANK` means the wallet is already registered: prove it or connect a bank. Ask wallet or bank, call `start_browser_handoff` with that `action` and a fresh idempotency key, and open `open_url` verbatim. `PROVE_WALLET` itself stays on step 4. After the borrower returns, call `get_context`. A borrower with no wallet is registered, not an error: do not ask for a wallet signature to invent one
3. Facility offer — when `next_actions` includes `REVIEW_AND_ACCEPT_FACILITY` (`FACILITY_OFFER_ACCEPTANCE_REQUIRED`), call `review_facility_offer`, open `open_url`, then `get_context`. Acceptance unlocks spending. Do not add a wallet-only draw step after it
4. Wallet proof — only when `PROVE_WALLET` is still listed and the borrower did not choose a bank. Skip if `wallet_proof_verified` is already true, or the borrower has no wallet. Otherwise `request_signature_challenge` → borrower signs EIP-712 off-device → `submit_signature`. Never fabricate a signature, and do not insert a yes/no chat question before the challenge
5. `get_borrower_status`
6. `request_borrower_token` immediately with `spend:intent:create`, `policy:evaluate`, `signing:request`, `payment:read`, **`credit:facility:accept`**, `handle:claim`. Store `token_requested_at` + `expires_in`. Do **not** ask the operator, and do **not** wait for a chat reply, before `request_borrower_token`. `whoami.scopes` of `borrower:token` is the OAuth JWT, not expiry. A later pay refreshes only when this chat has no successful token newer than 12 minutes — `{SKILL:sohopay-x402}`
7. Protocol V2 workload key — **route keygen + PoP to the signer**, never hand-roll crypto: [references/workload-key.md](references/workload-key.md) (requires step 1). Skipping step 1 → `TERMINAL_NOT_OWNED`. Run this during onboarding, not on first pay. Skip it until a wallet exists when step 2 is still `CONNECT_WALLET`
8. Agent grant — `{SKILL:sohopay-authorize-agent}` immediately after the key. Open the consent URL in this same turn. Onboarding is incomplete until the grant is ACTIVE. Do not invent a dummy `prepare_x402_payment` to poll. Skip it while step 2 is still an unconnected wallet
9. `POST /api/v1/auth/authorization-context` before privileged tools
10. Handle (**required gate**) — only **after** the token (never a chat question before the token). Onboarding is **incomplete until a handle is claimed**. If step 1's `register_borrower` returned `handle: null` with `next_action: "claim_handle"`, present its `suggested_handles` and ask the borrower to pick one or propose their own; for a custom handle, `check_handle_availability` first. Show the exact handle and get an explicit yes (one allowed chat question), then `claim_handle` (write, `idempotency_key`). Recoverable errors → offer more candidates and keep going. When candidates are exhausted, or `handle:claim` was never granted, STOP and report — do **not** report the borrower as onboarded. Details: [references/handle-claim.md](references/handle-claim.md)

If `get_context` returns an `onboarding` section, or a next action with `handoff_type: "OPEN_URL"` for `COMPLETE_PROFILE`, report it and never ask for a legal name or date of birth in chat. `CONNECT_WALLET` and `CONNECT_BANK` are step 2. `REVIEW_AND_ACCEPT_FACILITY` is step 3. `EVALUATE_CREDIT` and `REVIEW_CREDIT_OFFER` are statuses: report them and invent no link. `PROVE_WALLET` is step 4. Keep doing any `PAY`, repayment or handle action listed alongside these. Details: [references/onboarding-context.md](references/onboarding-context.md)

Dropped scopes are not fatal — re-request after gates complete. Scope table: [references/scopes.md](references/scopes.md). Operate: `{SKILL:sohopay-human-direct}`. Warm pay after the grant is ACTIVE: `{SKILL:sohopay-x402}`.
