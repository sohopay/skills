<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay x402 v2 Credit Settlement

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**What this skill does:** performs HTTP 402 verify + settle for credit-scheme payments. **Before running it:** the payer wallet is linked and verified in SohoPay.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

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

Base URL (production): `https://api.sohopay.xyz/api/v2/x402/`

Base URL (staging): `https://staging.api.sohopay.xyz/api/v2/x402/` — use this when following `setup-staging.md`.

## Verify flow

`POST /verify` with payment payload.

Unlinked wallets return HTTP 200 with `isValid: false`:

- `BORROWER_WALLET_UNKNOWN`
- `BORROWER_WALLET_NOT_VERIFIED`

Always verify before settle.

## Settle flow

The settle route moves real credit on-chain and requires a signed EIP-712 payload. Before calling `/settle`:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

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

- Idempotency detail: `curl -fsSL {SKILLS_BASE}/idempotency.md`
- MCP setup: `curl -fsSL {SKILLS_BASE}/setup.md`
