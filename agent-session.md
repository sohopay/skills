<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Delegated Agent Sessions

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**What this skill does:** creates, reads, and revokes borrower-approved agent sessions. **Before running it:** the borrower is onboarded (`borrower-onboard.md`) and holds a token with `session:*` scopes.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

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

## Consent

Creating a delegated session grants an agent spending authority on the borrower's behalf. Before creating the session:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

## Security

- ALWAYS validate session ownership on read/revoke
- ALWAYS include idempotency keys on create/revoke
- NEVER reuse a revoked session ID
- Revoke sessions promptly when agent task completes

## Next steps

- Spend and pay: `curl -fsSL {SKILLS_BASE}/spend-and-pay.md`
- Setup index: `curl -fsSL {SKILLS_BASE}/setup.md`
