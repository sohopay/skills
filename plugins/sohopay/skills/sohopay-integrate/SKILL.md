---
name: sohopay-integrate
description: Integrates AI agents with the SohoPay MCP gateway, borrower onboarding, spend/policy/signing flows, and x402 on-chain settlement. Use when building SohoPay borrowers, wallet-proof signing, MCP scopes, or HTTP 402 credit payments.
---

# SohoPay Integration

Skill docs are served from raw GitHub in dev and from `https://agents.sohopay.xyz/skills/v1` at launch. Set `SKILLS_BASE` to whichever base you are using:

```
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main
```

## Bootstrap

Paste into the agent (production):

```
Fetch https://raw.githubusercontent.com/sohopay/skills/main/setup.md and
follow the instructions in it to set up SohoPay in this environment.
```

Paste into the agent (**staging** — internal full-stack E2E against `staging.mcp` / `staging.api`):

```
Fetch https://raw.githubusercontent.com/sohopay/skills/main/setup-staging.md and
follow the instructions in it to set up SohoPay in this environment.
```

Or curl the same URLs:

```bash
curl -fsSL https://raw.githubusercontent.com/sohopay/skills/main/setup.md
curl -fsSL https://raw.githubusercontent.com/sohopay/skills/main/setup-staging.md
```

Browse the skill index:

```bash
curl -fsSL https://raw.githubusercontent.com/sohopay/skills/main/.well-known/agent-skills/index.json
```

If any fetch fails (non-2xx, HTML content, or empty body), STOP and report the exact URL to the operator; suggest support@sohopay.xyz. Never turn off permission prompts or run in a bypass mode.

## Local bundle (read these first)

The full skill docs are shipped **with this package** under `docs/` — installed to `~/.claude/skills/sohopay-integrate/docs/` for Claude Code (`-g -a claude-code`), or `~/.agents/skills/sohopay-integrate/docs/` (or wherever `npx skills add` placed it). **Read them from disk first;** fetch over the network only if the local copy is missing. This keeps setup working in sandboxed harnesses whose fetch tool returns `Cache miss`.

## Quick reference

Read each from the local bundle first, falling back to the network — e.g.
`cat ~/.claude/skills/sohopay-integrate/docs/<file> 2>/dev/null || cat ~/.agents/skills/sohopay-integrate/docs/<file> 2>/dev/null || curl -fsSL {SKILLS_BASE}/<file>`:

| Task | Skill file |
|------|------------|
| MCP connection | `mcp-connect.md` |
| Staging setup | `setup-staging.md` |
| Staging MCP connection | `mcp-connect-staging.md` |
| Borrower onboarding | `borrower-onboard.md` |
| Human-direct (default operate path) | `human-direct-flow.md` |
| Spend / pay | `spend-and-pay.md` |
| x402 settlement | `x402-credit-pay.md` |
| Idempotency | `idempotency.md` |

## Critical rules

1. **Tool descriptions vs skills** — After MCP connect, use tool `description` / input schemas for single call-time rules. For multi-step or money-moving flows, **fetch** the matching skill from `SKILLS_BASE` (network is normal; local sticky copy under `sohopay-integrate/docs/` if present). MCP initialize `instructions` may repeat this pointer — follow it.
2. **borrowerId is UUID** — never use wallet address as primary identity. `whoami` often omits `borrower_id`; use `principal_id` (human-direct only — in delegated sessions that is the agent, not the credit owner).
3. **Never hold borrower private keys** — MCP transports signatures only.
4. **Idempotency-Key** on every mutating financial/on-chain route.
5. **Resolve authz fresh** — `POST /api/v1/auth/authorization-context` before privileged tools. The borrower token is short-lived (staging 15 min, no refresh) — re-request before each spend; it is not the harness OAuth token.
6. **x402** — HTTP 402 merchant URLs use merchant-as-settler (`X-PAYMENT`); never `execute_payment` or a session on human-direct. Verify before settle; poll confirmation under **`l2_confirmations`** (~5s typical, P95 under 30s); 72h on-chain idempotency TTL. On a payRequest, refresh `request_borrower_token` without a STOP when scopes are only `borrower:token`.
7. **Signing** — pass `policy_decision_id` to `sign_transaction` (it does not accept `spend_intent_id`); `payload` must be a JSON object (`{}` ok, never a string); build `X-PAYMENT` from the returned `payment_intent` echo plus `get_signing_status.signature`.
8. **Human-direct** — skip session tools; if `whoami` shows only `borrower:token`, request spend/policy/signing scopes before spending.
9. **First-time merchant** — `RISK_FIRST_TIME_MERCHANT` needs a once-per-merchant operator accept ("please accept first-time spend for this merchant"). After they accept, complete later x402 pays to that merchant with **no** further operator questions (token refresh, signing, `X-PAYMENT`). Signing-time ALLOW can still DENY at x402 settle (UUID vs bytes32 `merchantId`); mint a new `X-PAYMENT` after consent without re-asking, do not replay a cached 403. See `spend-and-pay.md` and `x402-credit-pay.md`.

## Install (sticky)

```bash
npx skills add sohopay/skills -g -y -a claude-code   # Claude Code; use -a cursor / -a codex / -a hermes-agent for those harnesses
```

## Additional resources

- MCP server: [sohopay-mcp-server](https://github.com/sohopay/sohopay-mcp-server)
- Backend: [sohopay-backend](https://github.com/sohopay/sohopay-backend)
- Endpoints: [docs/endpoints.md](https://github.com/sohopay/skills/blob/main/docs/endpoints.md)
