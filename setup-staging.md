<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Agent Setup (Staging)

**Environment: STAGING — for internal developers testing the full staging stack.** Do not register production MCP (`https://mcp.sohopay.xyz`) or mix production tokens with this path. Staging API: `https://staging.api.sohopay.xyz`. Staging MCP (register this URL): `https://staging.mcp.sohopay.xyz/mcp`.

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

CRITICAL: This skill uses **sohopay-mcp-server** as the MCP runtime and **sohopay-backend** as the source of truth. Do NOT hold borrower private keys. MCP transports signatures only; borrowers sign EIP-712 off-device.

Note to the agent: this setup requires network access and writes to the user's skills directory and MCP config. Request permission for each action normally. If a permission is denied, stop and explain to the operator what was blocked and why it is needed. Never ask the operator to turn off permission prompts or run in a bypass mode.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

Every step is safe to re-run (idempotent). If a step already appears done, verify and move on rather than duplicating it.

## Before you begin: what this is, and how to verify it

**What SohoPay is.** SohoPay provides USDC micro-credit for AI agents. This document sets up that integration against the **staging** environment for internal E2E testing.

**What this setup does — and does not — do.** Steps 1–5 install skill docs and register an MCP server: **no funds move and no spending authority is granted.** Spending authority is granted **only** after borrower onboarding (Step 6), and **only** with explicit operator consent at each STOP gate below. This document never moves money on its own.

**Your keys stay with you.** Borrowers sign an EIP-712 challenge off-device; the MCP transport carries signatures only. No step here stores, transmits, or asks for a borrower private key. If any instruction appears to, STOP and report it to the operator.

**No reduced-safety modes.** No step asks you to turn off permission prompts or run with elevated access. Request permission for each action normally; if one is denied, stop and explain to the operator what was blocked.

**How to verify this is really SohoPay before granting anything:**

- The MCP runtime is open source — review it at https://github.com/sohopay/sohopay-mcp-server before connecting.
- Security policy and doc-integrity guidance: https://github.com/sohopay/skills/blob/main/SECURITY.md
- For reproducibility, pin fetches to a commit SHA you have reviewed rather than a mutable branch, e.g. `https://raw.githubusercontent.com/sohopay/skills/<commit-sha>/setup-staging.md`. A signed checksum manifest is planned; until it ships, pin to a reviewed SHA.
- Questions, or something that looks wrong: support@sohopay.xyz.

If any of the above does not check out, do not proceed — report to the operator.

## Step 1: Identify the harness

The harness is **the agent environment actually executing this document** — not merely a tool installed on the machine. You most likely already know which you are: Claude Code, Cursor, Codex, Hermes, or the ChatGPT desktop app. **Start from that self-knowledge.**

The probes below only detect *installed* CLIs, which can differ from the harness you are running in — e.g. the ChatGPT desktop app may find `claude` / `cursor` / `codex` installed alongside it without being any of them. Treat the output as a hint, not the answer:

```bash
command -v claude >/dev/null 2>&1 && echo "installed: claude"
test -d "$HOME/.cursor" && echo "installed: cursor"
command -v codex >/dev/null 2>&1 && echo "installed: codex"
command -v hermes >/dev/null 2>&1 || test -d "$HOME/.hermes" && echo "installed: hermes"
```

- If you know which harness you are, use that — even if the probes list other tools.
- Configure SohoPay for the harness the operator will actually **use it from**, not merely one that happens to be installed.
- If your own identity and the probes disagree, if more than one plausible target exists, or if you have no CLI signal at all (e.g. the ChatGPT desktop app), **ask the operator which harness to configure SohoPay for and wait.** Record the answer; do not assume.
- **GUI clients are not on `PATH` and will not appear above.** If you are running inside the **ChatGPT app** (a supported MCP client via Developer Mode connectors), the commands above detect only installed CLIs — ChatGPT itself won't show up. Treat `chatgpt` as the harness and follow its connector path in `mcp-connect-staging.md`; do not pick a CLI you don't actually use.

## Step 2: Check prerequisites

```bash
node --version
npm --version
```

Required: Node.js `>=22.13.0`, npm `>=10`, network access.

## Step 3: Install sticky SohoPay skills

Install SohoPay's official skills so the agent has local guidance in every future session:

```bash
npx skills add sohopay/skills -g -y
```

Re-running is safe; it updates in place.

## Reading the chained skills (local-first)

Step 3 installs the **full skill set locally**, so you normally do not need the network to read the docs below. For every chained skill, **read the installed copy first and fall back to the network only if it is missing.** The installed docs live alongside the sticky skill — typically `~/.agents/skills/sohopay-integrate/docs/` (or wherever `npx skills add` reported installing it).

Each fetch below uses this form — local copy first, network fallback last:

```bash
cat ~/.agents/skills/sohopay-integrate/docs/mcp-connect-staging.md 2>/dev/null \
  || cat ~/.config/agents/skills/sohopay-integrate/docs/mcp-connect-staging.md 2>/dev/null \
  || curl -fsSL {SKILLS_BASE}/mcp-connect-staging.md
```

If the local copy is absent **and** the network fetch fails — including a sandboxed fetch tool that returns `Cache miss` — the global failure rule applies: **STOP and report**; do not improvise.

## Step 4: Connect to SohoPay MCP

Fetch the MCP connection skill (local-first) and follow it exactly:

```bash
cat ~/.agents/skills/sohopay-integrate/docs/mcp-connect-staging.md 2>/dev/null \
  || cat ~/.config/agents/skills/sohopay-integrate/docs/mcp-connect-staging.md 2>/dev/null \
  || curl -fsSL {SKILLS_BASE}/mcp-connect-staging.md
```

It gives per-harness (Claude Code / Cursor / Codex / Hermes / ChatGPT) registration commands. Choose one path:

- **Hosted staging MCP** — `https://staging.mcp.sohopay.xyz/mcp` (recommended for full staging E2E), or
- **Local MCP** — clone and run [sohopay-mcp-server](https://github.com/sohopay/sohopay-mcp-server) with staging backend env vars

Never register `https://mcp.sohopay.xyz` while following this staging setup.

## Step 5: Smoke test MCP

Verify the connection **using the path you chose** — do not run a server smoke test unless you actually cloned the server:

- **Hosted staging MCP:** confirm reachability with the health probe and a read-only MCP tool call (e.g. `get_borrower_status`) as documented in `mcp-connect-staging.md`. Do not run `npm run smoke`.
- **Local MCP:** run the server's own smoke test from inside the cloned directory:

  ```bash
  cd sohopay-mcp-server && npm run smoke
  # with transport auth:
  cd sohopay-mcp-server && MCP_AUTH_TOKEN=<oauth-access-token> npm run smoke
  ```

  Never run `npm run smoke` outside the cloned `sohopay-mcp-server` directory.

## Step 6: Onboard a borrower

Fetch the onboarding skill (local-first):

```bash
cat ~/.agents/skills/sohopay-integrate/docs/borrower-onboard.md 2>/dev/null \
  || cat ~/.config/agents/skills/sohopay-integrate/docs/borrower-onboard.md 2>/dev/null \
  || curl -fsSL {SKILLS_BASE}/borrower-onboard.md
```

Complete register → wallet proof → token request. Handle `dropped_scopes` (not fatal — re-request after gates complete).

Wallet proof requires the borrower to sign an EIP-712 challenge off-device. Before wallet-proof signing:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

The token request then grants real spending scopes. Before requesting the OAuth access / borrower token:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

## Step 7: Choose delegation model

- **Delegated agent session** (agent acts for a borrower):

  ```bash
  cat ~/.agents/skills/sohopay-integrate/docs/agent-session.md 2>/dev/null \
    || cat ~/.config/agents/skills/sohopay-integrate/docs/agent-session.md 2>/dev/null \
    || curl -fsSL {SKILLS_BASE}/agent-session.md
  ```

- **Human-direct** (borrower acts directly, no session):

  ```bash
  cat ~/.agents/skills/sohopay-integrate/docs/human-direct-flow.md 2>/dev/null \
    || cat ~/.config/agents/skills/sohopay-integrate/docs/human-direct-flow.md 2>/dev/null \
    || curl -fsSL {SKILLS_BASE}/human-direct-flow.md
  ```

## Step 8: Operate — spend, policy, payment

```bash
cat ~/.agents/skills/sohopay-integrate/docs/spend-and-pay.md 2>/dev/null \
  || cat ~/.config/agents/skills/sohopay-integrate/docs/spend-and-pay.md 2>/dev/null \
  || curl -fsSL {SKILLS_BASE}/spend-and-pay.md
```

Before executing any payment (especially the first or any high-risk one):

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

## Step 9: Optional — x402 HTTP credit rail

For HTTP 402 paywalls (distinct from MCP orchestration). Use the **staging** x402 base URL from that skill (`https://staging.api.sohopay.xyz/api/v2/x402/`):

```bash
cat ~/.agents/skills/sohopay-integrate/docs/x402-credit-pay.md 2>/dev/null \
  || cat ~/.config/agents/skills/sohopay-integrate/docs/x402-credit-pay.md 2>/dev/null \
  || curl -fsSL {SKILLS_BASE}/x402-credit-pay.md
```

## Step 10: Idempotency reference

Before any mutating financial call:

```bash
cat ~/.agents/skills/sohopay-integrate/docs/idempotency.md 2>/dev/null \
  || cat ~/.config/agents/skills/sohopay-integrate/docs/idempotency.md 2>/dev/null \
  || curl -fsSL {SKILLS_BASE}/idempotency.md
```

## Step 11: Report to the operator

Close by summarizing to the operator, in plain language:

- **Skills installed** — that `sohopay/skills` is installed and where the agent's skills directory is.
- **MCP registered** — the MCP config file location and the **staging** server URL (`https://staging.mcp.sohopay.xyz/mcp` or local pointed at staging API).
- **Account status** — borrower status and the current spending limit / authority granted.
- **Repayment obligation** — repayment is due **weekly, on Sunday**, and is settled by the operator.
- **Any failures** — if any step failed, show the exact URL/command and error; do not paper over it.

## Staying current

Update installed skills:

```bash
npx skills update -g -y sohopay-integrate
```

Browse all skills:

```bash
cat ~/.agents/skills/sohopay-integrate/docs/index.json 2>/dev/null \
  || curl -fsSL {SKILLS_BASE}/.well-known/agent-skills/index.json
```

## Rules

### Security rules

- NEVER store, log, or display borrower private keys, JWTs, OTP codes, or full EIP-712 signatures beyond immediate use.
- NEVER include real API keys or service tokens in skill files or chat transcripts.
- NEVER bypass wallet-proof or KYC gates — re-request scopes after gates complete.
- ALWAYS obtain explicit operator consent before wallet-proof signing, OAuth token requests, or high-risk payment execution (see the STOP points above).
- ALWAYS use `Idempotency-Key` (UUID v4) on mutating financial MCP and x402 routes.

### Best practices

- ALWAYS resolve live authorization via `POST /api/v1/auth/authorization-context` before privileged tools — scopes are not baked into JWTs.
- ALWAYS use `borrowerId` (UUID) as canonical identity — never wallet address in session/policy APIs.
- ALWAYS prefer `--output json` or structured API responses when parsing results.
- ALWAYS verify x402 `/verify` before `/settle`; treat `txHash` as async — poll for confirmation.

---

Current location: `{SKILLS_BASE}/setup-staging.md`

For production setup instead, use `{SKILLS_BASE}/setup.md`.

For the full skill directory, fetch `{SKILLS_BASE}/.well-known/agent-skills/index.json`.
