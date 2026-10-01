---
name: sohopay-get-context
description: >
  Read backend-backed identity, credit, authorization and one next step in a single call with get_context. Use when starting a SohoPay workflow, resolving borrower_id, or checking whether this borrower can pay after onboarding, credit activation, authorization, a payment, a repayment, or an authorization error — requires catalog v8+; not for every trivial read.
license: Apache-2.0
metadata:
  hosted_name: get-context
  title: SohoPay get_context
  version: "1.0"
---

**Availability:** requires a server advertising tool-catalog **v8+**. On v7 servers use `whoami` (resolve `borrower_id = whoami.borrower_id ?? whoami.principal_id`) + `get_borrower_status`.

`get_context` is one backend-backed call returning `borrower_id` **directly**, plus credit, authorization, and one `next_actions` step. It replaces the `whoami` → `get_borrower_status` dance.

**When to call:** at workflow start; after onboarding, credit activation, authorization, a material payment, a repayment, or an authorization error. Not before every trivial read.

**Invariant — descriptive only.** `prepare_x402_payment` revalidates and is authoritative. Never skip a payment attempt, or assume success, because `can_pay` was true.

**Identity.** Use the `borrower_id` `get_context` returns. Do **not** substitute `principal_id` for `borrower_id`.

| Tool | Use when |
|------|----------|
| `whoami` | JWT claims only; v7 servers or a thin identity check |
| `get_context` | v8+ — **prefer**: identity + credit + authorization + next step |
| `get_session_context` | Delegated-session detail — only if the host lists it |
| `authorization-context` | Grant limits behind a specific denial |

Onboarding steps: `{SKILL:sohopay-onboard}`. Operate: `{SKILL:sohopay-human-direct}`.
