<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Borrower Onboarding

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**What this skill does:** registers a borrower and completes wallet proof so scope-gated tokens can be issued. **Before running it:** the MCP server is connected (`mcp-connect.md`).

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

Canonical identity: **borrowerId = User.id (UUID)**. Wallet is a verified credential, not the primary identifier.

## Workflow

1. **Register** — `POST /api/v1/borrowers/register`
2. **Wallet proof** — challenge → sign off-device → submit
3. **Status** — `GET /api/v1/borrowers/:id/status`
4. **Token** — `POST /api/v1/borrowers/token` with `requested_scopes[]`
5. **Authz** — `POST /api/v1/auth/authorization-context` before privileged tools

All MCP gateway paths require `x-soho-service-token`. Borrower-scoped routes also need `x-soho-borrower-id`.

## Register borrower

`POST /api/v1/borrowers/register`

Body (snake_case): `borrower_type`, `wallet_address`, `email`, `username`, `network`, `wallet_type`, `country`

Borrower types: `HUMAN`, `AGENT`, `BUSINESS`

## Wallet proof (EIP-712)

| Step | Endpoint | Idempotent |
|------|----------|:----------:|
| Challenge | `POST /api/v1/signature/challenge` | Yes |
| Submit | `POST /api/v1/signature/submit` | Yes |

Flow:

1. Challenge returns `challenge_id`, `nonce`, `typed_data`, `expires_at`
2. Borrower signs EIP-712 **off-device** (wallet/app — never in MCP)
3. Submit `{ challenge_id, signature }` → `{ verified, wallet_address }`

Before requesting the signature:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

## Request borrower token

`POST /api/v1/borrowers/token`

Body: `borrower_id` (UUID), `requested_scopes[]`

Response: `access_token`, `token_type`, `expires_in`, `borrower_id`, `scopes[]`, optional `dropped_scopes[{scope, reason}]`

The token grants real spending scopes. Before requesting it:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

### Dropped scope reason codes

| Code | Meaning |
|------|---------|
| `WALLET_PROOF_REQUIRED` | Complete signature challenge first |
| `KYC_NOT_APPROVED` | KYC not APPROVED |
| `PREQUAL_DECLINED` | Prequal declined |
| `STATE_UNAVAILABLE` | Gate state unreadable — fail closed |

Ungated scopes are **dropped, not fatal**. Re-request after wallet proof or KYC completes.

## Authorization context

`POST /api/v1/auth/authorization-context`

Returns live `{ permissions, scopes, roles, borrower_status, frozen, suspended, active, ... }`.

JWT stays thin — always resolve fresh before privileged MCP tools.

## Scope gates (summary)

| Scope | Wallet proof | KYC approved |
|-------|:------------:|:------------:|
| session:* | — | — |
| spend:intent:create | ✅ | ✅ |
| payment:execute | ✅ | ✅ (+ 2FA-equiv) |
| signing:request | ✅ | — (+ 2FA-equiv) |
| credit:approve | — | ✅ (+ 2FA-equiv) |
| repayment:execute | ✅ | NOT KYC-gated |

## MCP tools (via sohopay-mcp-server)

| Tool | Purpose |
|------|---------|
| `register_borrower` | Register HUMAN/AGENT/BUSINESS |
| `request_signature_challenge` | Start wallet proof |
| `submit_signature` | Complete wallet proof |
| `get_borrower_status` | Onboarding status |
| `request_borrower_token` | Scope-gated token |

## Next steps

- Agent session: `curl -fsSL {SKILLS_BASE}/agent-session.md`
- Idempotency: `curl -fsSL {SKILLS_BASE}/idempotency.md`
