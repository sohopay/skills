# Skill: SohoPay x402 v2 Credit Settlement

HTTP 402 Payment Required — credit scheme. Routes under `/api/v2/x402/`.

Distinct from MCP: x402 serves HTTP-native paywalls; MCP serves agent orchestration. A payer may use both.

## Prerequisites

- Active row in `wallets` linked to a SohoPay User
- On-chain creditor registration **alone is insufficient**
- EIP-712 signature on every settlement request
- Server-side nonce table — check before any chain call

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v2/x402/check-eligibility` | Pre-flight eligibility |
| POST | `/api/v2/x402/check-nonce` | Nonce availability |
| POST | `/api/v2/x402/verify` | Full verification |
| POST | `/api/v2/x402/settle` | Submit on-chain spend |
| GET | `/api/v2/x402/health` | Liveness |

Base URL: `https://api.sohopay.xyz/api/v2/x402/` (production)

## Verify flow

`POST /verify` with payment payload.

Unlinked wallets return HTTP 200 with `isValid: false`:

- `BORROWER_WALLET_UNKNOWN`
- `BORROWER_WALLET_NOT_VERIFIED`

Always verify before settle.

## Settle flow

1. Run `/verify` — must pass
2. Attach `Idempotency-Key` (UUID v4) — check **before** `writeContract()`
3. `POST /settle` with signed EIP-712 payload
4. Requires JWT + 2FA on settle route
5. Success: `202 Accepted` with `{ txHash, jobId }` — poll status; do not treat hash alone as settled

On-chain idempotency TTL: 72h (`ON_CHAIN_TTL_MS`).

## Policy denial

HTTP 403 with `reasonCodes` and `policyDecisionId` — surface to user; do not retry blindly.

## Integration checklist

- [ ] Payer wallet linked and verified in SohoPay
- [ ] Nonce not reused
- [ ] Idempotency-Key on settle
- [ ] 2FA verified on JWT for settle
- [ ] Poll confirmation job
- [ ] Handle policy 403 with reason codes

## Next steps

- Idempotency detail: `curl -sL https://agents.sohopay.xyz/skills/idempotency.md`
- MCP setup: `curl -sL https://agents.sohopay.xyz/skills/setup.md`
