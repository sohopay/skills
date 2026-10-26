---
name: sohopay-bootstrap
description: >
  Orient at the start of a connected SohoPay session: read identity, credit, authorization and one next step with get_context, then route to the right flow. Use when you have an authenticated session and need borrower_id, want to know whether this borrower can pay, or must decide which SohoPay flow comes next — after onboarding, credit activation, authorization, a payment, a repayment, or an authorization error. Requires catalog v8+; on v7 use whoami + get_borrower_status. Not for connecting or onboarding themselves, nor for every trivial read.
license: Apache-2.0
metadata:
  hosted_name: bootstrap
  title: SohoPay Agent Bootstrap
  version: "1.0"
---

**Availability:** requires a server advertising tool-catalog **v8+**. On v7 servers use `whoami` (resolve `borrower_id = whoami.borrower_id ?? whoami.principal_id`) + `get_borrower_status`.

**Boundary.** This skill orients an already-connected, authenticated session — *what is my state and which flow next*. It does **not** connect or onboard: getting connected is `{SKILL:sohopay-mcp-connect}` / `{SKILL:sohopay-setup}`; borrower onboarding steps are `{SKILL:sohopay-onboard}`.

### Cold-start sequence
1. Connect / authenticate → `{SKILL:sohopay-mcp-connect}` (setup presets: `{SKILL:sohopay-setup}`).
2. If not yet onboarded — identity + onboarding state → `{SKILL:sohopay-onboard}`.
3. **Orient in one call → `get_context`** (v8+): returns `borrower_id`, credit headroom, authorization, and `next_actions` hints. On v7: `whoami` + `get_borrower_status`.
4. Route using **Routing** below — branch on the first blocking `next_actions` entry, scan the full array for `HANDLE_CLAIM_REQUIRED` and the bank-repayment reason codes, and treat every `FINANCIAL_SOURCE_REQUIRED` entry as an alternative. Do not re-derive the next step from raw balances/statuses; `get_context` already decided it.

### Routing
`get_context` returns `next_actions` with any blocking borrower step first (if any), then `PAY` when spending is available, then `AWAIT_REPAYMENT`, then other hints. If **any** entry has `reason_code: FINANCIAL_SOURCE_REQUIRED`, take the source choice below first — it may sit behind `PROVE_WALLET` (`WALLET_PROOF_REQUIRED`) at `[0]`. Otherwise branch on `next_actions[0]`: its `reason_code`, `actor`, and `handoff_required` tell you the move and whether the borrower is needed.

**`FINANCIAL_SOURCE_REQUIRED`.** Every entry with that reason is an alternative source. Ask the borrower wallet or bank before anything else, then: `CONNECT_WALLET` + `CONNECT_BANK` (no wallet) → `start_browser_handoff` with the chosen `action` and a fresh idempotency key; `PROVE_WALLET` + `CONNECT_BANK` (wallet registered, proof missing) → wallet means the proof (`request_signature_challenge` then `submit_signature`, no link), bank means `start_browser_handoff` with `action: CONNECT_BANK`. Open `open_url` verbatim. After the borrower returns, call `get_context`. Not a stop: a `CONNECT_BANK` listed next to `EVALUATE_CREDIT` is optional evidence for a borrower who already has a source. Details: `{SKILL:sohopay-onboard}` step 2.

| `next_actions[0].reason_code` | `actor` · handoff | Meaning | Go to |
|-------------------------------|-------------------|---------|-------|
| `BORROWER_REGISTRATION_REQUIRED` | BORROWER · yes | Borrower not registered | `{SKILL:sohopay-onboard}` |
| `FACILITY_OFFER_ACCEPTANCE_REQUIRED` | BORROWER · yes | Facility offer is ready — `REVIEW_AND_ACCEPT_FACILITY` calls `review_facility_offer` | `{SKILL:sohopay-onboard}` |
| `FINANCIAL_SOURCE_REQUIRED` | BORROWER · yes | No verified source — `CONNECT_WALLET` / `CONNECT_BANK` are alternatives (see above) | `{SKILL:sohopay-onboard}` step 2 |
| `WALLET_PROOF_REQUIRED` | BORROWER · yes | `PROVE_WALLET`: wallet registered, proof missing. With `CONNECT_BANK` listed, ask wallet or bank first | `{SKILL:sohopay-onboard}` steps 2 and 4 |
| `AGENT_AUTHORIZATION_REQUIRED` | BORROWER · yes | No ACTIVE agent grant | `{SKILL:sohopay-authorize-agent}` |
| `HANDLE_CLAIM_REQUIRED` | BORROWER · yes | No @handle — required onboarding gate (usually **not** `[0]`; emitted last — see note below); borrower picks/confirms, then `claim_handle` | `{SKILL:sohopay-onboard}` step 10 (claim path); tool contract `{SKILL:sohopay-handle}` |
| `SPENDING_AVAILABLE` (`can_pay: true`) | AGENT · no | Spending available — pick the pay flow by context | HTTP 402 merchant → `{SKILL:sohopay-x402}`; non-x402 spend/sign → `{SKILL:sohopay-spend}`; operate (human-direct default) → `{SKILL:sohopay-human-direct}` |
| `REPAYMENT_IN_FLIGHT` | AGENT · no | A repayment is confirming | `{SKILL:sohopay-repay}` (monitor) |
| `BANK_REPAYMENT_AVAILABLE` | BORROWER · no link | `REPAY_FROM_BANK`. Report it to the borrower | **Bank repayment** below |
| `BANK_AUTOPAY_AVAILABLE` | BORROWER · no link | `SET_UP_AUTOPAY`. Report it to the borrower | **Bank repayment** below |
| `BANK_AUTOPAY_PAUSED` | BORROWER · no link | `REAUTHORIZE_BANK_DEBIT`. Report it to the borrower. Replaces `SET_UP_AUTOPAY` | **Bank repayment** below |
| `BANK_RETURN_OBLIGATION_OPEN` | BORROWER · no link | `REPAY_RETURNED_AMOUNT`. Report it to the borrower | **Bank repayment** below |

**Bank repayment.** These four appear only while the bank rail is on. Each is `actor: BORROWER`, `handoff_required: false`, with no `tool` and no `handoff_type`. The backend returns no `open_url`. `handoff_required: false` means there is no browser handoff, not that you perform the debit. Report the action to the borrower and tell them to open the SohoPay portal themselves (give no link), then carry on with any `AGENT` action listed alongside it, such as `PAY`. Do not call `start_browser_handoff`, invent a URL, or ask for a legal name, date of birth, account number, or routing number. Do not open `{SKILL:sohopay-repay}` for them: that skill is a wallet repayment. There is no debit tool and no `repayment:bank:execute`. The borrower completes the debit on the SohoPay portal.

| Action | Reason code | When |
| --- | --- | --- |
| `REPAY_FROM_BANK` | `BANK_REPAYMENT_AVAILABLE` | Debit consent is ready and on-chain debt, rounded down to the cent, is at least $0.01 |
| `SET_UP_AUTOPAY` | `BANK_AUTOPAY_AVAILABLE` | Debit consent is ready, there is no active autopay, and autopay is not paused |
| `REAUTHORIZE_BANK_DEBIT` | `BANK_AUTOPAY_PAUSED` | Autopay is paused. This replaces `SET_UP_AUTOPAY` |
| `REPAY_RETURNED_AMOUNT` | `BANK_RETURN_OBLIGATION_OPEN` | A return obligation is open. It is separate off-chain debt. Do not increase `outstandingDebt` |

`unapplied_bank_credit`, when present, is a string in 6-decimal USDC base units (`"10000000"` is $10.00; convert before you say it). It is settled bank money the facility debt could not absorb. Report it. It is not spendable credit, not a reason to skip a payment, and not something you apply on chain. It is omitted when the rail is off or there is no surplus. Scan the full `next_actions` array: these can sit beside `PAY`.

**`HANDLE_CLAIM_REQUIRED` when it is not `[0]`.** The backend may list `SPENDING_AVAILABLE` (or another AGENT step) before `HANDLE_CLAIM_REQUIRED` when the borrower can pay but has no @handle. After you act on `next_actions[0]`, scan the full array: any entry with `reason_code: HANDLE_CLAIM_REQUIRED` (`action: CLAIM_HANDLE`, `tool: claim_handle`) means onboarding is **incomplete** until a handle is claimed — hand off to the borrower via `{SKILL:sohopay-onboard}` step 10 (or `{SKILL:sohopay-handle}` for claim mechanics). Do not report the borrower as fully onboarded while that entry is present.

**`handoff_required: true` → stop and hand off.** The step needs the borrower's signature/decision (`actor: BORROWER`); surface it to the borrower and do not attempt it as the agent. `actor: AGENT` steps you perform yourself. For a delegated session, continue in `{SKILL:sohopay-agent-session}`.

> v8 may emit a blocking step plus `PAY`, `AWAIT_REPAYMENT`, `GIFT_RECEIVED`, the bank-repayment actions above, and `HANDLE_CLAIM_REQUIRED` (last when the borrower has no handle). Source steps (`FINANCIAL_SOURCE_REQUIRED`) may both be listed. `REPAYMENT_IN_FLIGHT` is reserved on some deployments. If `next_actions` is empty and `can_pay` is false, resolve the blocker shown in `authorization` (frozen / suspended / compliance) before retrying. Exception: when `credit` is `null` there is no credit account yet, not a blocker (see below).

### get_context essentials
`get_context` is one backend-backed call returning `borrower_id` **directly**, plus credit, authorization, and `next_actions` hints. It replaces the `whoami` → `get_borrower_status` dance on v8+. `credit` and `repayment` are `null` when the borrower has no credit account yet: say there is no credit line yet and follow `next_actions` (if it is empty, there is nothing to do yet; say so). Never report it as a zero credit limit or credit balance. Received gifts are separate: report `gifts.available` when it is above zero, even with no credit line (not spendable until a credit account exists). `unapplied_bank_credit` (6-decimal base units, so `"10000000"` is $10.00) is also separate from spendable credit: report it when present, and do not spend it or skip a payment because of it.

**When to call:** at session start, and after onboarding, credit activation, authorization, a material payment, a repayment, or an authorization error. Not before every trivial read.

**Invariant — descriptive only.** `prepare_x402_payment` revalidates and is authoritative. Never skip a payment attempt, or assume success, because `can_pay` was true.

**Identity.** Use the `borrower_id` `get_context` returns. Do **not** substitute `principal_id` for `borrower_id`.

| Tool | Use when |
|------|----------|
| `whoami` | JWT claims only; v7 servers or a thin identity check |
| `get_context` | v8+ — **prefer**: identity + credit + authorization + next step |
| `get_session_context` | Delegated-session detail — only if the host lists it |
| `authorization-context` | Grant limits behind a specific denial |
