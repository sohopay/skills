<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1
     SKILLS_HOST (CDN origin): https://agents.sohopay.xyz
     Fetch order: local sticky → {SKILLS_BASE} → GitHub raw last-resort.
     Publish rewrites SKILLS_BASE to Prod and {SKILLS_HOST} to the origin. -->
<!-- Generated from plugins/sohopay/skills — do not hand-edit this file. Run npm run generate:hosted -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: Connect to SohoPay MCP Server

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

Execute the hosted path. Do not plan. Local MCP setup is currently not available.

**Before running it:** environment detection in **sohopay-setup**.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

| Environment | `{API_BASE}` | `{MCP_URL}` | `{MCP_ORIGIN}` | `{MCP_SERVER_ID}` |
|-------------|--------------|-------------|----------------|-------------------|
| **Production** | `https://api.sohopay.xyz` | `https://mcp.sohopay.xyz` | `https://mcp.sohopay.xyz` | `sohopay` |
| **Staging** | `https://staging.api.sohopay.xyz` | `https://staging.mcp.sohopay.xyz/mcp` | `https://staging.mcp.sohopay.xyz` | `sohopay-staging` |

Do not mix production and staging hosts. Staging stub: `{SKILLS_BASE}/mcp-connect-staging.md`.

MCP never moves money. Read live `tools/list`. Cursor/ChatGPT: pass `idempotency_key` on writes — `{SKILLS_BASE}/idempotency.md`.

- **Hosted (the only available path, no Node):** per-harness OAuth — [references/harnesses.md](#hosted-reference-harnesses)
- **Local MCP** is currently not available. Do not clone or run `sohopay-mcp-server`. A 404 from that private repo is expected and is not a failed check. Details: [references/local-server.md](#hosted-reference-local-server)

Smoke: `curl -fsSL {MCP_ORIGIN}/health` then a read-only MCP tool (`whoami` or `get_borrower_status`). Unauthenticated `tools/list` must be `401` + `WWW-Authenticate: Bearer`.

`Mcp-Session-Id` is MCP transport, not SohoPay `session_id`.

Next: **sohopay-human-direct** (`{SKILLS_BASE}/human-direct-flow.md`) or **sohopay-onboard** (`{SKILLS_BASE}/borrower-onboard.md`).

---

## Hosted references (load only when the skill says to)

Native Agent Skills read these from `references/` on demand. This hosted export inlines them so `curl -fsSL` bootstrap still works.

<a id="hosted-reference-harnesses"></a>

### Hosted reference: harnesses.md

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

After connect: read MCP tool descriptions (and initialize `instructions` if present) for call-time rules. For multi-step onboarding, spend/pay, or x402, fetch the matching skill from `{SKILLS_BASE}` (network is normal; local sticky copy if present) — start with `{SKILLS_BASE}/borrower-onboard.md` or `{SKILLS_BASE}/spend-and-pay.md`.

OAuth protected-resource metadata:

```bash
curl -fsSL {MCP_ORIGIN}/.well-known/oauth-protected-resource
```

---


<a id="hosted-reference-local-server"></a>

### Hosted reference: local-server.md

## Option B: Local sohopay-mcp-server (currently unavailable)

**Local MCP setup is currently not available.** Do not clone, install, or run `sohopay-mcp-server`. A 404 from https://github.com/sohopay/sohopay-mcp-server is expected and is **not** a failed check. Register only the hosted remote URL `{MCP_URL}`.

