---
name: sohopay-human-direct
description: >
  Run the default human-direct operate path (whoami through prepare_x402_payment and settlement_id polling). Use when the borrower acts directly, SESSION_GATE_SKIPPED_NO_SESSION appears, or after MCP connect to operate — not for create_agent_session.
license: Apache-2.0
metadata:
  hosted_name: human-direct-flow
  title: SohoPay Human-Direct Flow
  version: "1.0"
---

Execute the next checklist item only. Do not plan. **Before:** MCP connected (`{SKILL:sohopay-mcp-connect}`).

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

On a server advertising catalog v8+, open with `get_context` (`borrower_id` + credit + authorization + next step in one call — `{SKILL:sohopay-bootstrap}`); on v7 open with `whoami`. `whoami` usually omits `borrower_id` — use `principal_id`. `wallet: null` is normal — `get_borrower_status`. `SESSION_GATE_SKIPPED_NO_SESSION` is expected.

Load a sibling **only when that step is next**:

- [ ] Onboarding until `purchasing_power.can_pay` is true — **sohopay-onboard** (`{SKILL:sohopay-onboard}`), then **sohopay-authorize-agent** in that same turn. A missing handle does not block `can_pay`, but the borrower is not fully onboarded without one
- [ ] Send credit to an `@handle` — **sohopay-gift** (`{SKILL:sohopay-gift}`), after `can_pay`
- [ ] HTTP 402 — **sohopay-x402** (`{SKILL:sohopay-x402}`)
- [ ] `AGENT_AUTHORIZATION_REQUIRED` — recovery only — **sohopay-authorize-agent** (`{SKILL:sohopay-authorize-agent}`)
- [ ] Repay / pay back SohoPay credit — **sohopay-repay** (`{SKILL:sohopay-repay}`)
- [ ] Non-x402 spend / first-time merchant detail — **sohopay-spend** (`{SKILL:sohopay-spend}`)
- [ ] Poll `get_settlement_status` by **`settlement_id`** until terminal (~5s `l2_confirmations`)

```text
get_context (v8+) or whoami (v7)
  → register_borrower (store operational_agent_id + terminal_id)
  → register_agent_workload_key (even with no wallet; COMPLETE_PROFILE does not delay this)
  → request_borrower_token (credit:facility:accept and handle:claim; no chat question)
  → authorize_agent (open consent_url; poll until ACTIVE)
  → repeat get_context, one current blocker (claim a listed CLAIM_HANDLE before ending any turn):
       COMPLETE_PROFILE first (report; no link; no wallet or bank; end the turn)
       CONNECT_WALLET + CONNECT_BANK: ask once, start_browser_handoff with that action
       PROVE_WALLET + CONNECT_BANK: proof, or action CONNECT_BANK (never CONNECT_WALLET)
       REVIEW_AND_ACCEPT_FACILITY: review_facility_offer
       no agent-actionable step (EVALUATE_CREDIT, REVIEW_CREDIT_OFFER, REPAYMENT_METHOD_REQUIRED, IN_REVIEW, INELIGIBLE): report onboarded but not spend-ready; end the turn; do not poll
       CLAIM_HANDLE: claim a confirmed handle (does not block can_pay)
  → stop when purchasing_power.can_pay is true; report available credit; do not start a payment
  → prepare_x402_payment only when the operator is paying
```

Call `request_borrower_token` with no chat prompt during onboarding. On a later pay, do not call `whoami` to decide a refresh. Re-request only when this chat has no successful token newer than 12 minutes. **payRequest** = consent for the x402 fast path. Skip `whoami` on that warm path. If the grant is already ACTIVE, do not re-run `authorize_agent`. Do not fall back to custodial `sign_transaction` on `VOUCHER_ISSUED` / `CUSTODIAL_SIGNING_DISABLED`.
