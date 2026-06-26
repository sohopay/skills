---
name: sohopay-integrate
description: Integrates AI agents with SohoPay MCP gateway, borrower onboarding, delegated sessions, spend/policy/payment flows, and x402 on-chain settlement. Use when building SohoPay borrowers, agent sessions, wallet-proof signing, MCP scopes, or HTTP 402 credit payments.
---

# SohoPay Integration

Hosted skills are the source of truth at `https://agents.sohopay.xyz`.

## Bootstrap

Run the setup skill:

```bash
curl -sL https://agents.sohopay.xyz/skills/setup.md
```

Browse the skill index:

```bash
curl -sL https://agents.sohopay.xyz/.well-known/agent-skills/index.json
```

## Quick reference

| Task | Hosted skill |
|------|----------------|
| MCP connection | [mcp-connect.md](https://agents.sohopay.xyz/skills/mcp-connect.md) |
| Borrower onboarding | [borrower-onboard.md](https://agents.sohopay.xyz/skills/borrower-onboard.md) |
| Agent sessions | [agent-session.md](https://agents.sohopay.xyz/skills/agent-session.md) |
| Spend / pay | [spend-and-pay.md](https://agents.sohopay.xyz/skills/spend-and-pay.md) |
| x402 settlement | [x402-credit-pay.md](https://agents.sohopay.xyz/skills/x402-credit-pay.md) |
| Idempotency | [idempotency.md](https://agents.sohopay.xyz/skills/idempotency.md) |

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

- MCP server: [soho-mcp-server](https://github.com/sohopay/soho-mcp-server)
- Backend: [sohopay-backend](https://github.com/sohopay/sohopay-backend)
- Endpoints: [docs/endpoints.md](https://github.com/sohopay/skills/blob/main/docs/endpoints.md)
