---
name: sohopay-mcp-connect
description: >
  Register hosted SohoPay MCP and complete OAuth. Use when connecting MCP, OAuth, or tools/list after setup — not for onboarding or payments.
license: Apache-2.0
metadata:
  hosted_name: mcp-connect
  title: Connect to SohoPay MCP Server
  version: "1.0"
---

Execute the hosted path. Do not plan. Local MCP setup is currently not available.

**Before running it:** environment detection in **sohopay-setup**.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

| Environment | `{API_BASE}` | `{MCP_URL}` | `{MCP_ORIGIN}` | `{MCP_SERVER_ID}` |
|-------------|--------------|-------------|----------------|-------------------|
| **Production** | `https://api.sohopay.xyz` | `https://mcp.sohopay.xyz` | `https://mcp.sohopay.xyz` | `sohopay` |
| **Staging** | `https://staging.api.sohopay.xyz` | `https://staging.mcp.sohopay.xyz/mcp` | `https://staging.mcp.sohopay.xyz` | `sohopay-staging` |

Do not mix production and staging hosts. Staging stub: `{SKILL:sohopay-mcp-connect-staging}`.

MCP never moves money. Read live `tools/list`. Cursor/ChatGPT: pass `idempotency_key` on writes — `{SKILL:sohopay-idempotency}`.

- **Hosted (the only available path, no Node):** per-harness OAuth — [references/harnesses.md](references/harnesses.md)
- **Local MCP** is currently not available. Do not clone or run `sohopay-mcp-server`. A 404 from that private repo is expected and is not a failed check. Details: [references/local-server.md](references/local-server.md)

Smoke: `curl -fsSL {MCP_ORIGIN}/health` then a read-only MCP tool (`whoami` or `get_borrower_status`). Unauthenticated `tools/list` must be `401` + `WWW-Authenticate: Bearer`.

`Mcp-Session-Id` is MCP transport, not SohoPay `session_id`.

Next: **sohopay-human-direct** (`{SKILL:sohopay-human-direct}`) or **sohopay-onboard** (`{SKILL:sohopay-onboard}`).
