<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: Connect to SohoPay MCP Server

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**What this skill does:** registers the SohoPay MCP server with your agent harness and verifies the connection. **Before running it:** you have completed environment detection and prerequisites in `setup.md`.

CRITICAL: MCP is the **interface layer**. SohoPay Backend is the **source of truth**. Policy Engine is the decision authority. MCP tools never move money directly.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

Note to the agent: registering an MCP server writes to your harness config. Request permission normally. If denied, stop and explain what was blocked and why. Never turn off permission prompts or run in a bypass mode.

## Architecture

```text
MCP Client / AI Agent
        ↓
SOHO MCP Server (sohopay-mcp-server)
        ↓  x-soho-service-token + x-soho-* identity headers
SOHO Backend API (sohopay-backend /api/v1/*)
        ↓
Auth + Policy + Settlement
```

## Choose a path

- **Option A — Hosted MCP** (recommended for most operators): point your harness at the hosted server URL.
- **Option B — Local MCP**: clone and run `sohopay-mcp-server` yourself.

Each option has its own registration and verification below.

---

## Option A: Hosted MCP

Server URL: `https://mcp.sohopay.xyz` <!-- TODO(confirm): real hosted MCP URL once deployed -->

Transport requires an OAuth 2.1 bearer token per the MCP spec. Export it (never write the token to a file):

```bash
export SOHO_TOKEN=<oauth-access-token>
```

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**
> Obtaining `SOHO_TOKEN` is an operator action.

### Register per harness

<!-- TODO(confirm): exact auth header shape, and current-version config paths/schemas for Cursor, Codex, and Hermes. -->

**Claude Code**

```bash
# Check whether it is already registered (idempotent):
claude mcp get sohopay || claude mcp list

# Add it (skip if already present):
claude mcp add sohopay --transport http https://mcp.sohopay.xyz \
  --header "Authorization: Bearer $SOHO_TOKEN"
```

**Cursor** — edit `~/.cursor/mcp.json` and add under `mcpServers` (create the file if absent):

```json
{
  "mcpServers": {
    "sohopay": {
      "url": "https://mcp.sohopay.xyz",
      "headers": { "Authorization": "Bearer ${SOHO_TOKEN}" }
    }
  }
}
```

**Codex** — edit `~/.codex/config.toml` and add:

```toml
[mcp_servers.sohopay]
url = "https://mcp.sohopay.xyz"
headers = { Authorization = "Bearer ${SOHO_TOKEN}" }
```

**Hermes** — Hermes stores its data under `~/.hermes/`. Register the MCP server with a Cursor-style JSON block (mirror the schema above):

```json
{
  "mcpServers": {
    "sohopay": {
      "url": "https://mcp.sohopay.xyz",
      "headers": { "Authorization": "Bearer ${SOHO_TOKEN}" }
    }
  }
}
```

<!-- TODO(confirm): exact Hermes MCP config file path/format (assumed ~/.hermes/mcp.json), and whether `hermes gateway setup` is the intended interactive path for adding an MCP server. -->
Write this to `~/.hermes/mcp.json`, or use the interactive `hermes gateway setup` wizard if that is the supported path.

### Verify (hosted)

```bash
curl -fsSL https://mcp.sohopay.xyz/health
# Expected: { "ok": true }
```

Then confirm authenticated access with a **read-only** MCP tool call (e.g. `get_borrower_status`). An unauthenticated `tools/list` must return `401` with `WWW-Authenticate: Bearer`.

OAuth protected-resource metadata:

```bash
curl -fsSL https://mcp.sohopay.xyz/.well-known/oauth-protected-resource
```

---

## Option B: Local sohopay-mcp-server

```bash
git clone https://github.com/sohopay/sohopay-mcp-server.git
cd sohopay-mcp-server
npm ci
cp .env.example .env
```

Minimum `.env` values (production example — adjust for staging):

```env
SOHO_BACKEND_BASE_URL=https://api.sohopay.xyz
SOHO_MCP_SERVICE_TOKEN=<from-secrets-manager>
AUTH_PROVIDER=soho_backend
AUTH_ISSUER=https://api.sohopay.xyz
AUTH_RESOURCE=soho-mcp
AUTH_AUDIENCE=soho-mcp
AUTH_JWKS_URL=https://api.sohopay.xyz/api/v1/auth/.well-known/jwks.json
AUTH_VALIDATION_MODE=jwt
AUTH_INTROSPECTION_ENABLED=true
AUTH_INTROSPECTION_URL=https://api.sohopay.xyz/api/v1/auth/introspect
RBAC_PROVIDER=soho_backend
AUTHZ_CACHE_TTL_SECONDS=30
```

Never commit `.env` or paste service tokens into chat.

Start the dev server:

```bash
npm run dev
```

Register the local server with your harness exactly as in Option A, but use the local URL and port printed by `npm run dev` (see the `sohopay-mcp-server` README) in place of `https://mcp.sohopay.xyz`.

### Verify (local)

Run the server's own smoke test **from inside the cloned directory**:

```bash
cd sohopay-mcp-server && npm run smoke
# with transport auth:
cd sohopay-mcp-server && MCP_AUTH_TOKEN=<oauth-access-token> npm run smoke
```

Verifies: health, MCP `initialize`, `tools/list`. Never run `npm run smoke` outside the cloned `sohopay-mcp-server` directory.

---

## MCP session bootstrap (both options)

1. Obtain an OAuth access token from SohoPay Backend auth (issuer `https://api.sohopay.xyz`).
2. `POST /mcp` with `Authorization: Bearer <token>` and `initialize`.
3. Capture the `Mcp-Session-Id` response header.
4. Use that session ID for `tools/list` and tool calls.

Unauthenticated `tools/list` must return `401` with `WWW-Authenticate: Bearer`.

## Backend trust contract

MCP → Backend requests carry:

| Header | Purpose |
|--------|---------|
| `x-soho-service-token` | MCP service authentication |
| `x-soho-borrower-id` | Canonical borrower UUID |
| `x-soho-principal-id` | Authenticated caller |
| `x-soho-executor-id` | Action performer |
| `x-soho-principal-type` | HUMAN \| AGENT \| BUSINESS |

Backend trusts `x-soho-*` headers **only** when the service token is valid.

## Next steps

- Onboard borrower: `curl -fsSL {SKILLS_BASE}/borrower-onboard.md`
- Back to setup: `curl -fsSL {SKILLS_BASE}/setup.md`
