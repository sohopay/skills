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

Execute **sohopay-setup** (`{SKILL:sohopay-setup}`) with the staging row pinned. Connect via **sohopay-mcp-connect-staging** (`{SKILL:sohopay-mcp-connect-staging}`) or the staging row in **sohopay-mcp-connect**.
