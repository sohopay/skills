# sohopay/skills

Canonical source for **SohoPay agent skills** — the docs an AI coding agent fetches to connect to SohoPay, onboard a borrower, and operate USDC micro-credit. SohoPay provides USDC micro-credit for AI agents.

## Quick start (agent-driven)

Paste this into your agent (Claude Code, Cursor, Codex, Hermes, or the ChatGPT app):

```
Fetch https://raw.githubusercontent.com/sohopay/skills/main/setup.md and
follow the instructions in it to set up SohoPay in this environment.
```

<!-- At launch this URL switches to https://agents.sohopay.xyz/skills/v1/setup.md -->

Prefer to read the instructions first (for humans):

```bash
curl -fsSL https://raw.githubusercontent.com/sohopay/skills/main/setup.md
```

### Staging (internal developers)

Paste this to exercise the full staging stack (`staging.mcp` / `staging.api`):

```
Fetch https://raw.githubusercontent.com/sohopay/skills/main/setup-staging.md and
follow the instructions in it to set up SohoPay in this environment.
```

```bash
curl -fsSL https://raw.githubusercontent.com/sohopay/skills/main/setup-staging.md
```

## Install MCP

Register the hosted Streamable HTTP server, then complete OAuth in the harness (browser consent). Do **not** mix production and staging hosts. Staging uses server id `sohopay-staging` so it does not overwrite a production `sohopay` entry. Full OAuth / headless notes: [mcp-connect.md](mcp-connect.md) · [mcp-connect-staging.md](mcp-connect-staging.md).

| | Production | Staging |
|---|------------|---------|
| Server id | `sohopay` | `sohopay-staging` |
| MCP URL | `https://mcp.sohopay.xyz` | `https://staging.mcp.sohopay.xyz/mcp` |

Do **not** pass `--header "Authorization: …"` on the OAuth path. If the server rejects a supplied header, some harnesses mark the connection failed instead of falling back to OAuth.

### Claude Code

```bash
# Production
claude mcp add --transport http sohopay https://mcp.sohopay.xyz
claude mcp login sohopay

# Staging
claude mcp add --transport http sohopay-staging https://staging.mcp.sohopay.xyz/mcp
claude mcp login sohopay-staging
```

Or authorize from inside Claude Code: `/mcp` → Authenticate.

### Claude.ai

Prefills **Add custom connector** (web / Claude Desktop). You still confirm in Claude before it is added. This is not Claude Code.

One-click: [Add production](https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=SohoPay&connectorUrl=https%3A%2F%2Fmcp.sohopay.xyz) · [Add staging](https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=SohoPay%20Staging&connectorUrl=https%3A%2F%2Fstaging.mcp.sohopay.xyz%2Fmcp)

### Codex

```bash
# Production
codex mcp add sohopay --url https://mcp.sohopay.xyz
codex mcp login sohopay

# Staging
codex mcp add sohopay-staging --url https://staging.mcp.sohopay.xyz/mcp
codex mcp login sohopay-staging
```

Alternatively edit `~/.codex/config.toml`:

```toml
[mcp_servers.sohopay]
url = "https://mcp.sohopay.xyz"
auth = "oauth"
```

### Cursor

One-click: [Add production](https://cursor.com/en/install-mcp?name=sohopay&config=eyJ1cmwiOiJodHRwczovL21jcC5zb2hvcGF5Lnh5eiJ9) · [Add staging](https://cursor.com/en/install-mcp?name=sohopay-staging&config=eyJ1cmwiOiJodHRwczovL3N0YWdpbmcubWNwLnNvaG9wYXkueHl6L21jcCJ9)

Or edit `~/.cursor/mcp.json` (create the file if absent), with **no** `headers`:

```json
{
  "mcpServers": {
    "sohopay": {
      "url": "https://mcp.sohopay.xyz"
    }
  }
}
```

Staging: use id `sohopay-staging` and `"url": "https://staging.mcp.sohopay.xyz/mcp"`. Cursor shows **Needs Login**; approve in the browser. No `type` / `transport` field is needed. Write tools must pass `idempotency_key` as a tool argument (UUID v4).

### Gemini CLI

```bash
# Production
gemini mcp add --transport http --scope user sohopay https://mcp.sohopay.xyz

# Staging
gemini mcp add --transport http --scope user sohopay-staging https://staging.mcp.sohopay.xyz/mcp
```

Then authenticate with `/mcp auth sohopay` (or `sohopay-staging`).

### Hermes

```bash
# Production
hermes mcp add sohopay --url https://mcp.sohopay.xyz --auth oauth
hermes mcp login sohopay

# Staging
hermes mcp add sohopay-staging --url https://staging.mcp.sohopay.xyz/mcp --auth oauth
hermes mcp login sohopay-staging
```

### VS Code / GitHub Copilot

One-click: [Add production](https://vscode.dev/redirect/mcp/install?name=sohopay&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fmcp.sohopay.xyz%22%7D) · [Add staging](https://vscode.dev/redirect/mcp/install?name=sohopay-staging&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fstaging.mcp.sohopay.xyz%2Fmcp%22%7D)

Or CLI:

```bash
# Production
code --add-mcp '{"name":"sohopay","type":"http","url":"https://mcp.sohopay.xyz"}'

# Staging
code --add-mcp '{"name":"sohopay-staging","type":"http","url":"https://staging.mcp.sohopay.xyz/mcp"}'
```

Or Command Palette → **MCP: Add Server** → HTTP, paste the MCP URL, then complete OAuth when prompted.

### Visual Studio

One-click: [Add production](https://vs-open.link/mcp-install?%7B%22name%22%3A%22sohopay%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fmcp.sohopay.xyz%22%7D) · [Add staging](https://vs-open.link/mcp-install?%7B%22name%22%3A%22sohopay-staging%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fstaging.mcp.sohopay.xyz%2Fmcp%22%7D)

Then complete OAuth when Visual Studio prompts.

### ChatGPT

Configured in ChatGPT settings (web), not a CLI. Requires a paid plan with **Developer Mode**.

1. At `https://chatgpt.com`, enable **Developer Mode** (Settings → Apps/Connectors → Advanced settings; labels shift between releases).
2. **Settings → Connectors → Create**:
   - **Name:** `SohoPay` or `SohoPay Staging`
   - **MCP server URL:** `https://mcp.sohopay.xyz` or `https://staging.mcp.sohopay.xyz/mcp`
   - **Authentication:** `OAuth`
3. Approve the browser consent page, then enable the connector in the chat tools menu.

Write tools must pass `idempotency_key` as a tool argument (UUID v4).

### Goose

Requires the Goose desktop app. One-click: [Add production](goose://extension?url=https%3A%2F%2Fmcp.sohopay.xyz&type=streamable_http&id=sohopay&name=SohoPay&description=SohoPay%20USDC%20micro-credit%20for%20AI%20agents) · [Add staging](goose://extension?url=https%3A%2F%2Fstaging.mcp.sohopay.xyz%2Fmcp&type=streamable_http&id=sohopay-staging&name=SohoPay%20Staging&description=SohoPay%20USDC%20micro-credit%20for%20AI%20agents)

### LM Studio

Requires LM Studio 0.3.17+. One-click: [Add production](lmstudio://add_mcp?name=sohopay&config=eyJ1cmwiOiJodHRwczovL21jcC5zb2hvcGF5Lnh5eiJ9) · [Add staging](lmstudio://add_mcp?name=sohopay-staging&config=eyJ1cmwiOiJodHRwczovL3N0YWdpbmcubWNwLnNvaG9wYXkueHl6L21jcCJ9)

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json` (or Cascade → Manage MCPs → View Raw Config). Use `serverUrl` for remote HTTP:

```json
{
  "mcpServers": {
    "sohopay": {
      "serverUrl": "https://mcp.sohopay.xyz"
    }
  }
}
```

Staging: id `sohopay-staging` and `"serverUrl": "https://staging.mcp.sohopay.xyz/mcp"`. Refresh MCP after saving.

## Sticky install (optional)

Install the skills so the agent has SohoPay guidance in every future session. **Not required** for setup — the default agent flow fetches docs over the network and registers hosted MCP without Node.js. Sticky install needs Node.js / npm:

```bash
npx skills add sohopay/skills -g -a claude-code   # Claude Code; pass -a for the harness you use
gh skill install sohopay/skills                   # GitHub CLI skills
```

## What this installs and what it can do

Running setup will:

- **Register the SohoPay MCP server** in your harness config (hosted URL by default; local `sohopay-mcp-server` only if you choose that path).
- **Fetch skill docs over the network** as needed. Sticky install into the agent's skills directory is optional and only runs if you ask for it.
- **After borrower onboarding**, the agent holds **USDC spending authority** under policy limits. **Repayment is due weekly, on Sunday**, and is settled by the operator.

Every consent-critical step (wallet-proof signing, token requests, payment execution) pauses and asks you first. The docs never instruct an agent to disable permission prompts or run in a bypass mode.

## Repository layout

| Path | Purpose |
|------|---------|
| `setup.md`, `*.md` | Hosted skill docs (served from raw GitHub in dev, `agents.sohopay.xyz` at launch) |
| `.well-known/agent-skills/index.json` | Machine-readable skill index |
| `plugins/sohopay/skills/` | Open-registry skill packages (`SKILL.md` per skill) |
| `install.sh` | Deterministic non-agent installer for operators/CI |
| `scripts/validate-skills.mjs` | CI guardrails |
| `scripts/generate-llms-full.mjs` | Builds `llms-full.txt` |

## Canonical endpoints

See [docs/endpoints.md](docs/endpoints.md). Public skill host uses the `sohopay.xyz` Route53 zone (`agents.sohopay.xyz`).

**Architecture plan:** [docs/PLAN.md](docs/PLAN.md) · **Engineering notes:** [docs/engineering-notes.md](docs/engineering-notes.md)

## Local validation

```bash
npm run validate
npm run generate:llms-full
```

## Deploy

Push to `main` runs `.github/workflows/validate.yml` then `.github/workflows/deploy.yml` (requires AWS OIDC secrets — see workflow comments).

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting and doc-integrity guidance.

## License

Licensed under the [Apache License 2.0](LICENSE) — permissive reuse with an
explicit patent grant. These skill docs are meant to be freely fetched, read,
forked, and adapted by integrators.
