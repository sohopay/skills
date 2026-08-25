<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Delegated Agent Sessions

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**What this skill does:** creates, reads, and revokes borrower-approved agent sessions. **Before running it:** the borrower is onboarded (`borrower-onboard.md`) and holds a token with `session:*` scopes.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

Delegated sessions let an agent act on behalf of a borrower within borrower-approved constraints.

Pass `idempotency_key` (UUID v4) on create/revoke when the harness cannot set HTTP headers — see `{SKILLS_BASE}/idempotency.md`.

## Session ID disambiguation (critical)

| Identifier | What it is | Where it appears |
|------------|------------|------------------|
| `Mcp-Session-Id` | **MCP transport** session (HTTP stream) | Response header from MCP `initialize` |
| `session_id` / `x-session-id` | **SohoPay delegated agent session** | Tool argument and/or header on spend/payment/signing |

Never pass an MCP transport session id as SohoPay `session_id`. Never confuse the two when debugging auth.

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

### When to use sessions (and when not to)

Sessions are **only** for **delegated agent executors** acting on a borrower's credit. Human-direct spend and HTTP 402 merchant paywalls do **not** need a session — follow `{SKILLS_BASE}/human-direct-flow.md` and `{SKILLS_BASE}/x402-credit-pay.md`.

Do **not** create a session to “fix” `SESSION_GATE_SKIPPED_NO_SESSION` on a human-direct / merchant-demo paywall. Re-check: principal type, whether spend scopes were requested (`borrower:token` alone is not enough), and whether `session_id` was incorrectly assumed. For 402 URLs, use merchant-as-settler (`X-PAYMENT`) without `create_agent_session`.

### create_agent_session fields

Aligns with backend `CreateAgentSessionDto` (`POST /api/v1/sessions/agent`):

| Field | Required | Notes |
|-------|:--------:|-------|
| `borrower_id` | ✅ | Borrower UUID |
| `agent_id` | ✅ | Agent id string (`^[a-zA-Z0-9_-]+$`, max 64) — **not** a borrower UUID |
| `max_per_tx` | — | uint256 base-units digit string |
| `period_limit` | — | uint256 base-units digit string |
| `period_duration_sec` | — | number |
| `allowed_merchant` | — | single merchant (bytes32/address string) |
| `allowed_asset` | — | optional asset constraint |
| `valid_after` / `valid_until` | — | **unix timestamp strings** (`^\d{1,10}$`), not RFC3339 |
| `constraint` | — | optional nested `{ max_amount_per_tx, period_limit, period_hours, max_tx_count, allowed_merchants[] }` |
| `idempotency_key` | — | UUID v4 when the harness cannot set headers |

Do **not** send `permissions`, `daily_limit`, `currency`, or top-level `allowed_merchants` — the backend rejects unknown keys.

`get_session_context` and `revoke_session` take **`session_id` only** — neither accepts `borrower_id`.

### revoke_session response

**HTTP 200** (not 204):

```json
{ "session_id": "…", "status": "REVOKED", "revoked_at": "…" }
```

Body requires `reason` (string) plus `session_id` / `idempotency_key` as applicable.

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
x-session-id: <delegated-session-uuid>   # on delegated spend/pay/sign
```

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
