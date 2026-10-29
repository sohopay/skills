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
2. Protocol V2 workload key — **route keygen + PoP to the signer**, never hand-roll crypto: [references/workload-key.md](references/workload-key.md) (requires step 1). Skipping step 1 → `TERMINAL_NOT_OWNED`. Run this immediately after `register_borrower`, even with no wallet and even when `COMPLETE_PROFILE` is listed. A missing profile does not block the key. Do not call `start_browser_handoff` to unblock the key. If the signer binary is missing, stop and do not install it
3. `request_borrower_token` immediately with `spend:intent:create`, `policy:evaluate`, `signing:request`, `payment:read`, **`credit:facility:accept`**, `handle:claim`. Store `token_requested_at` + `expires_in`. Do **not** ask the operator before this call. `whoami.scopes` of `borrower:token` is the OAuth JWT, not expiry. A later pay refreshes only when this chat has no successful token newer than 12 minutes — `{SKILL:sohopay-x402}`
4. Agent grant — `{SKILL:sohopay-authorize-agent}` immediately after the key and token. Open the consent URL in this same turn. The page uses passkey step-up; within-threshold grants can complete without a wallet, while larger grants also require an EOA signature. Poll until the grant is ACTIVE. Do not invent a dummy `prepare_x402_payment` to poll
5. Repeat `get_context` and do only the current blocker. `COMPLETE_PROFILE` is first, ahead of any wallet or bank step. Before you end the turn for any reason below, do step 6 when `CLAIM_HANDLE` is listed:
   - `COMPLETE_PROFILE`: say the borrower enters legal name and date of birth on the SohoPay page. Do not ask for them in chat. Do not invent a link. Do not start a wallet or bank step. This is not agent-actionable: report it, do step 6 if `CLAIM_HANDLE` is listed, then end the turn. Do not poll
   - `CONNECT_WALLET` and `CONNECT_BANK` together: ask once, wallet or bank. Then `start_browser_handoff` with that `action` and a fresh `idempotency_key`. Open `open_url` verbatim, `#…` included. Poll `get_context` every 5s for up to 15 minutes until that connect step clears — do not ask the borrower to type "done" ([references/onboarding-context.md](references/onboarding-context.md) "Connect link"). If step 3 returned wallet-gated scopes in `dropped_scopes`, re-request the borrower token after the step clears, then continue from `get_context`. A borrower with no wallet is registered, not an error: never ask for a wallet signature to invent one
   - `PROVE_WALLET` plus `CONNECT_BANK`: wallet means `request_signature_challenge` then `submit_signature` (no link). Bank means `action: CONNECT_BANK`. Never send `CONNECT_WALLET` while `PROVE_WALLET` is listed (`409 NO_BROWSER_HANDOFF`). Once the wallet is chosen, do not insert another chat question before the challenge. Never fabricate a signature. After the source step, re-request the token when step 3 returned those scopes in `dropped_scopes`
   - `REVIEW_AND_ACCEPT_FACILITY`: `review_facility_offer` (fresh `idempotency_key`, no offer argument), open `open_url`, poll `get_context` every 5s for up to 15 minutes until the offer step clears — do not ask the borrower to type "done". This opens the credit line. Never build a `/facility/accept` link. Acceptance needs no wallet proof
   - Wallet proof when `wallet_proof_verified` is false and no source step is listed (a deployment without `PROVE_WALLET`). Skip it when the proof is already verified, the borrower chose a bank, or there is no wallet. After the proof, re-request the token when step 3 returned wallet-gated scopes in `dropped_scopes`
   - Older server without the tool, `409`, expired link: [references/onboarding-context.md](references/onboarding-context.md)
   - Stop when no agent-actionable step is left. Report the state, do step 6 if `CLAIM_HANDLE` is listed, then end the turn. Do not poll. That includes `EVALUATE_CREDIT`, `REVIEW_CREDIT_OFFER` (report the status, no tool, no invented link; a `CONNECT_BANK` beside `EVALUATE_CREDIT` is optional evidence), `REPAYMENT_METHOD_REQUIRED`, `IN_REVIEW`, and `INELIGIBLE`. Say they are **onboarded but not spend-ready**
6. If `CLAIM_HANDLE` is listed, claim a handle the borrower confirms. This runs even when step 5 ends the turn on `COMPLETE_PROFILE` or a status. Only **after** the token in step 3 (never a chat question before the token). A missing handle does not block `can_pay`, but the borrower is not fully onboarded without one. If step 1's `register_borrower` returned `handle: null` with `next_action: "claim_handle"`, present its `suggested_handles` and ask the borrower to pick one or propose their own; for a custom handle, `check_handle_availability` first. Show the exact handle and get an explicit yes (one allowed chat question), then `claim_handle` (write, `idempotency_key`). Recoverable errors → offer more candidates and keep going. When candidates are exhausted, or `handle:claim` was never granted, STOP and report — do **not** report the borrower as onboarded. Details: [references/handle-claim.md](references/handle-claim.md)
7. Stop when `purchasing_power.can_pay` is true. Report available credit (`get_borrower_status`). Do not start a payment. Do not call `authorization-context` here: it is a pay-time check, not an onboarding step

**Bank only.** A borrower who connected a bank and has no proven wallet still completes steps 2–4: the workload key is wallet-independent and a within-threshold grant uses passkey consent. Skip the wallet proof inside step 5. If `get_context` still reports `REPAYMENT_METHOD_REQUIRED`, they are onboarded but not spend-ready. Do not repeat key registration or authorization, and do not ask for a wallet signature in chat.

`EVALUATE_CREDIT` and `REVIEW_CREDIT_OFFER` are statuses: report them, call no tool, and invent no link. The only links you give are the `open_url`s that `start_browser_handoff` or `review_facility_offer` returned. Never ask for a legal name, date of birth, bank details, or a passkey in chat. Keep doing any `PAY`, repayment or handle action listed alongside these steps. Details: [references/onboarding-context.md](references/onboarding-context.md)

**Bank repayment.** While the rail is on, `get_context` may list these. Each is `actor: BORROWER`, `handoff_required: false`, with no `tool` and no `handoff_type`. There is no `open_url`. `handoff_required: false` means there is no browser handoff, not that you perform the debit. Report the action to the borrower and tell them to open the SohoPay portal themselves (give no link), then carry on with any `AGENT` action listed alongside it, such as `PAY`. Do not call `start_browser_handoff`, invent a URL, or ask for an account number or routing number. Do not start `{SKILL:sohopay-repay}` for them. There is no debit tool and no `repayment:bank:execute`. The borrower completes the debit on the SohoPay portal.

| Action | Reason code | When |
| --- | --- | --- |
| `REPAY_FROM_BANK` | `BANK_REPAYMENT_AVAILABLE` | Debit consent is ready and on-chain debt, rounded down to the cent, is at least $0.01 |
| `SET_UP_AUTOPAY` | `BANK_AUTOPAY_AVAILABLE` | Debit consent is ready, there is no active autopay, and autopay is not paused |
| `REAUTHORIZE_BANK_DEBIT` | `BANK_AUTOPAY_PAUSED` | Autopay is paused. This replaces `SET_UP_AUTOPAY` |
| `REPAY_RETURNED_AMOUNT` | `BANK_RETURN_OBLIGATION_OPEN` | A return obligation is open. It is separate off-chain debt. Do not increase `outstandingDebt` |

`unapplied_bank_credit`, when present, is a string in 6-decimal USDC base units (`"10000000"` is $10.00; convert before you say it). It is settled bank money the facility debt could not absorb. Report it. It is not spendable credit, not a reason to skip a payment, and not something you apply on chain. It is omitted when the rail is off or there is no surplus.

9. **Completion — celebrate, then hand over the web dashboard.** Only when onboarding is actually complete (agent grant ACTIVE **and** @handle claimed; plus `can_pay` true, or the onboarded-but-not-spend-ready no-wallet path in step 1). Never on an incomplete / STOP report. Do not start a payment. End the turn with this block, filling `<>` from `get_context` / `get_borrower_status` (omit a table row whose value you do not have — never invent a statistic):

---
>
> ## 🎉 You're in — welcome to SohoPay!
>
> | | |
> | :--- | :--- |
> | 🪪 **Handle** | `@<handle>` |
> | 💳 **Available credit** | **<available_credit>** |
> | 🔐 **Agent grant** | **ACTIVE** ✅ |
>
> ### 📊 Explore your web dashboard
>
> **👉 <BORROWER_PORTAL_URL>**
>
> Your personal overview in the browser — check credit and spending statistics, follow settlements, watch your outstanding balance and repayments, and manage your account and agent grant, all in one place.
>
> ✨ *Log in with the same account you just onboarded with — and bookmark it for a quick check-in anytime.*

Resolve `<BORROWER_PORTAL_URL>` from the environment row in `{SKILL:sohopay-mcp-connect}` — **staging: `https://staging.borrower.sohopay.xyz/`**. Show it as a bare URL on its own line so every harness renders it clickable. If the environment has no portal (production row is `—`), skip the dashboard section entirely: never send a production borrower the staging link, and never invent a production portal URL. On the not-spend-ready path, keep the block but replace the credit row's value with “Connect a wallet or bank account to start paying”.

Dropped scopes are not fatal — re-request after gates complete. Scope table: [references/scopes.md](references/scopes.md). Operate: `{SKILL:sohopay-human-direct}`. Warm pay after the grant is ACTIVE: `{SKILL:sohopay-x402}`.
