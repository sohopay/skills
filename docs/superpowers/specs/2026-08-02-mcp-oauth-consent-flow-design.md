# Design: OAuth 2.1 consent flow as the primary MCP auth path

**Date:** 2026-08-02
**Status:** Approved (design) — pending implementation plan
**Scope:** Documentation + `install.sh` in `sohopay/skills`. No backend/server work.

## Problem

The hosted-MCP registration instructions tell the operator to manually obtain an
OAuth access token, `export SOHO_TOKEN=<oauth-access-token>`, and paste it into an
`Authorization: Bearer` header for every harness. This is at odds with how the MCP
authorization spec is meant to work: the server already advertises OAuth
protected-resource metadata (`/.well-known/oauth-protected-resource`), so a
compliant harness can discover the authorization server, run the OAuth 2.1 + PKCE
flow itself, present a **consent/approval page** in the browser, and store/refresh
the token without the operator ever handling it.

The manual-header path also actively breaks the OAuth flow in at least one harness
(see Constraint below), so the two cannot simply coexist in the same registration
call — the primary path must register with **no auth header at all**.

The SohoPay MCP server (`mcp.sohopay.xyz`) **already implements** the full
client-driven flow (authorization-server metadata, dynamic client registration,
consent/approval page, PKCE token endpoint). This change is therefore purely a
docs + install-script rewrite to leverage what the server already exposes.

## Goals

1. Make the browser-based OAuth **consent/approval flow the primary, documented
   path** for registering the hosted MCP server across Claude Code, Cursor, and Codex.
2. Register with **no static `Authorization` header** on the primary path, so
   harness OAuth discovery engages.
3. Keep a **clearly-labeled headless/CI fallback** using a pre-issued `SOHO_TOKEN`
   bearer header, for environments with no browser to render a consent page.
4. Keep all changes accurate and verifiable against current harness docs.

## Non-goals

- No backend or MCP-server implementation work — the server already supports OAuth.
- Option B (local `sohopay-mcp-server`) keeps its static `MCP_AUTH_TOKEN` smoke-test
  path; it is a dev tool, not the hosted consent flow.
- Hermes OAuth behavior is **not** verified; Hermes keeps the manual-token block and
  remains a `TODO(confirm)`.

## Key constraint (drives the design)

Claude Code's MCP docs state: **if `headers.Authorization` is configured and the
server rejects that header, Claude Code reports the connection as `failed` and does
NOT fall back to OAuth.** Therefore the OAuth path and the manual-header path are
mutually exclusive within a single registration. The primary (OAuth) registration
must set **no** auth header; the fallback is a separate, explicit token-bearing
registration.

Corollary (Claude Code): in non-interactive mode (`claude -p`, Agent SDK) there is
no `/mcp` panel, so the OAuth browser flow cannot run there. The operator must
authenticate once from an interactive session (`/mcp` or `claude mcp login <name>`)
before non-interactive runs, OR use the headless token fallback.

## Verified per-harness behavior

All verified against official docs on 2026-08-02.

| Harness | Primary (OAuth) registration | Consent trigger | Source |
|---|---|---|---|
| **Claude Code** | `claude mcp add --transport http sohopay https://mcp.sohopay.xyz` — no `--header` | `/mcp` → Authenticate (opens browser); or `claude mcp login sohopay` | code.claude.com/docs/en/mcp |
| **Cursor** | `~/.cursor/mcp.json`: `{ "mcpServers": { "sohopay": { "url": "https://mcp.sohopay.xyz" } } }` — no `headers` | Cursor detects protected-resource metadata → "Needs Login" → OAuth 2.1 + PKCE consent | cursor.com/docs |
| **Codex** | `~/.codex/config.toml`: `[mcp_servers.sohopay]` with `url` + `auth = "oauth"` (oauth is the default) | `codex mcp login sohopay` — binds ephemeral callback port, opens browser | developers.openai.com/codex/mcp |
| **Hermes** | unverified — keep manual-token block | unknown | TODO(confirm) |

Headless/CI fallback (unchanged form, relabeled as secondary):
- Claude Code: `claude mcp add --transport http sohopay <url> --header "Authorization: Bearer $SOHO_TOKEN"`
- Cursor: `headers: { "Authorization": "Bearer ${env:SOHO_TOKEN}" }`
- Codex: `bearer_token_env_var = "SOHO_TOKEN"`

## Changes by file

### 1. `mcp-connect.md` — Option A "Hosted MCP" (primary rewrite)

- Replace the `export SOHO_TOKEN=<oauth-access-token>` + STOP-for-token lead-in
  (lines ~43–50) with an explanation that the server advertises OAuth
  protected-resource metadata and the harness runs discovery → consent → token
  storage itself; the operator only approves in the browser. The consent/approval
  page is where the borrower authorizes the agent — consistent with SohoPay's model.
- Rewrite each harness block (Claude Code, Cursor, Codex) to the **header-less OAuth
  form** in the table above, each with its exact consent-trigger command.
- Add a **"Headless / CI fallback"** subsection retaining the current
  `SOHO_TOKEN` bearer-header snippets, scoped to no-browser environments, with the
  Claude Code non-interactive caveat spelled out.
- Update the `TODO(confirm)` comment (line ~54): Claude Code / Cursor / Codex OAuth
  now verified; Hermes still pending.
- Hermes block: unchanged (still manual token), still flagged TODO.

### 2. `mcp-connect.md` — MCP session bootstrap (lines ~175–182)

- Reframe step 1 so the OAuth access token is **obtained by the harness via the
  consent flow**, not hand-carried by the operator. Keep the `401` +
  `WWW-Authenticate: Bearer` expectation (that is what triggers discovery).

### 3. `install.sh` — register OAuth-first

- **Token is opt-in, never prompted.** The current hidden `read -rsp` prompt
  (lines ~148–153) that collects a token when `KEY` is empty must be **removed**.
  Under OAuth-first, an empty `KEY` is the normal/expected case (the harness runs
  the consent flow), so prompting would silently re-collect a token and re-attach
  the header, defeating the change. A token is used only when explicitly passed via
  `--key` or a pre-set `SOHO_TOKEN` env var.
- Claude Code branch (lines ~157–168): when `KEY` is empty (default), register with
  `claude mcp add --transport http "$MCP_URL"` and **no `--header`**, then set
  `register_note` telling the operator to run `/mcp` (or `claude mcp login sohopay`)
  to approve. Attach `--header "Authorization: Bearer ${KEY}"` **only** when a token
  was explicitly supplied — the documented headless fallback. Remove the
  `TODO(confirm): exact auth header shape` note (resolved).
- Cursor note (line ~170): header-less URL entry drives OAuth; mention the
  `${env:SOHO_TOKEN}` header only as the fallback.
- Codex note (line ~173): mention `auth = "oauth"` + `codex mcp login sohopay`.
- Hermes note (line ~177): unchanged.
- Update the top-of-file `--key` help text to state the token is an optional
  headless fallback, not the primary path.

### 4. Regeneration + validation

- `mcp-connect.md` is a hosted skill body → run `npm run generate:llms-full`.
- Run `npm run validate` (must stay green: no localhost, absolute links,
  index.json ⇄ file pairing).

## Error handling / edge cases

- **Header configured but rejected** (Claude Code): documented as a hard failure
  that does not fall back to OAuth — the fallback subsection warns to use exactly
  one path, not both.
- **No browser available**: headless/CI fallback path with pre-issued token.
- **Non-interactive Claude Code**: authenticate once interactively, or use fallback.
- **Server not advertising metadata**: out of scope — server already supports it;
  the existing "global failure rule" (STOP and report) still applies.

## Testing / verification

- `npm run validate` passes.
- `npm run generate:llms-full` regenerates `llms-full.txt` with no other diff.
- Manual doc read-through: every primary block is header-less; every fallback block
  is labeled as such; no bare `${SOHO_TOKEN}` remains on a primary path.
- Cross-check the three verified harness commands against the table above.

## Rollback

Pure docs/script change; revert the commit to restore manual-token instructions.
