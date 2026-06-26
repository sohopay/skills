# Skill: SohoPay Idempotency

Required on every endpoint that creates or mutates money, credit, or on-chain state.

## Header contract

```http
Idempotency-Key: <uuid-v4>
```

- Format: UUID v4, max 64 chars
- Scope: `(userId, key)` — MCP routes use resolved `borrowerId` from `x-soho-borrower-id`
- Missing: `400 IDEMPOTENCY_KEY_MISSING`
- Invalid: `400 IDEMPOTENCY_KEY_INVALID`

## Response semantics

| Situation | HTTP | Behavior |
|-----------|------|----------|
| Duplicate in flight | 409 | `IDEMPOTENCY_REQUEST_IN_FLIGHT` |
| Same key + same body (complete) | Replay | Cached response + `X-Idempotent-Replayed: true` |
| Same key + different body | 409 | `IDEMPOTENCY_KEY_CONFLICT` |
| Failed request | — | PENDING deleted; retry with same key allowed |

## TTL

| Class | TTL |
|-------|-----|
| Default financial writes | 24h |
| On-chain writes (x402 settle) | 72h |

## MCP routes requiring idempotency

- `POST /signature/challenge`, `/signature/submit`
- `POST /sessions/agent`, `/sessions/:id/revoke`
- `POST /spend/intents`, `/policy/evaluate`
- `POST /payments/execute`, `/signing/request`, `/credit/approve-limit`

## Client guidance

1. Fresh UUID v4 per logical operation
2. Reuse same key when retrying after network failure (identical body)
3. New key for genuinely new operations
4. Never cache error responses — only successful completions replay

Request body hash: RFC 8785 canonical JSON + SHA-256 on backend.

## Next steps

- Setup: `curl -sL https://agents.sohopay.xyz/skills/setup.md`
