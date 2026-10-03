---
name: sohopay-setup-staging
description: >
  Pin staging.api / staging.mcp and chain to canonical setup. Use when the operator asks for staging SohoPay setup or Set up https://staging.sohopay.xyz/install — not for production.
license: Apache-2.0
metadata:
  hosted_name: setup-staging
  title: SohoPay Agent Setup (Staging)
  version: "1.0"
---

**Environment: STAGING.** Do not register production MCP (`https://mcp.sohopay.xyz`) or mix production tokens with this path.

| | Staging |
|--|---------|
| API | `https://staging.api.sohopay.xyz` |
| MCP register | `https://staging.mcp.sohopay.xyz/mcp` |
| MCP origin | `https://staging.mcp.sohopay.xyz` |
| Server id | `sohopay-staging` |
| Paste | `Set up https://staging.sohopay.xyz/install` |

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

Now run the **sohopay-setup** (`{SKILL:sohopay-setup}`) checklist (Steps 1–6) using the staging row above for every host — never the production hosts in its examples — and do not re-follow its "for staging, load sohopay-setup-staging" redirect: you are already on the staging path. Connect via **sohopay-mcp-connect-staging** (`{SKILL:sohopay-mcp-connect-staging}`) or the staging row in **sohopay-mcp-connect**.

Onboarding finishes in one turn on these staging hosts. Do **not** ask the operator, and do **not** wait for a chat reply, before `request_borrower_token` or before `authorize_agent`.
