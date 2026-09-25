---
name: sohopay-setup
description: >
  Detect this harness, optionally install sticky SohoPay skills, and connect hosted MCP. Use when the operator asks to set up SohoPay, bootstrap agents.sohopay, or Set up https://sohopay.xyz/install — not for staging-only E2E, spending, or HTTP 402.
license: Apache-2.0
metadata:
  hosted_name: setup
  title: SohoPay Agent Setup for AI Agents
  version: "1.0"
---

Execute this checklist in order. Do not write a plan, recap, or load other SohoPay skills until a step names them.

For **staging**, stop and follow **sohopay-setup-staging** (`{SKILL:sohopay-setup-staging}`) — do not mix production and staging hosts.

CRITICAL: **sohopay-mcp-server** is the MCP runtime and **sohopay-backend** is the source of truth. Do not hold borrower private keys. MCP transports signatures only.

Default path needs **network access** and may write **MCP config only**. Skip sticky skills unless the operator asked. Never turn off permission prompts.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

Verify identity first: [references/prereqs.md](references/prereqs.md).

## Checklist

- [ ] Step 1–2: harness + network-only prereqs — [references/prereqs.md](references/prereqs.md)
- [ ] Step 3: sticky skills — **skip** unless asked — [references/sticky-install.md](references/sticky-install.md)
- [ ] Step 4: activate **sohopay-mcp-connect** (`{SKILL:sohopay-mcp-connect}`). Hosted MCP: `https://mcp.sohopay.xyz`
- [ ] Step 5: smoke the **hosted** connection — health + read-only `whoami` / `get_borrower_status`. Do not run `npm run smoke`. Local MCP setup is currently not available
- [ ] Step 6: spend-ready onboard in **one turn** — **sohopay-onboard** (`{SKILL:sohopay-onboard}`), then **sohopay-authorize-agent** (`{SKILL:sohopay-authorize-agent}`) immediately after the workload key. Do not wait for the first payment
- [ ] Report — [references/report.md](references/report.md)
- [ ] Then operate via **sohopay-human-direct** (`{SKILL:sohopay-human-direct}`). Load spend / x402 only when that checklist reaches them

Fetch order: local `sohopay-*` `SKILL.md` → `{SKILLS_BASE}` (CDN after publish) → GitHub raw last-resort. Do not fetch `llms-full.txt`.

Onboarding chain (same turn): `register_borrower` (store `operational_agent_id` + `terminal_id`) → wallet proof if not already verified → `request_borrower_token` (`spend:intent:create`, `policy:evaluate`, `signing:request`, `payment:read`, `credit:facility:accept`) → `register_agent_workload_key` → `authorize_agent`. Run that chain in **one turn**. Do **not** ask the operator, and do **not** wait for a chat reply, before `request_borrower_token` or before `authorize_agent`. Open the grant consent page in that same turn. Onboarding is incomplete until the grant is ACTIVE. Never fabricate a signature.

A payRequest (“pay” / merchant 402 URL) is consent for that payment — **sohopay-x402**. Before a **non-payRequest** payment:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**
