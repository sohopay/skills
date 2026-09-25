

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

`register_borrower`, `request_borrower_token`, `register_agent_workload_key`, `request_signature_challenge`, `submit_signature`, `create_agent_session`, `revoke_session`, `create_spend_intent`, `evaluate_spend_policy`, `prepare_x402_payment`, `execute_payment`, `sign_transaction`, `approve_credit_limit`, `create_repayment`, `execute_repayment`, `request_repayment`, `authorize_agent`

## Client guidance

1. Fresh UUID v4 per logical operation
2. Reuse the same key when retrying after network failure (**identical body**)
3. New key for genuinely new operations
4. Never cache error responses — only successful completions replay
5. On merchant **202** x402 unlock, retry the **same payment envelope** (merchant derives a stable idempotency key from `paymentId`) — do not mint a new spend intent

Request body hash: RFC 8785 canonical JSON + SHA-256 on backend.

## Next steps

- Setup: `curl -fsSL {SKILL:sohopay-setup}`
- Spend / pay: `curl -fsSL {SKILL:sohopay-spend}`
