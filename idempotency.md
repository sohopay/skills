<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1
     SKILLS_HOST (CDN origin): https://agents.sohopay.xyz
     Fetch order: local sticky → {SKILLS_BASE} → GitHub raw last-resort.
     Publish rewrites SKILLS_BASE to Prod and {SKILLS_HOST} to the origin. -->
<!-- Generated from plugins/sohopay/skills — do not hand-edit this file. Run npm run generate:hosted -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Idempotency

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

On every MCP **write**, pass `idempotency_key` (UUID v4) in the tool args when the harness cannot set headers. If you also set `Idempotency-Key`, the values must match.

- Same key + same body → replay.
- Same key + different body → `409 IDEMPOTENCY_KEY_CONFLICT`.
- Network retry of the same call → **reuse** the key. New operation → new key.
- 402 merchant **202** → replay the **same** payment header. Do not mint a new spend.
- `authorize_agent` challenge and submit are two writes → two keys.
- `request_repayment` challenge and submit are two writes → two keys.

TTL table: [references/ttl.md](#hosted-reference-ttl).

---

## Hosted references (load only when the skill says to)

Native Agent Skills read these from `references/` on demand. This hosted export inlines them so `curl -fsSL` bootstrap still works.

<a id="hosted-reference-ttl"></a>

### Hosted reference: ttl.md



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

- Setup: `curl -fsSL {SKILLS_BASE}/setup.md`
- Spend / pay: `curl -fsSL {SKILLS_BASE}/spend-and-pay.md`

