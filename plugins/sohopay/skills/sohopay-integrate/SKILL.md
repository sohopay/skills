---
name: sohopay-integrate
description: >
  Route to one SohoPay sibling and stop. Use when sohopay-integrate is installed
  or the operator says SohoPay without a workflow — not a substitute for that sibling.
license: Apache-2.0
metadata:
  version: "1.0"
---

Activate **one** row. Do not load the others. Do not plan.

| Intent | Skill |
|--------|-------|
| Set up / `https://sohopay.xyz/install` | `sohopay-setup` |
| Staging / `https://staging.sohopay.xyz/install` | `sohopay-setup-staging` |
| Connect MCP | `sohopay-mcp-connect` |
| Staging MCP | `sohopay-mcp-connect-staging` |
| Onboard / wallet proof / workload key / agent grant | `sohopay-onboard` |
| Operate (human-direct) | `sohopay-human-direct` |
| HTTP 402 / pay / VOUCHER_ISSUED | `sohopay-x402` |
| `AGENT_AUTHORIZATION_REQUIRED` | `sohopay-authorize-agent` |
| Spend / policy / sign (not a 402) | `sohopay-spend` |
| Idempotency key | `sohopay-idempotency` |
| Delegated session | `sohopay-agent-session` |

Do not use `sohopay-integrate/docs/` (removed).
