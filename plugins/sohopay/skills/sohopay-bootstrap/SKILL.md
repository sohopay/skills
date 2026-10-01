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
3. **Orient in one call → `get_context`** (v8+): returns `borrower_id`, credit headroom, authorization, and one `next_actions` step. On v7: `whoami` + `get_borrower_status`.
4. Route on the first `next_actions` entry — see **Routing** below. Do not re-derive the next step from raw balances/statuses; `get_context` already decided it.

### Routing — branch on `next_actions[0]`
`get_context` returns `next_actions` with the blocking step first (if any), then `PAY` when spending is available, then `AWAIT_REPAYMENT`. Branch on `next_actions[0]`: its `reason_code`, `actor`, and `handoff_required` tell you the move and whether the borrower is needed.

| `next_actions[0].reason_code` | `actor` · handoff | Meaning | Go to |
|-------------------------------|-------------------|---------|-------|
| `BORROWER_REGISTRATION_REQUIRED` | BORROWER · yes | Borrower not registered | `{SKILL:sohopay-onboard}` |
| `CREDIT_OFFER_ACCEPTANCE_REQUIRED` | BORROWER · yes | Facility not ACTIVE — credit offer must be accepted (`accept_facility_offer`) | `{SKILL:sohopay-onboard}` |
| `AGENT_AUTHORIZATION_REQUIRED` | BORROWER · yes | No ACTIVE agent grant | `{SKILL:sohopay-authorize-agent}` |
| `SPENDING_AVAILABLE` (`can_pay: true`) | AGENT · no | Spending available — pick the pay flow by context | HTTP 402 merchant → `{SKILL:sohopay-x402}`; non-x402 spend/sign → `{SKILL:sohopay-spend}`; operate (human-direct default) → `{SKILL:sohopay-human-direct}` |
| `REPAYMENT_IN_FLIGHT` | AGENT · no | A repayment is confirming | `{SKILL:sohopay-repay}` (monitor) |

**`handoff_required: true` → stop and hand off.** The step needs the borrower's signature/decision (`actor: BORROWER`); surface it to the borrower and do not attempt it as the agent. `actor: AGENT` steps you perform yourself. For a delegated session, continue in `{SKILL:sohopay-agent-session}`.

> v8 emits at most the first blocking step plus `PAY`; `REPAYMENT_IN_FLIGHT` is reserved (not emitted yet). If `next_actions` is empty and `can_pay` is false, resolve the blocker shown in `authorization` (frozen / suspended / compliance) before retrying.

### get_context essentials
`get_context` is one backend-backed call returning `borrower_id` **directly**, plus credit, authorization, and one `next_actions` step. It replaces the `whoami` → `get_borrower_status` dance on v8+.

**When to call:** at session start, and after onboarding, credit activation, authorization, a material payment, a repayment, or an authorization error. Not before every trivial read.

**Invariant — descriptive only.** `prepare_x402_payment` revalidates and is authoritative. Never skip a payment attempt, or assume success, because `can_pay` was true.

**Identity.** Use the `borrower_id` `get_context` returns. Do **not** substitute `principal_id` for `borrower_id`.

| Tool | Use when |
|------|----------|
| `whoami` | JWT claims only; v7 servers or a thin identity check |
| `get_context` | v8+ — **prefer**: identity + credit + authorization + next step |
| `get_session_context` | Delegated-session detail — only if the host lists it |
| `authorization-context` | Grant limits behind a specific denial |
