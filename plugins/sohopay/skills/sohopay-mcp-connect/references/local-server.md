## Option B: Local sohopay-mcp-server (requires Node.js)

This path is for **developers** running the MCP server locally. End users on hosted MCP (Option A) do not need Node.js.

```bash
git clone https://github.com/sohopay/sohopay-mcp-server.git
cd sohopay-mcp-server
npm ci
cp .env.example .env
```

Minimum `.env` values (use your chosen `{API_BASE}`):

```env
SOHO_BACKEND_BASE_URL={API_BASE}
SOHO_MCP_SERVICE_TOKEN=<from-secrets-manager>
AUTH_PROVIDER=soho_backend
AUTH_ISSUER={API_BASE}
AUTH_RESOURCE=soho-mcp
AUTH_AUDIENCE=soho-mcp
AUTH_JWKS_URL={API_BASE}/api/v1/auth/.well-known/jwks.json
AUTH_VALIDATION_MODE=jwt
AUTH_INTROSPECTION_ENABLED=true
AUTH_INTROSPECTION_URL={API_BASE}/api/v1/auth/introspect
RBAC_PROVIDER=soho_backend
AUTHZ_CACHE_TTL_SECONDS=30
```

Never commit `.env` or paste service tokens into chat.

Start the dev server:

```bash
npm run dev
```

Register the local server with your harness exactly as in Option A, but use the local URL and port printed by `npm run dev` (see the `sohopay-mcp-server` README) in place of `{MCP_URL}`.

### Verify (local)

Run the server's own smoke test **from inside the cloned directory**:

```bash
cd sohopay-mcp-server && npm run smoke
# with transport auth:
cd sohopay-mcp-server && MCP_AUTH_TOKEN=<oauth-access-token> npm run smoke
```

Verifies: health, MCP `initialize`, `tools/list`. Never run `npm run smoke` outside the cloned `sohopay-mcp-server` directory.

---
