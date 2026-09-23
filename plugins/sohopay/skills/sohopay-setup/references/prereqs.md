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
