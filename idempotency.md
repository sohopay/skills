<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Idempotency

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**What this skill does:** defines the `Idempotency-Key` contract for financial and on-chain routes. **Before running it:** no prerequisites — reference this before any mutating call.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

Required on every MCP **write** tool and every backend route that creates or mutates money, credit, or on-chain state (except the exempt routes below).

## How to supply the key (minimal effort)

| Path | When to use |
|------|-------------|
| Tool argument `idempotency_key` | **Preferred for Cursor, ChatGPT, and any harness that cannot set custom HTTP headers.** UUID v4 in the tool call body. |
| HTTP `Idempotency-Key` or `x-idempotency-key` | Harnesses / clients that can set headers (Claude Code headless with headers, curl, custom clients). |

Rules:

1. Format: **UUID v4**, max 64 chars.
2. If both header and tool arg are present, they **must match** or the MCP server errors.
3. Omitting the key on a write tool fails with a missing-key error — the server does **not** auto-generate one.
4. Scope: **`(userId, key)`** — not global, not path-scoped. Same key + **different body** → `409 IDEMPOTENCY_KEY_CONFLICT`. Same key + same body (complete) → cached replay + `X-Idempotent-Replayed: true`.

```http
Idempotency-Key: <uuid-v4>
```

MCP also accepts / dual-sends `x-idempotency-key`. The tool field is stripped before the body is forwarded to the backend.

## Response semantics

| Situation | HTTP | Behavior |
|-----------|------|----------|
| Missing key | 400 | `IDEMPOTENCY_KEY_MISSING` |
| Invalid key | 400 | `IDEMPOTENCY_KEY_INVALID` |
| Duplicate in flight | 409 | `IDEMPOTENCY_REQUEST_IN_FLIGHT` |
| Same key + same body (complete) | Replay | Cached response + `X-Idempotent-Replayed: true` |
| Same key + different body | 409 | `IDEMPOTENCY_KEY_CONFLICT` |
| Failed request | — | PENDING deleted; retry with same key allowed |

## Per-route TTL

| Route | TTL |
|-------|-----|
| `POST /api/v1/policy/evaluate` | **300s** |
| `POST /api/v1/signature/challenge` | **600s** |
| `POST /api/v1/signature/submit` | **600s** |
| Default financial MCP writes (sessions, spend intents, signing, credit approve, repayments prepare) | **24h** |
| `POST /api/v1/payments/execute` | **72h** |
| `POST /api/v2/x402/settle` (+ legacy `/api/v1/x402/v2/settle`) | **72h** |
| `POST /api/v1/facilitator/settle` | **72h** (scoped to merchant `userId`) |

## Exempt (no Idempotency-Key required)

- `POST /api/v1/borrowers/register`
- `POST /api/v1/borrowers/token`
- `POST /api/v1/merchants/register`

Note: MCP may still treat some of these as write tools and require `idempotency_key` at the MCP layer — when the tool schema or runtime asks for it, supply one.

## MCP write tools that require idempotency

`register_borrower`, `request_borrower_token`, `request_signature_challenge`, `submit_signature`, `create_agent_session`, `revoke_session`, `create_spend_intent`, `evaluate_spend_policy`, `execute_payment`, `sign_transaction`, `approve_credit_limit`, `create_repayment`, `execute_repayment`

## Client guidance

1. Fresh UUID v4 per logical operation
2. Reuse the same key when retrying after network failure (**identical body**)
3. New key for genuinely new operations
4. Never cache error responses — only successful completions replay
5. On merchant **202** x402 unlock, retry the **same payment envelope** (merchant derives a stable idempotency key from `paymentId`) — do not mint a new spend intent

Request body hash: RFC 8785 canonical JSON + SHA-256 on backend.

## Next steps

- Setup: `curl -fsSL {SKILLS_BASE}/setup.md`
- Spend / pay: `curl -fsSL {SKILLS_BASE}/spend-and-pay.md`
