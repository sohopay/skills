---
name: sohopay-integrate
description: Integrates AI agents with SohoPay MCP gateway, borrower onboarding, delegated sessions, spend/policy/payment flows, and x402 on-chain settlement. Use when building SohoPay borrowers, agent sessions, wallet-proof signing, MCP scopes, or HTTP 402 credit payments.
---

# SohoPay Integration

Skill docs are served from raw GitHub in dev and from `https://agents.sohopay.xyz/skills/v1` at launch. Set `SKILLS_BASE` to whichever base you are using:

```
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main
```

## Bootstrap

Run the setup skill (substitute `SKILLS_BASE`):

```bash
curl -fsSL https://raw.githubusercontent.com/sohopay/skills/main/setup.md
```

Browse the skill index:

```bash
curl -fsSL https://raw.githubusercontent.com/sohopay/skills/main/.well-known/agent-skills/index.json
```

If any fetch fails (non-2xx, HTML content, or empty body), STOP and report the exact URL to the operator; suggest support@sohopay.xyz. Never turn off permission prompts or run in a bypass mode.

## Local bundle (read these first)

The full skill docs are shipped **with this package** under `docs/` — installed to `~/.agents/skills/sohopay-integrate/docs/` (or wherever `npx skills add` placed it). **Read them from disk first;** fetch over the network only if the local copy is missing. This keeps setup working in sandboxed harnesses whose fetch tool returns `Cache miss`.

## Quick reference

Read each from the local bundle first, falling back to the network — e.g.
`cat ~/.agents/skills/sohopay-integrate/docs/<file> 2>/dev/null || curl -fsSL {SKILLS_BASE}/<file>`:

| Task | Skill file |
|------|------------|
| MCP connection | `mcp-connect.md` |
| Borrower onboarding | `borrower-onboard.md` |
| Human-direct (no session) | `human-direct-flow.md` |
| Agent sessions | `agent-session.md` |
| Spend / pay | `spend-and-pay.md` |
| x402 settlement | `x402-credit-pay.md` |
| Idempotency | `idempotency.md` |

## Critical rules

1. **borrowerId is UUID** — never use wallet address as primary identity.
2. **Never hold borrower private keys** — MCP transports signatures only.
3. **Idempotency-Key** on every mutating financial/on-chain route.
4. **Resolve authz fresh** — `POST /api/v1/auth/authorization-context` before privileged tools.
5. **x402** — verify before settle; poll confirmation; 72h on-chain idempotency TTL.

## Install (sticky)

```bash
npx skills add sohopay/skills -g -y
```

## Additional resources

- MCP server: [sohopay-mcp-server](https://github.com/sohopay/sohopay-mcp-server)
- Backend: [sohopay-backend](https://github.com/sohopay/sohopay-backend)
- Endpoints: [docs/endpoints.md](https://github.com/sohopay/skills/blob/main/docs/endpoints.md)
