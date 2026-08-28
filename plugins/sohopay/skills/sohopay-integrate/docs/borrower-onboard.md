<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Borrower Onboarding

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**What this skill does:** registers a borrower and completes wallet proof so scope-gated tokens can be issued. **Before running it:** the MCP server is connected (`mcp-connect.md`).

MCP tool descriptions summarize call-time rules for each onboarding tool; **this skill is authoritative** for ordering, STOP gates, and dropped-scope handling.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

Canonical identity: **borrowerId = User.id (UUID)**. Wallet is a verified credential, not the primary identifier.

Pass `idempotency_key` (UUID v4) on write tools when the harness cannot set HTTP headers — see `{SKILLS_BASE}/idempotency.md`.

## Workflow

0. **`whoami`** — if already authenticated, read identity / scopes from JWT claims; skip register when the borrower already exists. Read the caveats below before trusting the fields.
1. **Register** — `register_borrower` / `POST /api/v1/borrowers/register`
2. **Wallet proof** — challenge → sign off-device → submit
3. **Status** — `get_borrower_status` / `GET /api/v1/borrowers/:id/status`
4. **Token** — `request_borrower_token` / `POST /api/v1/borrowers/token` with `requested_scopes[]`
5. **Authz** — `POST /api/v1/auth/authorization-context` before privileged tools

All MCP gateway paths require `x-soho-service-token` (set by the MCP server). Borrower-scoped routes also need `x-soho-borrower-id`.

## whoami — what it actually returns

`whoami` reads **thin JWT claims only** and never calls the backend, so several fields are frequently absent or `null` even for a fully onboarded borrower:

```json
{
  "identity_source": "jwt_claims",
  "principal_id": "…", "executor_id": "…",
  "wallet": null, "principal_type": null,
  "scopes": ["borrower:token"], "roles": []
}
```

| Field | Caveat |
|-------|--------|
| `borrower_id` | **May be missing entirely** when the token carries no borrower claim. Do not assume the key exists. |
| `wallet` | Commonly `null` even when wallet proof is verified — the wallet is backend state, not a token claim. |
| `principal_type` | `null` unless the claim is present. |
| `scopes` | Token claims, **not** live grants. A fresh token may hold only `borrower:token`. |

### Resolving borrower_id from whoami

**Use `principal_id` as the `borrower_id`.** In the human-direct flow the authenticated caller *is* the borrower, so `principal_id` and `executor_id` both carry the borrower UUID, and `whoami` typically omits `borrower_id` altogether. Feed `principal_id` straight into `get_borrower_status`, `create_spend_intent`, `sign_transaction`, and every other tool that takes `borrower_id`.

```text
borrower_id = whoami.borrower_id ?? whoami.principal_id
```

This substitution holds for the human-direct flow (the default), where the caller is the borrower. If you ever hold an explicit `borrower_id` that differs from `principal_id`, use the explicit `borrower_id` — `principal_id` identifies the caller, not necessarily the credit owner.

**Wallet and onboarding state:** `whoami` cannot supply these. Call `get_borrower_status`, which returns `wallet_address`, `kyc_status`, `prequal_status`, and `wallet_proof_verified` from the backend.

## Register borrower

`POST /api/v1/borrowers/register` via tool `register_borrower`

**MCP `borrower_type`:** `HUMAN` | `AGENT` | `BUSINESS`  
**Backend also accepts** `INDIVIDUAL` (alias for human); prefer the MCP values when calling tools.

Typical MCP fields (execute-time): `borrower_type`, `display_name`, `wallet_address`, `requested_scopes[]`; `callback_url` required for `AGENT`; business fields for `BUSINESS`.

## Wallet proof (EIP-712)

| Step | MCP tool | Backend | Idempotent |
|------|----------|---------|:----------:|
| Challenge | `request_signature_challenge` | `POST /api/v1/signature/challenge` | Yes |
| Submit | `submit_signature` | `POST /api/v1/signature/submit` | Yes |

Flow:

1. Challenge returns `challenge_id`, `nonce`, `typed_data`, `expires_at`
2. Borrower signs EIP-712 **off-device** (wallet/app — never in MCP)
3. Submit with **`{ borrower_id, challenge_id, signature, wallet_address }`** → `{ verified, wallet_address }`

Before requesting the signature:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

## Request borrower token

`POST /api/v1/borrowers/token` via `request_borrower_token`

Body: `borrower_id` (UUID), `requested_scopes[]`

Response: `access_token`, `token_type`, `expires_in`, `borrower_id`, `scopes[]`, optional `dropped_scopes[{scope, reason}]`

Note: MCP may **redact** `access_token` in tool responses; harness OAuth is the primary transport auth.

### Token lifetime — the borrower token is short-lived

**The scoped borrower token expires quickly** — staging returns `expires_in: 900` (15 minutes). Read `expires_in` from the response rather than hardcoding a value.

This is a **different token from the OAuth transport token** your harness obtained at MCP login. The harness stores and refreshes that one automatically (`{SKILLS_BASE}/mcp-connect.md`); it does **not** refresh the borrower token, and there is no refresh call — you re-request it.

Consequences an agent must plan for:

- Spending authority **lapses silently**. Scopes such as `spend:intent:create`, `signing:request`, and `payment:execute` stop applying once the token expires; nothing notifies you.
- After expiry, `whoami` reports only the base scopes (commonly `["borrower:token"]`), **not** the scopes you requested earlier. That is expiry, not a dropped-scope failure — do not re-run onboarding to "fix" it.
- **Re-request the token immediately before each spend**, not once at session start. A flow that pauses for operator consent, waits on settlement, or resumes minutes later will likely need a fresh token before signing or paying.
- Re-requesting is routine and does not repeat wallet proof or KYC. It is still consent-critical — honour the STOP gate below each time.

### Consent

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

JWT stays thin — always resolve fresh before privileged MCP tools. `whoami` returns token claims only (not a live authz re-check).

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
| `whoami` | JWT identity snapshot (start here when already connected) |
| `register_borrower` | Register HUMAN/AGENT/BUSINESS |
| `request_signature_challenge` | Start wallet proof |
| `submit_signature` | Complete wallet proof (`challenge_id` + `signature` + `wallet_address`) |
| `get_borrower_status` | Onboarding status |
| `request_borrower_token` | Scope-gated token |

## Next steps

- Human-direct (default operate path): `curl -fsSL {SKILLS_BASE}/human-direct-flow.md`
- Idempotency: `curl -fsSL {SKILLS_BASE}/idempotency.md`
