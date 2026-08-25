<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: Connect to SohoPay MCP Server (Staging)

**Environment: STAGING — for internal developers testing the full staging stack.** Register the harness against staging hosts only. Do not use production `https://mcp.sohopay.xyz` or `https://api.sohopay.xyz` on this path. Use harness server id `sohopay-staging` so a production `sohopay` entry is not overwritten.

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**What this skill does:** registers the SohoPay MCP server with your agent harness and verifies the connection. **Before running it:** you have completed environment detection and prerequisites in `setup-staging.md`.

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

- **Option A — Hosted staging MCP** (recommended for full staging E2E; **no Node.js on your machine**): point your harness at the staging server URL.
- **Option B — Local MCP** (developers only; **requires Node.js**): clone and run `sohopay-mcp-server` yourself against the staging backend.

Each option has its own registration and verification below.

---

## Option A: Hosted staging MCP

Origin: `https://staging.mcp.sohopay.xyz`. **Register this MCP HTTP URL:** `https://staging.mcp.sohopay.xyz/mcp` (OAuth protected-resource `resource`; distinct from Claude Code’s `/mcp` UI panel). Health and well-known stay on the origin (`/health`, `/.well-known/oauth-protected-resource`).

The hosted server implements the MCP OAuth 2.1 authorization spec: it advertises
protected-resource metadata at `/.well-known/oauth-protected-resource` on the MCP
origin (`https://staging.mcp.sohopay.xyz`), so your harness discovers the
authorization server, runs the OAuth 2.1 + PKCE flow, and opens a
**consent/approval page** in your browser. You approve there; the harness stores
and refreshes the token itself. You never paste a token on this path.

> The consent page is where the human authorizes the agent — it is the borrower
> approval step, not a developer credential. Approve only the scopes you intend to grant.

### Register per harness (OAuth — primary)

<!-- Claude Code / Cursor / Codex OAuth verified 2026-08-02; Hermes + ChatGPT verified 2026-08-03 — all against vendor docs. ChatGPT connector UI labels shift between releases. -->

**Claude Code** — register with no auth header, then authorize:

```bash
# Idempotent check:
claude mcp get sohopay-staging || claude mcp list

# Add without a header so OAuth discovery engages:
claude mcp add sohopay-staging --transport http https://staging.mcp.sohopay.xyz/mcp

# Authorize: run /mcp inside Claude Code and pick "Authenticate" (opens your browser),
# or from a shell:
claude mcp login sohopay-staging
```

Do **not** add `--header "Authorization: ..."` here — if the server rejects a
supplied header, Claude Code marks the connection failed instead of falling back to OAuth.

**Cursor** — edit `~/.cursor/mcp.json` and add under `mcpServers` (create the file if absent), with **no** `headers`:

```json
{
  "mcpServers": {
    "sohopay-staging": {
      "url": "https://staging.mcp.sohopay.xyz/mcp"
    }
  }
}
```

Cursor reads the server's protected-resource metadata and shows a "Needs Login"
prompt; approve in the browser to complete the OAuth 2.1 + PKCE flow. No
`type`/`transport` field is needed.

**Codex** — edit `~/.codex/config.toml` and add, then log in:

```toml
[mcp_servers.sohopay-staging]
url = "https://staging.mcp.sohopay.xyz/mcp"
auth = "oauth"
```

```bash
codex mcp login sohopay-staging
```

`auth = "oauth"` is the default; `codex mcp login` binds an ephemeral local callback
port and opens the consent page in your browser.

**Hermes** — edit `~/.hermes/config.yaml` and add under the top-level `mcp_servers:` key, then log in:

```yaml
mcp_servers:
  sohopay-staging:
    url: "https://staging.mcp.sohopay.xyz/mcp"
    auth: oauth
```

```bash
hermes mcp login sohopay-staging
```

Or add it in one step with `hermes mcp add sohopay-staging --url https://staging.mcp.sohopay.xyz/mcp --auth oauth`. On first connect Hermes opens a browser for approval and caches the token under `~/.hermes/mcp-tokens/`.

**ChatGPT** — configured in ChatGPT's own settings, not a CLI or config file. **Creating** a connector is **web-only** (do it at `https://chatgpt.com`); once created, your ChatGPT **desktop app uses it** too. Requires a **paid plan** (Plus, Pro, Business, Enterprise, or Edu) with **Developer Mode**; not available on Free.

1. At `https://chatgpt.com`, enable **Developer Mode**. As of 2026-08 it is under Settings → Apps/Connectors → Advanced settings, but ChatGPT's menu labels shift between releases — if the path differs, look for "Developer Mode" / "Connectors" under **Settings**. On Business/Enterprise workspaces an admin must first allow custom connectors in workspace settings.
2. Open **Settings → Connectors → Create** and set:
   - **Name:** `SohoPay Staging`
   - **MCP server URL:** `https://staging.mcp.sohopay.xyz/mcp`
   - **Authentication:** `OAuth`
3. On first use ChatGPT opens a browser consent page — approve it to complete the OAuth flow. Then select the connector from the chat's tools menu (web or desktop app) to use its tools.

ChatGPT connectors are **remote-only** (no local `sohopay-mcp-server`) and support **OAuth or no-auth only** — there is no static-header option, so the headless token fallback below does not apply to ChatGPT.

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

- **Claude Code:** `claude mcp add sohopay-staging --transport http https://staging.mcp.sohopay.xyz/mcp --header "Authorization: Bearer $SOHO_TOKEN"`
- **Cursor** (`~/.cursor/mcp.json`): `"headers": { "Authorization": "Bearer ${env:SOHO_TOKEN}" }` — keep the `${env:NAME}` form; a bare `${SOHO_TOKEN}` is sent literally.
- **Codex** (`~/.codex/config.toml`): add `bearer_token_env_var = "SOHO_TOKEN"` (Codex has no generic `headers` field; it sends `Authorization: Bearer <token>`).
- **Hermes** (`~/.hermes/config.yaml`, under `mcp_servers:`): a `headers` mapping with `Authorization: "Bearer ${SOHO_TOKEN}"`. Hermes resolves the bare `${SOHO_TOKEN}` form from `~/.hermes/.env` or your shell — correct for Hermes (unlike Cursor, which needs `${env:...}`).

For Claude Code non-interactive specifically, you can instead authenticate once from an
interactive session (`/mcp` or `claude mcp login sohopay-staging`); the stored token is reused
by later `claude -p` / Agent SDK runs.

### Verify (hosted)

```bash
curl -fsSL https://staging.mcp.sohopay.xyz/health
# Expected: { "ok": true }
```

Then confirm authenticated access with a **read-only** MCP tool call (e.g. `get_borrower_status`). An unauthenticated `tools/list` must return `401` with `WWW-Authenticate: Bearer`.

After connect: read MCP tool descriptions (and initialize `instructions` if present) for call-time rules. For multi-step onboarding, spend/pay, or x402, fetch the matching skill from `{SKILLS_BASE}` (network is normal; local sticky copy if present) — start with `{SKILLS_BASE}/borrower-onboard.md` or `{SKILLS_BASE}/spend-and-pay.md`.

OAuth protected-resource metadata:

```bash
curl -fsSL https://staging.mcp.sohopay.xyz/.well-known/oauth-protected-resource
```

---

## Option B: Local sohopay-mcp-server (requires Node.js)

This path is for **developers** running the MCP server locally. End users on hosted staging MCP (Option A) do not need Node.js.

```bash
git clone https://github.com/sohopay/sohopay-mcp-server.git
cd sohopay-mcp-server
npm ci
cp .env.example .env
```

Minimum `.env` values (staging backend):

```env
SOHO_BACKEND_BASE_URL=https://staging.api.sohopay.xyz
SOHO_MCP_SERVICE_TOKEN=<from-secrets-manager>
AUTH_PROVIDER=soho_backend
AUTH_ISSUER=https://staging.api.sohopay.xyz
AUTH_RESOURCE=soho-mcp
AUTH_AUDIENCE=soho-mcp
AUTH_JWKS_URL=https://staging.api.sohopay.xyz/api/v1/auth/.well-known/jwks.json
AUTH_VALIDATION_MODE=jwt
AUTH_INTROSPECTION_ENABLED=true
AUTH_INTROSPECTION_URL=https://staging.api.sohopay.xyz/api/v1/auth/introspect
RBAC_PROVIDER=soho_backend
AUTHZ_CACHE_TTL_SECONDS=30
```

Never commit `.env` or paste service tokens into chat.

Start the dev server:

```bash
npm run dev
```

Register the local server with your harness exactly as in Option A, but use the local MCP HTTP URL printed by `npm run dev` (see the `sohopay-mcp-server` README) in place of `https://staging.mcp.sohopay.xyz/mcp`.

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
   discovered from the server's protected-resource metadata; `https://staging.api.sohopay.xyz`).
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
- Back to staging setup: `curl -fsSL {SKILLS_BASE}/setup-staging.md`
- Production connect (do not mix): `curl -fsSL {SKILLS_BASE}/mcp-connect.md`
