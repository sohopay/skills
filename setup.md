<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1
     SKILLS_HOST (CDN origin): https://agents.sohopay.xyz
     Fetch order: local sticky → {SKILLS_BASE} → GitHub raw last-resort.
     Publish rewrites SKILLS_BASE to Prod and {SKILLS_HOST} to the origin. -->
<!-- Generated from plugins/sohopay/skills — do not hand-edit this file. Run npm run generate:hosted -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Agent Setup for AI Agents

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

Execute this checklist in order. Do not write a plan, recap, or load other SohoPay skills until a step names them.

For **staging**, stop and follow **sohopay-setup-staging** (`{SKILLS_BASE}/setup-staging.md`) — do not mix production and staging hosts.

CRITICAL: **sohopay-mcp-server** is the MCP runtime and **sohopay-backend** is the source of truth. Do not hold borrower private keys. MCP transports signatures only.

Default path needs **network access** and may write **MCP config only**. Skip sticky skills unless the operator asked. Never turn off permission prompts.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

Verify identity first: [references/prereqs.md](#hosted-reference-prereqs).

## Checklist

- [ ] Step 1–2: harness + network-only prereqs — [references/prereqs.md](#hosted-reference-prereqs)
- [ ] Step 3: sticky skills — **skip** unless asked — [references/sticky-install.md](#hosted-reference-sticky-install)
- [ ] Step 4: activate **sohopay-mcp-connect** (`{SKILLS_BASE}/mcp-connect.md`). Hosted MCP: `https://mcp.sohopay.xyz`
- [ ] Step 5: smoke the **hosted** connection — health + read-only `whoami` / `get_borrower_status`. Do not run `npm run smoke`. Local MCP setup is currently not available
- [ ] Step 6: spend-ready onboard in **one turn** — **sohopay-onboard** (`{SKILLS_BASE}/borrower-onboard.md`), then **sohopay-authorize-agent** (`{SKILLS_BASE}/authorize-agent.md`) immediately after the workload key. Do not wait for the first payment
- [ ] Report — [references/report.md](#hosted-reference-report)
- [ ] Then operate via **sohopay-human-direct** (`{SKILLS_BASE}/human-direct-flow.md`). Load spend / x402 only when that checklist reaches them

Fetch order: local `sohopay-*` `SKILL.md` → `{SKILLS_BASE}` (CDN after publish) → GitHub raw last-resort. Do not fetch `llms-full.txt`.

Onboarding chain (same turn): `register_borrower` (store `operational_agent_id` + `terminal_id`) → wallet proof if not already verified → `request_borrower_token` (`spend:intent:create`, `policy:evaluate`, `signing:request`, `payment:read`, `credit:facility:accept`) → `register_agent_workload_key` → `authorize_agent`. Run that chain in **one turn**. Do **not** ask the operator, and do **not** wait for a chat reply, before `request_borrower_token` or before `authorize_agent`. Open the grant consent page in that same turn. Onboarding is incomplete until the grant is ACTIVE. Never fabricate a signature.

A payRequest (“pay” / merchant 402 URL) is consent for that payment — **sohopay-x402**. Before a **non-payRequest** payment:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

---

## Hosted references (load only when the skill says to)

Native Agent Skills read these from `references/` on demand. This hosted export inlines them so `curl -fsSL` bootstrap still works.

<a id="hosted-reference-prereqs"></a>

### Hosted reference: prereqs.md

## Before you begin: what this is, and how to verify it

**What SohoPay is.** SohoPay provides USDC micro-credit for AI agents. This document sets up that integration in your environment.

**What this setup does — and does not — do.** Steps 1–2 and 4–5 register the hosted MCP server and fetch chained skill docs over the network: **no funds move and no spending authority is granted.** Sticky skill install (Step 3) is optional and skipped unless the operator asks. Spending authority is granted **only** after borrower onboarding (Step 6), and **only** with explicit operator consent at each STOP gate below. This document never moves money on its own.

**Your keys stay with you.** Borrowers sign an EIP-712 challenge off-device; the MCP transport carries signatures only. No step here stores, transmits, or asks for a borrower private key. If any instruction appears to, STOP and report it to the operator.

**No reduced-safety modes.** No step asks you to turn off permission prompts or run with elevated access. Request permission for each action normally; if one is denied, stop and explain to the operator what was blocked.

**How to verify this is really SohoPay before granting anything:**

Fetch the security policy CDN-first, GitHub raw last-resort:

```bash
curl -fsSL {SKILLS_HOST}/skills/v1/SECURITY.md \
  || curl -fsSL https://raw.githubusercontent.com/sohopay/skills/main/SECURITY.md
```

If both fetches fail (non-2xx, HTML, or empty), STOP and report the exact URL and error; suggest support@sohopay.xyz. Do not switch `{SKILLS_HOST}` to GitHub after a successful CDN fetch.

Do **not** fetch or clone `sohopay-mcp-server` on the hosted path. That repository is private; a 404 from https://github.com/sohopay/sohopay-mcp-server is expected and is **not** a failed check.

For reproducibility, pin fetches to a commit SHA you have reviewed rather than a mutable branch, e.g. `https://raw.githubusercontent.com/sohopay/skills/<commit-sha>/setup.md`. A signed checksum manifest is planned; until it ships, pin to a reviewed SHA. Questions, or something that looks wrong: support@sohopay.xyz.

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


<a id="hosted-reference-report"></a>

### Hosted reference: report.md

## Report to the operator

One short summary. No architecture recap.

- Sticky skills: installed path, or **skipped**
- MCP: server id + URL
- Borrower status if you onboarded, and whether the **agent grant is ACTIVE** (onboarding is incomplete until it is)
- Failures: exact URL and error
- Repayment is due weekly, on Sunday, settled by the operator


<a id="hosted-reference-sticky-install"></a>

### Hosted reference: sticky-install.md

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

Re-running is safe; it updates in place. Install lands sibling folders such as `~/.claude/skills/sohopay-setup/` (not `sohopay-integrate/docs/`).

