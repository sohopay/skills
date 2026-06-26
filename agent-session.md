# Skill: SohoPay Delegated Agent Sessions

Delegated sessions let an agent act on behalf of a borrower within borrower-approved constraints.

## Prerequisites

- Borrower registered with `borrowerId` (UUID)
- OAuth/JWT for borrower (transport auth to MCP)
- Scope `session:create` for creation; `session:read` / `session:revoke` for read/revoke

## MCP tools

| Tool | Scope | Idempotent |
|------|-------|:----------:|
| `create_agent_session` | session:create | Yes |
| `get_session_context` | session:read | No |
| `revoke_session` | session:revoke | Yes |

## Backend endpoints

| Method | Path |
|--------|------|
| POST | `/api/v1/sessions/agent` |
| GET | `/api/v1/sessions/:id` |
| POST | `/api/v1/sessions/:id/revoke` |

Session DTOs use `borrower_id` (UUID) — **never** wallet address.

## Required headers

```http
Authorization: Bearer <jwt>
x-soho-service-token: <mcp-service-token>
x-soho-borrower-id: <borrower-uuid>
Idempotency-Key: <uuid-v4>   # on create and revoke
```

Delegated tool calls also require a valid session ID (`x-session-id` or MCP session context).

## Principal model

```text
Principal = authenticated caller
Borrower  = credit/fund owner
Executor  = action performer
```

Supported patterns include human-owned credit with agent executor (`Principal=HUMAN, Borrower=HUMAN, Executor=AGENT`).

## Security

- ALWAYS validate session ownership on read/revoke
- ALWAYS include idempotency keys on create/revoke
- NEVER reuse a revoked session ID
- Revoke sessions promptly when agent task completes

## Next steps

- Spend and pay: `curl -sL https://agents.sohopay.xyz/skills/spend-and-pay.md`
- Setup index: `curl -sL https://agents.sohopay.xyz/skills/setup.md`
