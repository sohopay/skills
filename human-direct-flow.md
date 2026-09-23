<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1
     SKILLS_HOST (CDN origin): https://agents.sohopay.xyz
     Fetch order: local sticky → {SKILLS_BASE} → GitHub raw last-resort.
     Publish rewrites SKILLS_BASE to Prod and {SKILLS_HOST} to the origin. -->
<!-- Generated from plugins/sohopay/skills — do not hand-edit this file. Run npm run generate:hosted -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Human-Direct Flow

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

Execute the next checklist item only. Do not plan. **Before:** MCP connected (`{SKILLS_BASE}/mcp-connect.md`).

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

`whoami` usually omits `borrower_id` — use `principal_id`. `wallet: null` is normal — `get_borrower_status`. `SESSION_GATE_SKIPPED_NO_SESSION` is expected.

Load a sibling **only when that step is next**:

- [ ] Identity / register / wallet proof / token / workload key — **sohopay-onboard** (`{SKILLS_BASE}/borrower-onboard.md`)
- [ ] HTTP 402 — **sohopay-x402** (`{SKILLS_BASE}/x402-credit-pay.md`)
- [ ] `AGENT_AUTHORIZATION_REQUIRED` — **sohopay-authorize-agent** (`{SKILLS_BASE}/authorize-agent.md`)
- [ ] Non-x402 spend / first-time merchant detail — **sohopay-spend** (`{SKILLS_BASE}/spend-and-pay.md`)
- [ ] Poll `get_settlement_status` by **`settlement_id`** until terminal (~5s `l2_confirmations`)

```text
whoami → register_borrower → wallet proof (STOP) → token → register_agent_workload_key
  → prepare_x402_payment → VOUCHER_ISSUED sign / COMPLETED header → poll settlement_id
```

**payRequest** = consent for the x402 fast path. Still STOP for wallet-proof and `authorize_agent`. Do not fall back to custodial `sign_transaction` on `VOUCHER_ISSUED` / `CUSTODIAL_SIGNING_DISABLED`.
