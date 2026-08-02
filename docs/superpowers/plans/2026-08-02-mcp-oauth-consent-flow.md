# MCP OAuth Consent Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the browser-based OAuth 2.1 consent flow the primary, documented path for registering the hosted SohoPay MCP server, with a clearly-labeled headless/CI token fallback.

**Architecture:** Docs + installer change only; the MCP server already implements OAuth (metadata, DCR, consent page, PKCE). Rewrite `mcp-connect.md` Option A to header-less OAuth registration per harness, add a headless fallback subsection, and change `install.sh` to register OAuth-first (no token prompt, header only when a token is explicitly supplied).

**Tech Stack:** Markdown skill docs, zero-dependency Node ESM tooling (`scripts/validate-skills.mjs`, `scripts/generate-llms-full.mjs`), Bash installer. Node >=22.

## Global Constraints

- Hosted hostname is `sohopay.xyz`, never `sohopay.com`. (verbatim from spec/CLAUDE.md)
- `mcp-connect.md` is a hosted skill body → after editing it, regenerate `llms-full.txt` with `npm run generate:llms-full`; never hand-edit `llms-full.txt`.
- Validator blocks: `localhost`/`127.0.0.1`/`0.0.0.0`, secret-like patterns (`sk-…`, `AKIA…`, PEM headers, `x-soho-service-token:` values), and non-absolute Markdown links (except `github.com/sohopay`). Do not introduce any.
- No test framework exists. "Verify" means: `npm run validate` (green), `npm run generate:llms-full` (regenerates cleanly), `bash -n install.sh` (syntax), and targeted `grep` assertions on the edited files.
- There are already uncommitted edits to `mcp-connect.md` and `llms-full.txt` (prior Codex/Cursor auth-syntax fixes). Task 1 rewrites the same Option A region and **relocates** those fixes into the headless-fallback subsection; they get committed together with this task. Do not discard them.

---

### Task 1: Rewrite `mcp-connect.md` Option A to OAuth-first + headless fallback

**Files:**
- Modify: `mcp-connect.md` (Option A block, lines ~39–121; session bootstrap, lines ~175–182)
- Regenerate: `llms-full.txt` (via npm script, not by hand)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the canonical OAuth registration copy that Task 2's `install.sh` `register_note` strings point operators to ("see mcp-connect.md").

- [ ] **Step 1: Replace the Option A intro (current lines ~39–50)**

Replace from `## Option A: Hosted MCP` through the `> Obtaining SOHO_TOKEN is an operator action.` blockquote with:

```markdown
## Option A: Hosted MCP

Server URL: `https://mcp.sohopay.xyz` <!-- TODO(confirm): real hosted MCP URL once deployed -->

The hosted server implements the MCP OAuth 2.1 authorization spec: it advertises
protected-resource metadata at `/.well-known/oauth-protected-resource`, so your
harness discovers the authorization server, runs the OAuth 2.1 + PKCE flow, and
opens a **consent/approval page** in your browser. You approve there; the harness
stores and refreshes the token itself. You never paste a token on this path.

> The consent page is where the human authorizes the agent — it is the borrower
> approval step, not a developer credential. Approve only the scopes you intend to grant.
```

- [ ] **Step 2: Replace the per-harness registration blocks (current lines ~52–106)**

Replace from the `### Register per harness` heading through the end of the Hermes block (the line `Write this to ~/.hermes/mcp.json, or use the interactive hermes gateway setup wizard if that is the supported path.`) with:

````markdown
### Register per harness (OAuth — primary)

<!-- Claude Code / Cursor / Codex OAuth verified 2026-08-02 against vendor docs; Hermes pending. -->

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

**Hermes** — Hermes OAuth support is unverified; use the headless-token fallback below.

<!-- TODO(confirm): Hermes OAuth / consent-flow support and MCP config path (assumed ~/.hermes/mcp.json). -->

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
- **Hermes** (`~/.hermes/mcp.json`, or `hermes gateway setup`): `"headers": { "Authorization": "Bearer ${SOHO_TOKEN}" }`.

For Claude Code non-interactive specifically, you can instead authenticate once from an
interactive session (`/mcp` or `claude mcp login sohopay`); the stored token is reused
by later `claude -p` / Agent SDK runs.
````

- [ ] **Step 3: Reframe the MCP session bootstrap (current lines ~175–182)**

Replace the numbered list under `## MCP session bootstrap (both options)` (item 1 only) so the token is harness-obtained, not hand-carried. New item 1:

```markdown
1. Your harness obtains an OAuth access token via the consent flow above (issuer
   discovered from the server's protected-resource metadata; `https://api.sohopay.xyz`).
   On the headless fallback, this is the pre-issued `SOHO_TOKEN`.
```

Leave items 2–4 and the `401` / `WWW-Authenticate: Bearer` line unchanged.

- [ ] **Step 4: Regenerate the concatenated bundle**

Run: `npm run generate:llms-full`
Expected: `Wrote llms-full.txt (... bytes)` and only `llms-full.txt` changes besides `mcp-connect.md`.

- [ ] **Step 5: Verify — validator green**

Run: `npm run validate`
Expected: `All skill validations passed.` (includes `OK: mcp-connect.md content checks`).

- [ ] **Step 6: Verify — no bearer header on any primary block**

Run:
```bash
awk '/^### Register per harness \(OAuth — primary\)/,/^### Headless \/ CI fallback/' mcp-connect.md | grep -n "Authorization" || echo "OK: no Authorization header in primary OAuth section"
```
Expected: `OK: no Authorization header in primary OAuth section`

- [ ] **Step 7: Verify — fallback section present and labeled**

Run: `grep -n "Headless / CI fallback (no browser)" mcp-connect.md`
Expected: one match.

- [ ] **Step 8: Commit**

```bash
git add mcp-connect.md llms-full.txt
git commit -m "docs: OAuth 2.1 consent flow as primary MCP registration path"
```

---

### Task 2: Make `install.sh` register OAuth-first (remove token prompt)

**Files:**
- Modify: `install.sh` (help text ~13–15; Step-5 comment ~143–146; token prompt ~148–153; register `case` ~156–179)

**Interfaces:**
- Consumes: the OAuth registration copy authored in Task 1 (the `register_note` strings say "see mcp-connect.md").
- Produces: nothing downstream; `install.sh` is not concatenated into `llms-full.txt`.

- [ ] **Step 1: Update the `--key` help text (current lines ~13–15)**

Replace:
```bash
#   --key       SohoPay MCP token. Prompted (hidden) if omitted. Never written
#               to a file by this script; exported to the environment / passed
#               to the harness's own secret store only.
```
with:
```bash
#   --key       Pre-issued SohoPay MCP token for the HEADLESS/CI fallback only.
#               Omit it for the default OAuth flow (the harness opens a browser
#               consent page). Never written to a file by this script; passed to
#               the harness's own secret store only.
```

- [ ] **Step 2: Update the Step-5 comment block (current lines ~143–146)**

Replace:
```bash
# --- Step 5: register MCP server ---------------------------------------------
# The key is never written to a file by this script. For Claude Code it is handed
# to the CLI's own managed store; for Cursor/Codex the config references the
# ${SOHO_TOKEN} environment variable, which you export yourself.
```
with:
```bash
# --- Step 5: register MCP server ---------------------------------------------
# Default path is OAuth: the harness discovers the server's protected-resource
# metadata and runs the browser consent flow itself — no token is handled here. A
# token is used only when explicitly supplied via --key / $SOHO_TOKEN (headless/CI
# fallback), and even then is never written to a file.
```

- [ ] **Step 3: Remove the hidden token prompt (current lines ~148–153)**

Delete this entire block:
```bash
if [[ -z "$KEY" ]]; then
  # Prompt without echoing; skip in non-interactive contexts.
  if [[ -t 0 ]]; then
    read -rsp "SohoPay MCP token (input hidden, not stored): " KEY; echo
  fi
fi

```
Leave `register_note=""` and the `case "$HARNESS" in` that follow.

- [ ] **Step 4: Rewrite the Claude Code branch (current lines ~157–168)**

Replace:
```bash
  claude)
    if claude mcp get sohopay >/dev/null 2>&1; then
      register_note="already registered (left in place)"
    elif [[ -n "$KEY" ]]; then
      # TODO(confirm): exact auth header shape.
      claude mcp add sohopay --transport http "$MCP_URL" \
        --header "Authorization: Bearer ${KEY}"
      register_note="registered via 'claude mcp add'"
    else
      register_note="SKIPPED — no token; run: claude mcp add sohopay --transport http $MCP_URL --header \"Authorization: Bearer \$SOHO_TOKEN\""
    fi
    ;;
```
with:
```bash
  claude)
    if claude mcp get sohopay >/dev/null 2>&1; then
      register_note="already registered (left in place)"
    elif [[ -n "$KEY" ]]; then
      # Headless fallback: explicit token → bearer header.
      claude mcp add sohopay --transport http "$MCP_URL" \
        --header "Authorization: Bearer ${KEY}"
      register_note="registered with token (headless fallback)"
    else
      # Default: register header-less so OAuth discovery engages.
      claude mcp add sohopay --transport http "$MCP_URL"
      register_note="registered; run '/mcp' (or 'claude mcp login sohopay') to approve in your browser"
    fi
    ;;
```

- [ ] **Step 5: Rewrite the Cursor / Codex / Hermes notes (current lines ~169–178)**

Replace:
```bash
  cursor)
    register_note="config references \${SOHO_TOKEN}; export it, then add to ~/.cursor/mcp.json — see mcp-connect.md"
    ;;
  codex)
    register_note="config references \${SOHO_TOKEN}; export it, then add to ~/.codex/config.toml — see mcp-connect.md"
    ;;
  hermes)
    # TODO(confirm): exact Hermes MCP config path (assumed ~/.hermes/mcp.json).
    register_note="config references \${SOHO_TOKEN}; export it, then add to ~/.hermes/mcp.json (or 'hermes gateway setup') — see mcp-connect.md"
    ;;
```
with:
```bash
  cursor)
    register_note="add { \"url\": \"$MCP_URL\" } to ~/.cursor/mcp.json (no headers), then approve the OAuth 'Needs Login' prompt — see mcp-connect.md"
    ;;
  codex)
    register_note="add [mcp_servers.sohopay] url + auth = \"oauth\" to ~/.codex/config.toml, then run 'codex mcp login sohopay' — see mcp-connect.md"
    ;;
  hermes)
    # TODO(confirm): Hermes OAuth support + MCP config path (assumed ~/.hermes/mcp.json).
    register_note="Hermes OAuth unverified; use the headless token fallback in mcp-connect.md (~/.hermes/mcp.json or 'hermes gateway setup')"
    ;;
```

- [ ] **Step 6: Verify — shell syntax**

Run: `bash -n install.sh`
Expected: no output, exit 0.

- [ ] **Step 7: Verify — prompt removed, OAuth-first default present**

Run:
```bash
grep -n "read -rsp" install.sh || echo "OK: token prompt removed"
grep -n "claude mcp login sohopay" install.sh
```
Expected: `OK: token prompt removed`, and at least one match for the OAuth login hint.

- [ ] **Step 8: Verify — bootstrap guardrails still pass**

Run: `npm run validate`
Expected: `All skill validations passed.` (install.sh edits must not trip any guardrail).

- [ ] **Step 9: Commit**

```bash
git add install.sh
git commit -m "feat: install.sh registers MCP via OAuth by default, token is headless fallback"
```

---

## Notes for the executor

- If `scripts/verify-bootstrap.sh` is available and network access is permitted, `bash scripts/verify-bootstrap.sh` is the full E2E (generate + validate + registry list). It is optional here; the per-task `npm run validate` + `npm run generate:llms-full` are the required gates.
- Line numbers are approximate ("~") because earlier uncommitted edits shift them; match on the quoted content, not the line number.
- Hermes remains intentionally unverified — its `TODO(confirm)` markers are expected to stay.
