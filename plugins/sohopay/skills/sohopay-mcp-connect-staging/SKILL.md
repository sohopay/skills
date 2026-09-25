---
name: sohopay-mcp-connect-staging
description: >
  Register sohopay-staging at staging.mcp.sohopay.xyz/mcp. Use when connecting staging MCP — not production.
license: Apache-2.0
metadata:
  hosted_name: mcp-connect-staging
  title: Connect to SohoPay MCP Server (Staging)
  version: "1.0"
---

**Environment: STAGING.** Server id `sohopay-staging`. Register `https://staging.mcp.sohopay.xyz/mcp`. Origin `https://staging.mcp.sohopay.xyz`. API `https://staging.api.sohopay.xyz`. Do not overwrite a production `sohopay` entry.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

Follow **sohopay-mcp-connect** (`{SKILL:sohopay-mcp-connect}`) with the staging row pinned. Harness menus: that skill’s `references/harnesses.md`.
