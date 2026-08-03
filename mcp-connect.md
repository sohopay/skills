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

Server URL: `https://mcp.sohopay.xyz` (canonical hosted MCP endpoint)

The hosted server implements the MCP OAuth 2.1 authorization spec: it advertises
protected-resource metadata at `/.well-known/oauth-protected-resource`, so your
harness discovers the authorization server, runs the OAuth 2.1 + PKCE flow, and
opens a **consent/approval page** in your browser. You approve there; the harness
stores and refreshes the token itself. You never paste a token on this path.

> The consent page is where the human authorizes the agent — it is the borrower
> approval step, not a developer credential. Approve only the scopes you intend to grant.

### Register per harness (OAuth — primary)

<!-- Claude Code / Cursor / Codex OAuth verified 2026-08-02; Hermes + ChatGPT verified 2026-08-03 — all against vendor docs. ChatGPT connector UI labels shift between releases. -->

**Claude Code** — register with no auth header, then authorize:

```bash
# Idempotent check:
claude mcp get sohopay || claude mcp list

# Add without a header so OAuth discovery engages:
claude mcp add sohopay --transport http https://mcp.sohopay.xyz

# Authorize: run /mcp inside Claude Code and pick "Authenticate" (opens your browser),
# or from a shell:
claude mcp login sohopay
```

Do **not** add `--header "Authorization: ..."` here — if the server rejects a
supplied header, Claude Code marks the connection failed instead of falling back to OAuth.

**Cursor** — edit `~/.cursor/mcp.json` and add under `mcpServers` (create the file if absent), with **no** `headers`:

```json
{
  "mcpServers": {
    "sohopay": {
      "url": "https://mcp.sohopay.xyz"
    }
  }
}
```

Cursor reads the server's protected-resource metadata and shows a "Needs Login"
prompt; approve in the browser to complete the OAuth 2.1 + PKCE flow. No
`type`/`transport` field is needed.

**Codex** — edit `~/.codex/config.toml` and add, then log in:

```toml
[mcp_servers.sohopay]
url = "https://mcp.sohopay.xyz"
auth = "oauth"
```

```bash
codex mcp login sohopay
```

`auth = "oauth"` is the default; `codex mcp login` binds an ephemeral local callback
port and opens the consent page in your browser.

**Hermes** — edit `~/.hermes/config.yaml` and add under the top-level `mcp_servers:` key, then log in:

```yaml
mcp_servers:
  sohopay:
    url: "https://mcp.sohopay.xyz"
    auth: oauth
```

```bash
hermes mcp login sohopay
```

Or add it in one step with `hermes mcp add sohopay --url https://mcp.sohopay.xyz --auth oauth`. On first connect Hermes opens a browser for approval and caches the token under `~/.hermes/mcp-tokens/`.

**ChatGPT (desktop / web app)** — configured in ChatGPT's own settings, not a CLI or config file. Requires a **paid plan** (Plus, Pro, Business, Enterprise, or Edu) with **Developer Mode** enabled; not available on Free or mobile.

1. Enable **Developer Mode** (Settings → Apps/Connectors → Advanced settings). On Business/Enterprise workspaces an admin must first allow custom connectors in workspace settings.
2. Open **Settings → Connectors → Create** and set:
   - **Name:** `SohoPay`
   - **MCP server URL:** `https://mcp.sohopay.xyz`
   - **Authentication:** `OAuth`
3. On first use ChatGPT opens a browser consent page — approve it to complete the OAuth flow. Select the connector from the chat's tools menu to use its tools.

ChatGPT connectors are **remote-only** (no local `sohopay-mcp-server`) and support **OAuth or no-auth only** — there is no static-header option, so the headless token fallback below does not apply to ChatGPT. Menu labels shift between ChatGPT releases; if a path differs, look for "Connectors" / "Developer Mode" under **Settings**.

### Headless / CI fallback (no browser)

Interactive OAuth needs a browser to render the consent page. In headless or CI
environments — or Claude Code non-interactive runs (`claude -p`, Agent SDK) where the
`/mcp` panel is unavailable — use a **pre-issued** token instead. Obtain it out of
band and export it; never write it to a file:

```bash
export SOHO_TOKEN=<oauth-access-token>
```

> **STOP — ask the operator and wait. Do not fabricate keys, tokens, or signatures.**
> Obtaining `SOHO_TOKEN` is an operator action.

Then register with the token as a bearer header. Use exactly one path — token OR OAuth, never both:

- **Claude Code:** `claude mcp add sohopay --transport http https://mcp.sohopay.xyz --header "Authorization: Bearer $SOHO_TOKEN"`
- **Cursor** (`~/.cursor/mcp.json`): `"headers": { "Authorization": "Bearer ${env:SOHO_TOKEN}" }` — keep the `${env:NAME}` form; a bare `${SOHO_TOKEN}` is sent literally.
- **Codex** (`~/.codex/config.toml`): add `bearer_token_env_var = "SOHO_TOKEN"` (Codex has no generic `headers` field; it sends `Authorization: Bearer <token>`).
- **Hermes** (`~/.hermes/config.yaml`, under `mcp_servers:`): a `headers` mapping with `Authorization: "Bearer ${SOHO_TOKEN}"`. Hermes resolves the bare `${SOHO_TOKEN}` form from `~/.hermes/.env` or your shell — correct for Hermes (unlike Cursor, which needs `${env:...}`).

For Claude Code non-interactive specifically, you can instead authenticate once from an
interactive session (`/mcp` or `claude mcp login sohopay`); the stored token is reused
by later `claude -p` / Agent SDK runs.

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

1. Your harness obtains an OAuth access token via the consent flow above (issuer
   discovered from the server's protected-resource metadata; `https://api.sohopay.xyz`).
   On the headless fallback, this is the pre-issued `SOHO_TOKEN`.
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
