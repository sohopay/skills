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

`whoami` usually omits `borrower_id` — use `principal_id`. `wallet: null` is normal — `get_borrower_status`. `SESSION_GATE_SKIPPED_NO_SESSION` is expected.

Load a sibling **only when that step is next**:

- [ ] Identity / register / wallet proof / token / workload key — **sohopay-onboard** (`{SKILL:sohopay-onboard}`)
- [ ] HTTP 402 — **sohopay-x402** (`{SKILL:sohopay-x402}`)
- [ ] `AGENT_AUTHORIZATION_REQUIRED` — **sohopay-authorize-agent** (`{SKILL:sohopay-authorize-agent}`)
- [ ] Non-x402 spend / first-time merchant detail — **sohopay-spend** (`{SKILL:sohopay-spend}`)
- [ ] Poll `get_settlement_status` by **`settlement_id`** until terminal (~5s `l2_confirmations`)

```text
whoami → register_borrower → wallet proof (STOP) → token → register_agent_workload_key
  → prepare_x402_payment → VOUCHER_ISSUED sign / COMPLETED header → poll settlement_id
```

**payRequest** = consent for the x402 fast path. Still STOP for wallet-proof and `authorize_agent`. Do not fall back to custodial `sign_transaction` on `VOUCHER_ISSUED` / `CUSTODIAL_SIGNING_DISABLED`.
