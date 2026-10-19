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

For **staging**, first load **sohopay-setup-staging** (`{SKILL:sohopay-setup-staging}`) to pin the staging row, then run this checklist against those staging hosts — do not mix production and staging hosts. If you already arrived here from **sohopay-setup-staging** with the staging row pinned, continue the checklist below; do not loop back.

CRITICAL: **sohopay-mcp-server** is the MCP runtime and **sohopay-backend** is the source of truth. Do not hold borrower private keys. MCP transports signatures only.

Default path needs **network access** and may write **MCP config only**. Skip sticky skills unless the operator asked. Never turn off permission prompts.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

Verify identity first: [references/prereqs.md](references/prereqs.md).

## Checklist

- [ ] Step 1–2: harness + network-only prereqs — [references/prereqs.md](references/prereqs.md)
- [ ] Step 3: sticky skills — **skip** unless asked — [references/sticky-install.md](references/sticky-install.md)
- [ ] Step 4: activate **sohopay-mcp-connect** (`{SKILL:sohopay-mcp-connect}`). Hosted MCP origin — **production:** `https://mcp.sohopay.xyz`. **Staging path:** use the staging MCP origin pinned by **sohopay-setup-staging** (`https://staging.mcp.sohopay.xyz`), never the production host
- [ ] Step 5: smoke the **hosted** connection — health + read-only `whoami` / `get_borrower_status`. Do not run `npm run smoke`. Local MCP setup is currently not available
- [ ] Step 6: spend-ready onboard — **sohopay-onboard** (`{SKILL:sohopay-onboard}`): register this terminal's workload key immediately after terminal registration, then **sohopay-authorize-agent** (`{SKILL:sohopay-authorize-agent}`) through passkey consent before financial-source/facility readiness. Do not wait for the first payment
- [ ] Report — [references/report.md](references/report.md)
- [ ] Then operate via **sohopay-human-direct** (`{SKILL:sohopay-human-direct}`). Load spend / x402 only when that checklist reaches them

Fetch order: local `sohopay-*` `SKILL.md` → `{SKILLS_BASE}` (CDN after publish) → GitHub raw last-resort. Do not fetch `llms-full.txt`.

Onboarding chain: `register_borrower` (store `operational_agent_id` + `terminal_id`) → `register_agent_workload_key` immediately (wallet-independent) → `request_borrower_token` including `credit:facility:accept` → `authorize_agent` and open the passkey consent page (within-threshold grants need no wallet; above-threshold grants also need an EOA signature) → if `get_context` lists `FINANCIAL_SOURCE_REQUIRED`, STOP and ask wallet or bank, then `start_browser_handoff` with that action and a fresh idempotency key → when `REVIEW_AND_ACCEPT_FACILITY` is listed, `review_facility_offer` → wallet proof only when the borrower chose the wallet (`PROVE_WALLET`). `CONNECT_WALLET` means there is no wallet. `PROVE_WALLET` plus `CONNECT_BANK` means the wallet is already registered: prove it or connect a bank. A bank-only borrower still registers the key and activates a within-threshold passkey grant; a later `REPAYMENT_METHOD_REQUIRED` may still leave them not spend-ready. Apart from an explicit source-choice STOP, do **not** wait for a chat reply, before `request_borrower_token`; do not wait for first payment; never fabricate a passkey assertion or signature.

A payRequest (“pay” / merchant 402 URL) is consent for that payment — **sohopay-x402**. Before a **non-payRequest** payment:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**
