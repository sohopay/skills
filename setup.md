<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Agent Setup for AI Agents

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

For **staging** (internal full-stack E2E against `staging.mcp` / `staging.api`), stop here and follow `{SKILLS_BASE}/setup-staging.md` instead — do not mix production and staging hosts.

CRITICAL: This skill uses **sohopay-mcp-server** as the MCP runtime and **sohopay-backend** as the source of truth. Do NOT hold borrower private keys. MCP transports signatures only; borrowers sign EIP-712 off-device.

Note to the agent: the default path needs **network access** and may write **MCP config only**. Do not write to the user's skills directory unless the operator explicitly asks for sticky skills (Step 3). Request permission for each action normally. If a permission is denied, stop and explain to the operator what was blocked and why it is needed. Never ask the operator to turn off permission prompts or run in a bypass mode.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

Every step is safe to re-run (idempotent). If a step already appears done, verify and move on rather than duplicating it.

## Before you begin: what this is, and how to verify it

**What SohoPay is.** SohoPay provides USDC micro-credit for AI agents. This document sets up that integration in your environment.

**What this setup does — and does not — do.** Steps 1–2 and 4–5 register the hosted MCP server and fetch chained skill docs over the network: **no funds move and no spending authority is granted.** Sticky skill install (Step 3) is optional and skipped unless the operator asks. Spending authority is granted **only** after borrower onboarding (Step 6), and **only** with explicit operator consent at each STOP gate below. This document never moves money on its own.

**Your keys stay with you.** Borrowers sign an EIP-712 challenge off-device; the MCP transport carries signatures only. No step here stores, transmits, or asks for a borrower private key. If any instruction appears to, STOP and report it to the operator.

**No reduced-safety modes.** No step asks you to turn off permission prompts or run with elevated access. Request permission for each action normally; if one is denied, stop and explain to the operator what was blocked.

**How to verify this is really SohoPay before granting anything:**

- The MCP runtime is open source — review it at https://github.com/sohopay/sohopay-mcp-server before connecting.
- Security policy and doc-integrity guidance: https://github.com/sohopay/skills/blob/main/SECURITY.md
- For reproducibility, pin fetches to a commit SHA you have reviewed rather than a mutable branch, e.g. `https://raw.githubusercontent.com/sohopay/skills/<commit-sha>/setup.md`. A signed checksum manifest is planned; until it ships, pin to a reviewed SHA.
- Questions, or something that looks wrong: support@sohopay.xyz.

If any of the above does not check out, do not proceed — report to the operator.

## Step 1: Identify the harness

The harness is **the agent environment actually executing this document** — not merely a tool installed on the machine. You most likely already know which you are: Claude Code, Cursor, Codex, Hermes, or the ChatGPT desktop app. **Start from that self-knowledge.**

**Claude.ai chat is not Claude Code.** If you are running on claude.ai (web chat, a Claude Project, or the claude.ai sandbox), you are **not** a supported MCP client: there is no `claude mcp` config to write, and sandbox egress often blocks SohoPay hosts. **STOP**, report that to the operator, and tell them to re-run this setup from **Claude Code** on their machine.

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
- **GUI clients are not on `PATH` and will not appear above.** If you are running inside the **ChatGPT app** (a supported MCP client via Developer Mode connectors), the commands above detect only installed CLIs — ChatGPT itself won't show up. Treat `chatgpt` as the harness and follow its connector path in `mcp-connect.md`; do not pick a CLI you don't actually use.

## Step 2: Check prerequisites

Required for the default hosted path: **network access** (ability to fetch skill docs and reach the MCP origin). **Node.js and npm are not required** and must not be asked for or installed as part of normal setup.

Do **not** run `node --version` / `npm --version` on the default path.

## Step 3: Optional — sticky SohoPay skills (skip by default)

**Skip this step unless the operator explicitly asks for sticky / offline skills.** Do not run `npx skills add`, do not prompt the operator to install sticky skills, and do not ask them to install Node.js or npm.

When the operator **does** explicitly request sticky skills:

1. Verify Node.js `>=22.13.0` and npm `>=10` (only now):

```bash
node --version
npm --version
```

2. Install SohoPay's official skills **only for the harness from Step 1**. Always pass `--agent` / `-a`. Omitting it (especially with `-y`) makes the CLI symlink into every detected agent directory.

| Step 1 harness | Install command |
|----------------|-----------------|
| Claude Code | `npx skills add sohopay/skills -g -y -a claude-code` |
| Cursor | `npx skills add sohopay/skills -g -y -a cursor` |
| Codex | `npx skills add sohopay/skills -g -y -a codex` |
| Hermes | `npx skills add sohopay/skills -g -y -a hermes-agent` |
| ChatGPT app | Skip — no `npx skills` target; read hosted docs when connecting |
| Claude.ai chat | Do not install. You should already have STOPped in Step 1. |

Re-running is safe; it updates in place. Claude Code's global copy is `~/.claude/skills/sohopay-integrate/`.

## Reading the chained skills (local if present, else network)

**Network fetch is the normal path.** If sticky skills were already installed (or the operator just opted in above), prefer the local copy; otherwise fetch from `{SKILLS_BASE}`. Search local paths in this order when present: `~/.claude/skills/sohopay-integrate/docs/` (Claude Code), then `~/.agents/skills/sohopay-integrate/docs/`, then `~/.config/agents/skills/sohopay-integrate/docs/` (or wherever `npx skills add` reported installing it).

Each fetch below uses this form — local copy first (if any), network last:

```bash
cat ~/.claude/skills/sohopay-integrate/docs/mcp-connect.md 2>/dev/null \
  || cat ~/.agents/skills/sohopay-integrate/docs/mcp-connect.md 2>/dev/null \
  || cat ~/.config/agents/skills/sohopay-integrate/docs/mcp-connect.md 2>/dev/null \
  || curl -fsSL {SKILLS_BASE}/mcp-connect.md
```

If the local copy is absent **and** the network fetch fails — including a sandboxed fetch tool that returns `Cache miss` — the global failure rule applies: **STOP and report**; do not improvise.

## Step 4: Connect to SohoPay MCP

Fetch the MCP connection skill and follow it exactly:

```bash
cat ~/.claude/skills/sohopay-integrate/docs/mcp-connect.md 2>/dev/null \
  || cat ~/.agents/skills/sohopay-integrate/docs/mcp-connect.md 2>/dev/null \
  || cat ~/.config/agents/skills/sohopay-integrate/docs/mcp-connect.md 2>/dev/null \
  || curl -fsSL {SKILLS_BASE}/mcp-connect.md
```

It gives per-harness (Claude Code / Cursor / Codex / Hermes / ChatGPT) registration commands. Choose one path:

- **Hosted MCP** — `https://mcp.sohopay.xyz` (when deployed), or
- **Local MCP** — clone and run [sohopay-mcp-server](https://github.com/sohopay/sohopay-mcp-server)

## Step 5: Smoke test MCP

Verify the connection **using the path you chose** — do not run a server smoke test unless you actually cloned the server:

- **Hosted MCP:** confirm reachability with the health probe and a read-only MCP tool call (e.g. `get_borrower_status`) as documented in `mcp-connect.md`. Do not run `npm run smoke`.
- **Local MCP:** run the server's own smoke test from inside the cloned directory:

  ```bash
  cd sohopay-mcp-server && npm run smoke
  # with transport auth:
  cd sohopay-mcp-server && MCP_AUTH_TOKEN=<oauth-access-token> npm run smoke
  ```

  Never run `npm run smoke` outside the cloned `sohopay-mcp-server` directory.

## Step 6: Onboard a borrower

Fetch the onboarding skill:

```bash
cat ~/.claude/skills/sohopay-integrate/docs/borrower-onboard.md 2>/dev/null \
  || cat ~/.agents/skills/sohopay-integrate/docs/borrower-onboard.md 2>/dev/null \
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
  cat ~/.claude/skills/sohopay-integrate/docs/agent-session.md 2>/dev/null \
    || cat ~/.agents/skills/sohopay-integrate/docs/agent-session.md 2>/dev/null \
    || cat ~/.config/agents/skills/sohopay-integrate/docs/agent-session.md 2>/dev/null \
    || curl -fsSL {SKILLS_BASE}/agent-session.md
  ```

- **Human-direct** (borrower acts directly, no session):

  ```bash
  cat ~/.claude/skills/sohopay-integrate/docs/human-direct-flow.md 2>/dev/null \
    || cat ~/.agents/skills/sohopay-integrate/docs/human-direct-flow.md 2>/dev/null \
    || cat ~/.config/agents/skills/sohopay-integrate/docs/human-direct-flow.md 2>/dev/null \
    || curl -fsSL {SKILLS_BASE}/human-direct-flow.md
  ```

## Step 8: Operate — spend, policy, payment

```bash
cat ~/.claude/skills/sohopay-integrate/docs/spend-and-pay.md 2>/dev/null \
  || cat ~/.agents/skills/sohopay-integrate/docs/spend-and-pay.md 2>/dev/null \
  || cat ~/.config/agents/skills/sohopay-integrate/docs/spend-and-pay.md 2>/dev/null \
  || curl -fsSL {SKILLS_BASE}/spend-and-pay.md
```

Before executing any payment (especially the first or any high-risk one):

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

## Step 9: Optional — x402 HTTP credit rail

For HTTP 402 paywalls (distinct from MCP orchestration):

```bash
cat ~/.claude/skills/sohopay-integrate/docs/x402-credit-pay.md 2>/dev/null \
  || cat ~/.agents/skills/sohopay-integrate/docs/x402-credit-pay.md 2>/dev/null \
  || cat ~/.config/agents/skills/sohopay-integrate/docs/x402-credit-pay.md 2>/dev/null \
  || curl -fsSL {SKILLS_BASE}/x402-credit-pay.md
```

## Step 10: Idempotency reference

Before any mutating financial call:

```bash
cat ~/.claude/skills/sohopay-integrate/docs/idempotency.md 2>/dev/null \
  || cat ~/.agents/skills/sohopay-integrate/docs/idempotency.md 2>/dev/null \
  || cat ~/.config/agents/skills/sohopay-integrate/docs/idempotency.md 2>/dev/null \
  || curl -fsSL {SKILLS_BASE}/idempotency.md
```

## Step 11: Report to the operator

Close by summarizing to the operator, in plain language:

- **Sticky skills** — installed (path) **or skipped** (default). Do not imply sticky install ran if it was skipped.
- **MCP registered** — the MCP config file location and the server URL (hosted or local).
- **Account status** — borrower status and the current spending limit / authority granted.
- **Repayment obligation** — repayment is due **weekly, on Sunday**, and is settled by the operator.
- **Any failures** — if any step failed, show the exact URL/command and error; do not paper over it.

## Staying current

Only if sticky skills were installed (or the operator asks to install/update them). Requires Node.js / npm:

```bash
npx skills update -g -y -a claude-code sohopay-integrate   # same -a as Step 3 when sticky was used
```

Browse all skills (network works without sticky install):

```bash
cat ~/.claude/skills/sohopay-integrate/docs/index.json 2>/dev/null \
  || cat ~/.agents/skills/sohopay-integrate/docs/index.json 2>/dev/null \
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

Current location: `{SKILLS_BASE}/setup.md`

For the full skill directory, fetch `{SKILLS_BASE}/.well-known/agent-skills/index.json`.
