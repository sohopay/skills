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
- [ ] Step 5: smoke — hosted health + read-only `whoami` / `get_borrower_status`. Do not run `npm run smoke` unless you cloned the server
- [ ] Report — [references/report.md](references/report.md)
- [ ] Then operate via **sohopay-human-direct** (`{SKILL:sohopay-human-direct}`). Load onboard / spend / x402 / authorize-agent only when that checklist reaches them

Fetch order: local `sohopay-*` `SKILL.md` → `{SKILLS_BASE}` (CDN after publish) → GitHub raw last-resort. Do not fetch `llms-full.txt`.

Consent gates still apply after setup:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

Wallet-proof signing (onboarding).

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

First spending-scope token grant (not a 402 payRequest refresh).

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

`AGENT_AUTHORIZATION_REQUIRED` / wallet-proof / non-`RISK_FIRST_TIME_MERCHANT` policy deny. A payRequest is consent for the x402 fast path — **sohopay-x402**.
