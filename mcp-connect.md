<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: Connect to SohoPay MCP Server

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**What this skill does:** registers the SohoPay MCP server with your agent harness and verifies the connection. **Before running it:** you have completed environment detection and prerequisites in `setup.md`.

## Choose environment

Pick **one** row. Substitute `{API_BASE}`, `{MCP_URL}`, `{MCP_ORIGIN}`, and `{MCP_SERVER_ID}` everywhere below. Do not mix production and staging hosts.

| Environment | `{API_BASE}` | `{MCP_URL}` (register this) | `{MCP_ORIGIN}` (health / OAuth PRM) | `{MCP_SERVER_ID}` |
|-------------|--------------|-----------------------------|-------------------------------------|-------------------|
| **Production** (default) | `https://api.sohopay.xyz` | `https://mcp.sohopay.xyz` | `https://mcp.sohopay.xyz` | `sohopay` |
| **Staging** (internal E2E) | `https://staging.api.sohopay.xyz` | `https://staging.mcp.sohopay.xyz/mcp` | `https://staging.mcp.sohopay.xyz` | `sohopay-staging` |

For staging, you may start from `{SKILLS_BASE}/mcp-connect-staging.md` — it pins the staging row and chains here.

CRITICAL: MCP is the **interface layer**. SohoPay Backend is the **source of truth**. Policy Engine is the decision authority. MCP tools never move money directly. Catalog **v2** exposes **19 tools** (including `whoami`).

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

Note to the agent: registering an MCP server writes to your harness config. Request permission normally. If denied, stop and explain what was blocked and why. Never turn off permission prompts or run in a bypass mode.

## Architecture

```text
MCP Client / AI Agent
        ↓
SOHO MCP Server (sohopay-mcp-server)  — HTTP stream at /mcp
        ↓  x-soho-service-token + x-soho-* identity headers
SOHO Backend API (sohopay-backend /api/v1/*)
        ↓
Auth + Policy + Settlement
```

## Choose a path

- **Option A — Hosted MCP** (recommended; **no Node.js on your machine**): point your harness at `{MCP_URL}`.
- **Option B — Local MCP** (developers only; **requires Node.js**): clone and run `sohopay-mcp-server` yourself against `{API_BASE}`.

Each option has its own registration and verification below.

---

## Option A: Hosted MCP

Server URL: `{MCP_URL}` (canonical hosted MCP resource URL for your environment)

The hosted server implements the MCP OAuth 2.1 authorization spec: it advertises
protected-resource metadata at `{MCP_ORIGIN}/.well-known/oauth-protected-resource`, so your
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
claude mcp get {MCP_SERVER_ID} || claude mcp list

# Add without a header so OAuth discovery engages:
claude mcp add {MCP_SERVER_ID} --transport http {MCP_URL}

# Authorize: run /mcp inside Claude Code and pick "Authenticate" (opens your browser),
# or from a shell:
claude mcp login {MCP_SERVER_ID}
```

Do **not** add `--header "Authorization: ..."` here — if the server rejects a
supplied header, Claude Code marks the connection failed instead of falling back to OAuth.

**Cursor** — edit `~/.cursor/mcp.json` and add under `mcpServers` (create the file if absent), with **no** `headers`:

```json
{
  "mcpServers": {
    "{MCP_SERVER_ID}": {
      "url": "{MCP_URL}"
    }
  }
}
```

Cursor reads the server's protected-resource metadata and shows a "Needs Login"
prompt; approve in the browser to complete the OAuth 2.1 + PKCE flow. No
`type`/`transport` field is needed.

**Important for Cursor (and ChatGPT):** write tools require an `idempotency_key` **tool argument** (UUID v4) because these harnesses cannot set custom HTTP headers. See `{SKILLS_BASE}/idempotency.md`.

**Codex** — edit `~/.codex/config.toml` and add, then log in:

```toml
[mcp_servers.{MCP_SERVER_ID}]
url = "{MCP_URL}"
auth = "oauth"
```

```bash
codex mcp login {MCP_SERVER_ID}
```

`auth = "oauth"` is the default; `codex mcp login` binds an ephemeral local callback
port and opens the consent page in your browser.

**Hermes** — edit `~/.hermes/config.yaml` and add under the top-level `mcp_servers:` key, then log in:

```yaml
mcp_servers:
  {MCP_SERVER_ID}:
    url: "{MCP_URL}"
    auth: oauth
```

```bash
hermes mcp login {MCP_SERVER_ID}
```

Or add it in one step with `hermes mcp add {MCP_SERVER_ID} --url {MCP_URL} --auth oauth`. On first connect Hermes opens a browser for approval and caches the token under `~/.hermes/mcp-tokens/`.

**ChatGPT** — configured in ChatGPT's own settings, not a CLI or config file. **Creating** a connector is **web-only** (do it at `https://chatgpt.com`); once created, your ChatGPT **desktop app uses it** too. Requires a **paid plan** (Plus, Pro, Business, Enterprise, or Edu) with **Developer Mode**; not available on Free.

1. At `https://chatgpt.com`, enable **Developer Mode**. As of 2026-08 it is under Settings → Apps/Connectors → Advanced settings, but ChatGPT's menu labels shift between releases — if the path differs, look for "Developer Mode" / "Connectors" under **Settings**. On Business/Enterprise workspaces an admin must first allow custom connectors in workspace settings.
2. Open **Settings → Connectors → Create** and set:
   - **Name:** `SohoPay` (production) or `SohoPay Staging` (staging)
   - **MCP server URL:** `{MCP_URL}`
   - **Authentication:** `OAuth`
3. On first use ChatGPT opens a browser consent page — approve it to complete the OAuth flow. Then select the connector from the chat's tools menu (web or desktop app) to use its tools.

ChatGPT connectors are **remote-only** (no local `sohopay-mcp-server`) and support **OAuth or no-auth only** — there is no static-header option, so the headless token fallback below does not apply to ChatGPT. Pass `idempotency_key` in tool arguments on every write.

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

- **Claude Code:** `claude mcp add {MCP_SERVER_ID} --transport http {MCP_URL} --header "Authorization: Bearer $SOHO_TOKEN"`
- **Cursor** (`~/.cursor/mcp.json`): `"headers": { "Authorization": "Bearer ${env:SOHO_TOKEN}" }` — keep the `${env:NAME}` form; a bare `${SOHO_TOKEN}` is sent literally.
- **Codex** (`~/.codex/config.toml`): add `bearer_token_env_var = "SOHO_TOKEN"` (Codex has no generic `headers` field; it sends `Authorization: Bearer <token>`).
- **Hermes** (`~/.hermes/config.yaml`, under `mcp_servers:`): a `headers` mapping with `Authorization: "Bearer ${SOHO_TOKEN}"`. Hermes resolves the bare `${SOHO_TOKEN}` form from `~/.hermes/.env` or your shell — correct for Hermes (unlike Cursor, which needs `${env:...}`).

For Claude Code non-interactive specifically, you can instead authenticate once from an
interactive session (`/mcp` or `claude mcp login {MCP_SERVER_ID}`); the stored token is reused
by later `claude -p` / Agent SDK runs.

### Verify (hosted)

```bash
curl -fsSL {MCP_ORIGIN}/health
# Expected: JSON health payload (ok / healthy)
```

Then confirm authenticated access with a **read-only** MCP tool call (e.g. `whoami` or `get_borrower_status`). An unauthenticated `tools/list` must return `401` with `WWW-Authenticate: Bearer`.

OAuth protected-resource metadata:

```bash
curl -fsSL {MCP_ORIGIN}/.well-known/oauth-protected-resource
```

---

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

## MCP session bootstrap (both options)

1. Your harness obtains an OAuth access token via the consent flow above (issuer
   discovered from the server's protected-resource metadata; typically `{API_BASE}`).
   On the headless fallback, this is the pre-issued `SOHO_TOKEN`.
2. `POST` to the MCP resource path with `Authorization: Bearer <token>` and `initialize`.
3. Capture the `Mcp-Session-Id` response header — this is the **MCP transport** session.
4. Use that session ID for `tools/list` and tool calls.

**Do not confuse** `Mcp-Session-Id` (MCP transport) with SohoPay's delegated agent session (`x-session-id` header or `session_id` tool argument). See `{SKILLS_BASE}/agent-session.md`.

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
| `x-session-id` | Delegated SohoPay session (when using agent delegation) |
| `Idempotency-Key` / `x-idempotency-key` | Write tools (or tool arg `idempotency_key`) |

Backend trusts `x-soho-*` headers **only** when the service token is valid.

## Next steps

- Onboard borrower: `curl -fsSL {SKILLS_BASE}/borrower-onboard.md`
- Back to setup: `curl -fsSL {SKILLS_BASE}/setup.md`
