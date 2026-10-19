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

Default path needs **network access** and may write **MCP config only**. The agent does not install the signer. Skip sticky skills unless the operator asked. Never turn off permission prompts.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

Verify identity first: [references/prereqs.md](references/prereqs.md).

## Checklist

- [ ] Step 1–2: harness + network-only prereqs — [references/prereqs.md](references/prereqs.md)
- [ ] Step 3: sticky skills — **skip** unless asked — [references/sticky-install.md](references/sticky-install.md)
- [ ] Signer, before MCP: if `sohopay-signer` is missing or older than the pin, show the operator `npm i -g @sohopay/agent-signer@0.3.1` and wait. Do not run it. The same rule is in the workload-key reference: a human installs it, once. `install.sh` may run it when the operator executes the installer. Do not run it again while registering the workload key
- [ ] Step 4: activate **sohopay-mcp-connect** (`{SKILL:sohopay-mcp-connect}`). Hosted MCP origin — **production:** `https://mcp.sohopay.xyz`. **Staging path:** use the staging MCP origin pinned by **sohopay-setup-staging** (`https://staging.mcp.sohopay.xyz`), never the production host
- [ ] Step 5: smoke the **hosted** connection — health + read-only `whoami` / `get_borrower_status`. Do not run `npm run smoke`. Local MCP setup is currently not available
- [ ] Step 6: onboard until spendable credit — **sohopay-onboard** (`{SKILL:sohopay-onboard}`): one `get_context` step at a time until `purchasing_power.can_pay` is true. Do not wait for the first payment, and do not start one
- [ ] Report — [references/report.md](references/report.md)
- [ ] Then operate via **sohopay-human-direct** (`{SKILL:sohopay-human-direct}`). Load spend / x402 only when that checklist reaches them

Fetch order: local `sohopay-*` `SKILL.md` → `{SKILLS_BASE}` (CDN after publish) → GitHub raw last-resort. Do not fetch `llms-full.txt`.

Onboarding chain: `get_context` → `register_borrower` (store `operational_agent_id` + `terminal_id`) → `register_agent_workload_key` immediately, even with no wallet and even when `COMPLETE_PROFILE` is listed → `request_borrower_token` including `credit:facility:accept` and `handle:claim` → `authorize_agent` and open the passkey consent page until the grant is ACTIVE (within-threshold grants need no wallet; above-threshold grants also need an EOA signature) → repeat `get_context` and do only the current blocker. `COMPLETE_PROFILE` is first, ahead of any wallet or bank step: the borrower enters legal name and date of birth on the SohoPay page, never in chat, with no link; report it and end the turn. `CONNECT_WALLET` and `CONNECT_BANK` together: ask once, wallet or bank, then `start_browser_handoff` with that `action`. `PROVE_WALLET` plus `CONNECT_BANK`: wallet means the proof; bank means `action: CONNECT_BANK`. Never send `CONNECT_WALLET` while `PROVE_WALLET` is listed. `REVIEW_AND_ACCEPT_FACILITY`: `review_facility_offer`, open `open_url`, then re-read. When no agent-actionable step is left (`EVALUATE_CREDIT`, `REVIEW_CREDIT_OFFER`, `REPAYMENT_METHOD_REQUIRED`, `IN_REVIEW`, `INELIGIBLE`), report them as onboarded but not spend-ready and end the turn. Do not poll. `CLAIM_HANDLE`: claim a handle the borrower confirms. A missing handle does not block `can_pay`, but the borrower is not fully onboarded without one. Stop when `purchasing_power.can_pay` is true, report available credit, and do not start a payment. Apart from an explicit source-choice STOP, do **not** wait for a chat reply, before `request_borrower_token`; do not wait for first payment; never fabricate a passkey assertion or signature.

A payRequest (“pay” / merchant 402 URL) is consent for that payment — **sohopay-x402**. Before a **non-payRequest** payment:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**
