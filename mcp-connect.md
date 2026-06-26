# Skill: Connect to SohoPay MCP Server

CRITICAL: MCP is the **interface layer**. SohoPay Backend is the **source of truth**. Policy Engine is the decision authority. MCP tools never move money directly.

## Architecture

```text
MCP Client / AI Agent
        ↓
SOHO MCP Server (soho-mcp-server)
        ↓  x-soho-service-token + x-soho-* identity headers
SOHO Backend API (sohopay-backend /api/v1/*)
        ↓
Auth + Policy + Settlement
```

## Option A: Local soho-mcp-server

```bash
git clone https://github.com/sohopay/soho-mcp-server.git
cd soho-mcp-server
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

Start dev server:

```bash
npm run dev
```

## Option B: Hosted MCP

When deployed, point MCP clients at `https://mcp.sohopay.xyz`. Transport requires OAuth 2.1 bearer tokens per MCP spec.

## Verify health

```bash
curl -sS https://mcp.sohopay.xyz/health
```

For local development, use the health URL and port documented in the soho-mcp-server README after `npm run dev`.

Expected: `{ "ok": true }`

## OAuth protected resource metadata

```bash
curl -sS https://mcp.sohopay.xyz/.well-known/oauth-protected-resource
```

## MCP session bootstrap

1. Obtain OAuth access token from SohoPay Backend auth (issuer `https://api.sohopay.xyz`).
2. `POST /mcp` with `Authorization: Bearer <token>` and `initialize`.
3. Capture `Mcp-Session-Id` response header.
4. Use session ID for `tools/list` and tool calls.

Unauthenticated `tools/list` must return `401` with `WWW-Authenticate: Bearer`.

## Smoke test

```bash
npm run smoke
# with auth:
MCP_AUTH_TOKEN=<oauth-access-token> npm run smoke
```

Verifies: health, MCP initialize, tools/list.

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

- Onboard borrower: `curl -sL https://agents.sohopay.xyz/skills/borrower-onboard.md`
- Back to setup: `curl -sL https://agents.sohopay.xyz/skills/setup.md`
