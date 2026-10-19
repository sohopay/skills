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
1. `register_borrower` — creates this host’s terminal; store `operational_agent_id` + `terminal_id`. Its `next_actions` is a list of action names (no `reason_code`)
2. Protocol V2 workload key — **route keygen + PoP to the signer**, never hand-roll crypto: [references/workload-key.md](references/workload-key.md) (requires step 1). Skipping step 1 → `TERMINAL_NOT_OWNED`. Run this immediately after `register_borrower`, regardless of wallet state: a missing or unproven wallet does not block key registration. Do not call `start_browser_handoff` to unblock the key
3. `request_borrower_token` immediately with `spend:intent:create`, `policy:evaluate`, `signing:request`, `payment:read`, **`credit:facility:accept`**, `handle:claim`. Store `token_requested_at` + `expires_in`. Do **not** ask the operator before this call. `whoami.scopes` of `borrower:token` is the OAuth JWT, not expiry. A later pay refreshes only when this chat has no successful token newer than 12 minutes — `{SKILL:sohopay-x402}`
4. Agent grant — `{SKILL:sohopay-authorize-agent}` immediately after the key and token. Open the consent URL in this same turn. The page uses passkey step-up; within-threshold grants can complete without a wallet, while larger grants also require an EOA signature. Onboarding is incomplete until the grant is ACTIVE. Do not invent a dummy `prepare_x402_payment` to poll
5. Financial source — the step is listed when `get_context` has an entry with `reason_code: FINANCIAL_SOURCE_REQUIRED`, or step 1's `next_actions` names `CONNECT_WALLET` / `CONNECT_BANK`. The key and grant are already complete; now STOP and ask the borrower: wallet or bank (one chat question naming both). If `COMPLETE_PROFILE` is listed too, report it first: the borrower enters their legal name and date of birth on the SohoPay page, never in chat. Then:
   - **No wallet** (`CONNECT_WALLET` + `CONNECT_BANK`): call `start_browser_handoff` with `action` set to the chosen step and a fresh `idempotency_key`.
   - **Unproven wallet** (`PROVE_WALLET` + `CONNECT_BANK`): wallet → step 7 (the proof, no link); bank → `start_browser_handoff` with `action: CONNECT_BANK`. Never send `CONNECT_WALLET` while `PROVE_WALLET` is listed (`409 NO_BROWSER_HANDOFF`).
   - Open the returned `open_url` for the borrower verbatim, `#…` part included. Do not poll: when the borrower says they are done, call `get_context` again.
   - A `CONNECT_BANK` listed next to `EVALUATE_CREDIT` is optional evidence for a borrower who already has a source: report it, do not stop for it.
   - A borrower with no wallet is registered, not an error: never ask for a wallet signature to invent one. Older server without the tool, `409`, expired link: [references/onboarding-context.md](references/onboarding-context.md)
6. Facility offer — when `next_actions` lists `REVIEW_AND_ACCEPT_FACILITY` (`FACILITY_OFFER_ACCEPTANCE_REQUIRED`), call `review_facility_offer` (fresh `idempotency_key`, no offer argument), open the returned `open_url` verbatim, and call `get_context` when the borrower is done. Never build a `/facility/accept` link. Acceptance needs no wallet proof. Acceptance opens the credit line; paying also needs the ACTIVE agent grant from step 4
7. Wallet proof — run it when the borrower chose the wallet while `PROVE_WALLET` is listed, or when `wallet_proof_verified` is false and no source step is listed (a deployment without `PROVE_WALLET`). Skip it when `wallet_proof_verified` is true, the borrower chose a bank, or there is no wallet. `request_signature_challenge` → borrower signs EIP-712 off-device → `submit_signature`. Never fabricate a signature, and once the wallet is chosen do not insert another chat question before the challenge
8. `get_borrower_status`. If step 3 returned wallet-gated scopes in `dropped_scopes`, re-request the borrower token after wallet proof/source completion
9. `POST /api/v1/auth/authorization-context` before privileged tools
10. Handle (**required gate**) — only **after** the token in step 3 (never a chat question before the token). Onboarding is **incomplete until a handle is claimed**. If step 1's `register_borrower` returned `handle: null` with `next_action: "claim_handle"`, present its `suggested_handles` and ask the borrower to pick one or propose their own; for a custom handle, `check_handle_availability` first. Show the exact handle and get an explicit yes (one allowed chat question), then `claim_handle` (write, `idempotency_key`). Recoverable errors → offer more candidates and keep going. When candidates are exhausted, or `handle:claim` was never granted, STOP and report — do **not** report the borrower as onboarded. Details: [references/handle-claim.md](references/handle-claim.md)

**Bank only.** A borrower who connected a bank and has no proven wallet still completes steps 2–4: the workload key is wallet-independent and a within-threshold grant uses passkey consent. Skip only step 7. If `get_context` still reports `REPAYMENT_METHOD_REQUIRED` or another payment blocker, report them as **onboarded but not spend-ready** and say a supported repayment method is still needed before payment. Do not repeat key registration or authorization, and do not ask for a wallet signature in chat.

`EVALUATE_CREDIT` and `REVIEW_CREDIT_OFFER` are statuses: report them, call no tool, and invent no link. The only links you give are the `open_url`s that `start_browser_handoff` or `review_facility_offer` returned. Never ask for a legal name, date of birth, bank details, or a passkey in chat. Keep doing any `PAY`, repayment or handle action listed alongside these steps. Details: [references/onboarding-context.md](references/onboarding-context.md)

Dropped scopes are not fatal — re-request after gates complete. Scope table: [references/scopes.md](references/scopes.md). Operate: `{SKILL:sohopay-human-direct}`. Warm pay after the grant is ACTIVE: `{SKILL:sohopay-x402}`.
