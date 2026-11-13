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

**Host capability gate:** Before executable setup or onboarding, follow [references/mobile-host-capabilities.md](#hosted-reference-mobile-host-capabilities). A mobile chat without a verified SohoPay integration uses the official website fallback; reading this skill does not install payment tools. Desktop runtimes that satisfy the gate continue the existing checklist unchanged.

Execute this checklist in order. Do not write a plan, recap, or load other SohoPay skills until a step names them.

For **staging**, first load **sohopay-setup-staging** (`{SKILLS_BASE}/setup-staging.md`) to pin the staging row, then run this checklist against those staging hosts — do not mix production and staging hosts. If you already arrived here from **sohopay-setup-staging** with the staging row pinned, continue the checklist below; do not loop back.

CRITICAL: **sohopay-mcp-server** is the MCP runtime and **sohopay-backend** is the source of truth. Do not hold borrower private keys. MCP transports signatures only.

Default path needs **network access** and may write **MCP config only**. If the pinned signer is missing, install it and continue in this same turn. Skip sticky skills unless the operator asked. Never turn off permission prompts.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

Verify identity first: [references/prereqs.md](#hosted-reference-prereqs).

Browser consent and handoff pages (verbatim URLs, polling, harness limits): [references/browser-consent.md](#hosted-reference-browser-consent).

## Checklist

- [ ] Step 1–2: harness + network-only prereqs — [references/prereqs.md](#hosted-reference-prereqs)
- [ ] Step 3: sticky skills — **skip** unless asked — [references/sticky-install.md](#hosted-reference-sticky-install)
- [ ] Signer, before MCP: if `sohopay-signer` is missing or older than the pin, run `npm i -g @sohopay/agent-signer@0.3.1` and continue. Do not stop, and do not ask the operator to reply. Never use `sudo` or change npm settings; stop if the install fails. ChatGPT skips the local signer. Details: [references/prereqs.md](#hosted-reference-prereqs)
- [ ] Step 4: activate **sohopay-mcp-connect** (`{SKILLS_BASE}/mcp-connect.md`). Hosted MCP origin — **production:** `https://mcp.sohopay.xyz`. **Staging path:** use the staging MCP origin pinned by **sohopay-setup-staging** (`https://staging.mcp.sohopay.xyz`), never the production host
- [ ] Step 5: smoke the **hosted** connection — health + read-only `whoami` / `get_borrower_status`. Do not run `npm run smoke`. Local MCP setup is currently not available
- [ ] Step 6: onboard until spendable credit — **sohopay-onboard** (`{SKILLS_BASE}/borrower-onboard.md`): one `get_context` step at a time until `purchasing_power.can_pay` is true. Do not wait for the first payment, and do not start one
- [ ] Report — [references/report.md](#hosted-reference-report). Give it even when onboarding ended the turn on a blocker (`COMPLETE_PROFILE`, a status, or a borrower handoff)
- [ ] Then operate via **sohopay-human-direct** (`{SKILLS_BASE}/human-direct-flow.md`). Load spend / x402 only when that checklist reaches them

Fetch order: local `sohopay-*` `SKILL.md` → `{SKILLS_BASE}` (CDN after publish) → GitHub raw last-resort. Do not fetch `llms-full.txt`.

Onboarding chain: `get_context` → `register_borrower` (store `operational_agent_id` + `terminal_id`) → `register_agent_workload_key` immediately, even with no wallet and even when `COMPLETE_PROFILE` is listed → `request_borrower_token` including `credit:facility:accept` and `handle:claim` → `authorize_agent` and open the passkey consent page until the grant is ACTIVE (within-threshold grants need no wallet; above-threshold grants also need an EOA signature) → repeat `get_context` and do only the current blocker. `COMPLETE_PROFILE` is first, ahead of any wallet or bank step: the borrower enters legal name and date of birth on the SohoPay page, never in chat, with no link; report it and end the turn. `CONNECT_WALLET` and `CONNECT_BANK` together: ask once, wallet or bank, then `start_browser_handoff` with that `action`. `PROVE_WALLET` plus `CONNECT_BANK`: wallet means the proof; bank means `action: CONNECT_BANK`. Never send `CONNECT_WALLET` while `PROVE_WALLET` is listed. `REVIEW_AND_ACCEPT_FACILITY`: `review_facility_offer`, open `open_url`, then re-read. When no agent-actionable step is left (`EVALUATE_CREDIT`, `REVIEW_CREDIT_OFFER`, `REPAYMENT_METHOD_REQUIRED`, `IN_REVIEW`, `INELIGIBLE`), report them as onboarded but not spend-ready and end the turn. Do not poll. `CLAIM_HANDLE`: claim a handle the borrower confirms, before ending any of the turns above. A missing handle does not block `can_pay`, but the borrower is not fully onboarded without one. Stop when `purchasing_power.can_pay` is true, report available credit, and do not start a payment. Apart from an explicit source-choice STOP, do **not** wait for a chat reply, before `request_borrower_token`; do not wait for first payment; never fabricate a passkey assertion or signature.

A payRequest (“pay” / merchant 402 URL) is consent for that payment — **sohopay-x402**. Before a **non-payRequest** payment:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

---

## Hosted references (load only when the skill says to)

Native Agent Skills read these from `references/` on demand. This hosted export inlines them so `curl -fsSL` bootstrap still works.

<a id="hosted-reference-browser-consent"></a>

### Hosted reference: browser-consent.md

## Browser consent and handoff pages

SohoPay onboarding and MCP login depend on **opening HTTPS URLs in the operator's browser**. The agent prepares links; the borrower completes passkey, Plaid, or OAuth approval on SohoPay pages. This reference applies to every `consent_url`, `open_url`, and OAuth approval page — not only agent authorization.

### Use a capable agent model

Weaker models often **fail tool calling**, **truncate URLs**, or **drop the `#` fragment**. That breaks consent and bank handoff pages. For setup and onboarding, use a model with reliable tool calling that preserves long URLs and fragments. If a page opens blank or "Invalid link", re-run the step with a stronger model and open the URL **verbatim** again.

### Open URLs verbatim — never fetch them

| Field | Source | Rule |
|-------|--------|------|
| `consent_url` | `authorize_agent`, repayment consent, etc. | Open exactly as returned (`…/agent/authorize#<challenge_id>` or assembled repay URL). Never rebuild from `typed_data`. Agent-grant details: `{SKILLS_BASE}/authorize-agent.md` — load that skill's `references/consent-page.md`. |
| `open_url` | `start_browser_handoff`, `review_facility_offer` | Open exactly as returned, **`#…` included**. Single-use, borrower-bound. Never shorten, rewrite, or rebuild paths such as `/facility/accept`. |

**Do not** `curl`, `fetch`, or HTTP GET these URLs from the agent. They are for the **browser** (passkey, Plaid Link, cookies). Fetching from the agent does not complete the step and may consume or confuse session state.

If your harness has no browser tool:

1. **macOS (Hermes and other CLIs):** `open 'https://…#…'` with the **full** URL in single quotes so the shell does not strip the fragment. Run this only for an `https://` URL on the SohoPay console/consent host returned by the tool, and never when the URL contains a `'` — print it for the operator instead.
2. **Otherwise:** print the full URL for the operator to open on phone or desktop. Do not retype it.

### After opening — poll, do not wait in chat

When a skill says to poll `get_context` or `get_agent_authorization`, do that on a **5 s** interval for the cap that skill states (onboarding handoffs: 15 minutes; agent authorization: 2 minutes), or 10 minutes if it states none. **Do not** ask the borrower to type "done" or end the turn waiting for chat. If the step has not cleared within the cap (or the handoff token has expired), stop polling, tell the operator which step is outstanding, and offer to re-issue the link. Onboarding handoff polling: `{SKILLS_BASE}/borrower-onboard.md` — load `references/onboarding-context.md` ("Connect link", "Facility acceptance").

### Success pages without "return to agent"

Some harnesses (for example **Hermes**, at the time of writing) register only **loopback HTTP** OAuth redirects, not deep links such as `cursor://`. Bank connect and other handoffs may finish on a SohoPay success screen **without** a safe `return_uri`. The **Close** control may only call `window.close()`, which browsers block for user-opened tabs.

**Agent rule:** treat completion from **`get_context`** (or the relevant poll), not from the operator closing a tab. Tell the operator they can close the tab manually (⌘W / Ctrl+W) if the button does nothing; **keep polling** until the connect or facility step clears.

### MCP OAuth login (separate from handoff URLs)

CLI MCP login starts a **local callback listener** on the operator's machine. **Do not run `mcp login` in an agent shell** that may exit in ~30 s — that kills the listener and leaves `ERR_CONNECTION_REFUSED` on `/callback` even when consent succeeded. Operator runs login in a normal Terminal tab; paste the full callback URL if prompted. Defaults and Hermes `oauth.timeout`: `{SKILLS_BASE}/mcp-connect.md` — load `references/harnesses.md` ("OAuth browser login").


<a id="hosted-reference-mobile-host-capabilities"></a>

### Hosted reference: mobile-host-capabilities.md

## Mobile host capability gate

Apply this gate before installing packages, changing MCP configuration, registering a terminal, requesting write scopes, or starting the executable desktop onboarding chain. A phone can use hosted onboarding without installing or executing SKILL.md. Reading instructions, opening a website, and completing OAuth do not by themselves add tools to the originating chat or establish payment readiness.

### Decide from observed capabilities

1. Identify the actual host and surface, not an installed CLI or a user-agent string. Check whether this conversation already exposes the approved SohoPay integration and its authenticated read-only tools. Never claim that a hypothetical tool is callable. Do not probe a payment tool to test connectivity.
2. **No verified integration:** tell the borrower to open the official SohoPay website (sohopay.xyz) and explain: “You can continue on SohoPay's website. This does not connect payment tools to this chat.” For staging, use only the reviewed staging website configured by the operator; never substitute production. Do not invent an activation route, ticket, callback, or deep link. Naming the website is navigation guidance, not a claim that its root is a profile-completion or activation endpoint. If the website offers no enabled onboarding entry, report that limitation and support@sohopay.xyz.
3. **Integration present, signer unavailable or unverified:** perform only authenticated read-only status supported by the installed catalog and granted scope. Open an activation/handoff link only when a supported authorized tool returns it. Do not run desktop commands, generate keys in the model, install a global signer, or create an agent grant to conceal a missing signing runtime. Report `SIGNER_READY` as false/unverified and payment as unavailable.
4. **Verified desktop runtime plus existing signer:** continue the established setup checklist, pinned signer installation rules, borrower authorization and Protocol V2 flow. This mobile guidance does not change desktop key storage, signer pin, spending consent or verifier format.

A future mobile-compatible signer must be separately reviewed against the current authorization and verifier contracts. A web confirmation, passkey assertion, OAuth token or browser session is not an Ed25519 workload voucher signature. Never fall back to a shared/cloud-held signing key.

### State and continuity

Report only server-authoritative states. Keep ACCOUNT_CREATED, IDENTITY_VERIFIED, BANK_CONNECTED, CREDIT_APPROVED, FACILITY_ACCEPTED, AGENT_AUTHORIZED, SIGNER_READY and PAYMENT_READY distinct. Do not infer credit approval from bank connection or payment readiness from a successful account login. Pending, declined, revoked and expired states must remain visible; no invented success receipts.

Use the trusted browser UI for phone OTP, profile, KYC, bank consent, credit acceptance and agent permissions. Never request bank credentials, private keys, signing seeds, legal name, date of birth or OTP in chat. Do not repeat billable checks simply because the app was suspended. Resume from authenticated server state; recover an expired ticket through the supported service, not by editing its URL.

For mobile activation, do not hold the model in a fifteen-minute polling loop. Prefer explicit status refresh when the user returns; if the host supports bounded background status polling, obey the server's retry guidance and stop on completion, expiry, revocation or the bounded cap. Browser navigation and app suspension are not proof of completion. A return-to-assistant action is offered only for a verified host-supported return target; it need not restore the original conversation.

A handoff URL must come from a trusted, authenticated service, preserve its opaque ticket exactly and stay within the configured origin/redirect allowlist. Never append OAuth tokens, credentials, private keys or borrower details to a URL. Do not log or send handoff tickets to analytics.

### Accurate payment language

A2A credit allocation and merchant x402 spending are distinct operations. Existing A2A allocation is not a generic withdrawable on-chain USDC transfer. Show the operation and actual server receipt; “send 20 USDC” must not be silently mapped to a credit allocation.

### Host availability is a verification gate

As checked on 2026-11-12, OpenAI's custom-MCP documentation describes creation/connection on web, while Anthropic documents remote connectors across mobile and other Claude surfaces. These statements are not a certification of SohoPay on either mobile app. Account/workspace permissions, enabled tools, OAuth, signing, callback behavior and actual iOS/Android runs must be verified before marking a host supported. Never instruct an unsupported fresh chat to inject tools into itself.


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

**What this check does — and does not — prove.** Fetching `SECURITY.md` from the same origin that serves these docs is a consistency check, not cryptographic authentication: a compromised or spoofed origin would serve a matching `SECURITY.md` too, so it cannot by itself prove you are talking to SohoPay. Until the signed checksum manifest below ships, treat this as trust-on-first-use — pin to a reviewed commit SHA, prefer an origin the operator already trusts, and escalate to the operator if anything about the host looks off.

Do **not** fetch or clone `sohopay-mcp-server` on the hosted path. That repository is private; a 404 from https://github.com/sohopay/sohopay-mcp-server is expected and is **not** a failed check.

For reproducibility, pin fetches to a commit SHA you have reviewed rather than a mutable branch, e.g. `https://raw.githubusercontent.com/sohopay/skills/<commit-sha>/setup.md`. A signed checksum manifest is planned; until it ships, pin to a reviewed SHA. Questions, or something that looks wrong: support@sohopay.xyz.

## Step 1: Identify the harness

The harness is **the agent environment actually executing this document** — not merely a tool installed on the machine. You most likely already know which you are: Claude Code, Cursor, Codex, Hermes, or the ChatGPT desktop app. **Start from that self-knowledge.**

**Claude.ai chat is not Claude Code.** Remote connectors may be available through the Claude account, but there is no `claude mcp` configuration to write in that chat. Follow the host capability gate in the setup skill first. Use only a verified, authenticated SohoPay tool already exposed to this conversation. Without that integration, stop executable setup and show the official website fallback. Do not infer signer availability from remote MCP connectivity.

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
- **GUI clients are not on `PATH` and will not appear above.** If you are running inside the **ChatGPT app** (where integration availability depends on the current surface and account), the commands above detect only installed CLIs — ChatGPT itself won't show up. Treat `chatgpt` as the harness and follow its connector path in `mcp-connect.md`; do not pick a CLI you don't actually use.

## Step 2: Check prerequisites

Required for the default hosted path: **network access** (ability to fetch skill docs and reach the MCP origin). Do not install Node for its own sake, and do not run `node --version` except as part of the signer install below.

When `sohopay-signer` is missing, or `sohopay-signer capabilities --output json` reports an `implementation_version` older than `0.3.1`, run this command yourself and continue the checklist in the same turn. Do not stop. Do not ask the operator to run it or to reply:

```bash
npm i -g @sohopay/agent-signer@0.3.1
```

Then confirm `sohopay-signer capabilities --output json` answers `signer_protocol` `sohopay-signer/1` at `implementation_version` `0.3.1` or newer, and go on to MCP registration. Run exactly that command: never use `sudo`, never change the npm prefix, registry or auth, and never install from another source. If the install fails for any reason, stop and show that same command. ChatGPT has no local install: skip the signer and say so (key generation there stops with `SIGNER_KEYGEN_REQUIRES_LOCAL`). `install.sh` may also install this pin when an operator runs the installer. If that version is already on `PATH`, do not install it again.


<a id="hosted-reference-report"></a>

### Hosted reference: report.md

## Report to the operator

One short summary. No architecture recap.

- Sticky skills: installed path, or **skipped**
- Signer: installed version, or that the install failed (ChatGPT skips it)
- MCP: server id + URL
- Borrower status if you onboarded, and whether the **agent grant is ACTIVE** (onboarding is incomplete until it is)
- Failures: exact URL and error
- Repayment is due weekly, on Sunday, settled by the operator
- **Onboarding complete? End with the dashboard invitation** (skip it on an incomplete / failed onboarding): the “📊 Explore your web dashboard” block from **sohopay-onboard** step 9, with `{BORROWER_PORTAL_URL}` resolved from the environment row in **sohopay-mcp-connect** (staging: `https://staging.borrower.sohopay.xyz/`). No portal for the environment → no invitation; never point a production borrower at the staging portal


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

