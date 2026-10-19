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
4. Route using **Routing** below — branch on the first blocking `next_actions` entry, scan the full array for `HANDLE_CLAIM_REQUIRED`, and treat every `FINANCIAL_SOURCE_REQUIRED` entry as an alternative. Do not re-derive the next step from raw balances/statuses; `get_context` already decided it.

### Routing
`get_context` returns `next_actions` with any blocking borrower step first (if any), then `PAY` when spending is available, then `AWAIT_REPAYMENT`, then other hints. If **any** entry has `reason_code: FINANCIAL_SOURCE_REQUIRED`, take the source choice below first — it may sit behind `PROVE_WALLET` (`WALLET_PROOF_REQUIRED`) at `[0]`. Otherwise branch on `next_actions[0]`: its `reason_code`, `actor`, and `handoff_required` tell you the move and whether the borrower is needed.

The workload key, borrower token, and ACTIVE grant come immediately after `register_borrower`, even when `COMPLETE_PROFILE` is listed. Inside the blocker loop, `COMPLETE_PROFILE` is first, ahead of any wallet or bank step: report it, invent no link, and end the turn. Do not poll. Before ending any turn in that loop, claim a handle when `HANDLE_CLAIM_REQUIRED` is listed.

**`FINANCIAL_SOURCE_REQUIRED`.** Every entry with that reason is an alternative source. After the key and the ACTIVE grant, and only when `COMPLETE_PROFILE` is not listed, ask the borrower wallet or bank once, then: `CONNECT_WALLET` + `CONNECT_BANK` (no wallet) → `start_browser_handoff` with the chosen `action` and a fresh idempotency key; `PROVE_WALLET` + `CONNECT_BANK` (wallet registered, proof missing) → wallet means the proof (`request_signature_challenge` then `submit_signature`, no link), bank means `start_browser_handoff` with `action: CONNECT_BANK`. Never send `CONNECT_WALLET` while `PROVE_WALLET` is listed. Open `open_url` verbatim. After the borrower returns, call `get_context`. Not a stop: a `CONNECT_BANK` listed next to `EVALUATE_CREDIT` is optional evidence for a borrower who already has a source. `EVALUATE_CREDIT`, `REVIEW_CREDIT_OFFER`, `REPAYMENT_METHOD_REQUIRED`, `IN_REVIEW`, and `INELIGIBLE` are not agent-actionable: report onboarded but not spend-ready and end the turn. Do not poll. `REVIEW_AND_ACCEPT_FACILITY` calls `review_facility_offer`. Stop when `purchasing_power.can_pay` is true, report available credit, and do not start a payment. Details: `{SKILL:sohopay-onboard}` step 5.

| `next_actions[0].reason_code` | `actor` · handoff | Meaning | Go to |
|-------------------------------|-------------------|---------|-------|
| `BORROWER_REGISTRATION_REQUIRED` | BORROWER · yes | Borrower not registered | `{SKILL:sohopay-onboard}` |
| `FACILITY_OFFER_ACCEPTANCE_REQUIRED` | BORROWER · yes | Facility offer is ready — `REVIEW_AND_ACCEPT_FACILITY` calls `review_facility_offer` | `{SKILL:sohopay-onboard}` |
| `FINANCIAL_SOURCE_REQUIRED` | BORROWER · yes | No verified source — `CONNECT_WALLET` / `CONNECT_BANK` are alternatives (see above) | `{SKILL:sohopay-onboard}` step 5 |
| `WALLET_PROOF_REQUIRED` | BORROWER · yes | `PROVE_WALLET`: wallet registered, proof missing. With `CONNECT_BANK` listed, ask wallet or bank first | `{SKILL:sohopay-onboard}` step 5 |
| `AGENT_AUTHORIZATION_REQUIRED` | BORROWER · yes | No ACTIVE agent grant | `{SKILL:sohopay-authorize-agent}` |
| `HANDLE_CLAIM_REQUIRED` | BORROWER · yes | No @handle — required onboarding gate (usually **not** `[0]`; emitted last — see note below); borrower picks/confirms, then `claim_handle`. Does not block `can_pay` | `{SKILL:sohopay-onboard}` step 6 (claim path); tool contract `{SKILL:sohopay-handle}` |
| `SPENDING_AVAILABLE` (`can_pay: true`) | AGENT · no | Spending available — pick the pay flow by context | HTTP 402 merchant → `{SKILL:sohopay-x402}`; non-x402 spend/sign → `{SKILL:sohopay-spend}`; operate (human-direct default) → `{SKILL:sohopay-human-direct}` |
| `REPAYMENT_IN_FLIGHT` | AGENT · no | A repayment is confirming | `{SKILL:sohopay-repay}` (monitor) |

**`HANDLE_CLAIM_REQUIRED` when it is not `[0]`.** The backend may list `SPENDING_AVAILABLE` (or another AGENT step) before `HANDLE_CLAIM_REQUIRED` when the borrower can pay but has no @handle. After you act on `next_actions[0]`, scan the full array: any entry with `reason_code: HANDLE_CLAIM_REQUIRED` (`action: CLAIM_HANDLE`, `tool: claim_handle`) means onboarding is **incomplete** until a handle is claimed — hand off to the borrower via `{SKILL:sohopay-onboard}` step 6 (or `{SKILL:sohopay-handle}` for claim mechanics). Do not report the borrower as fully onboarded while that entry is present.

**`handoff_required: true` → stop and hand off.** The step needs the borrower's signature/decision (`actor: BORROWER`); surface it to the borrower and do not attempt it as the agent. `actor: AGENT` steps you perform yourself. For a delegated session, continue in `{SKILL:sohopay-agent-session}`.

> v8 may emit a blocking step plus `PAY`, `AWAIT_REPAYMENT`, `GIFT_RECEIVED`, and `HANDLE_CLAIM_REQUIRED` (last when the borrower has no handle). Source steps (`FINANCIAL_SOURCE_REQUIRED`) may both be listed. `REPAYMENT_IN_FLIGHT` is reserved on some deployments. If `next_actions` is empty and `can_pay` is false, resolve the blocker shown in `authorization` (frozen / suspended / compliance) before retrying. Exception: when `credit` is `null` there is no credit account yet, not a blocker (see below).

### get_context essentials
`get_context` is one backend-backed call returning `borrower_id` **directly**, plus credit, authorization, and `next_actions` hints. It replaces the `whoami` → `get_borrower_status` dance on v8+. `credit` and `repayment` are `null` when the borrower has no credit account yet: say there is no credit line yet and follow `next_actions` (if it is empty, there is nothing to do yet; say so). Never report it as a zero credit limit or credit balance. Received gifts are separate: report `gifts.available` when it is above zero, even with no credit line (not spendable until a credit account exists).

**When to call:** at session start, and after onboarding, credit activation, authorization, a material payment, a repayment, or an authorization error. Not before every trivial read.

**Invariant — descriptive only.** `prepare_x402_payment` revalidates and is authoritative. Never skip a payment attempt, or assume success, because `can_pay` was true.

**Identity.** Use the `borrower_id` `get_context` returns. Do **not** substitute `principal_id` for `borrower_id`.

| Tool | Use when |
|------|----------|
| `whoami` | JWT claims only; v7 servers or a thin identity check |
| `get_context` | v8+ — **prefer**: identity + credit + authorization + next step |
| `get_session_context` | Delegated-session detail — only if the host lists it |
| `authorization-context` | Grant limits behind a specific denial |
