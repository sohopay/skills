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

Typical MCP fields (execute-time): `borrower_id`, optional `terminal_id`; omit `terminal_id` to use `SOHO_TERMINAL_ID` or the host default. Returns `operational_agent_id`, `terminal_id`, `agent_id` (bytes32 — do not pass that as `operational_agent_id`), `spend_ready`, `available_credit`.

`register_borrower` is also the **terminal bind** for an already-onboarded borrower on a new MCP host. Call it before `register_agent_workload_key`. Do not invent `terminal_id` — use the value the tool returns (or the host default you omitted).

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

This is a **different token from the OAuth transport token** your harness obtained at MCP login. The harness stores and refreshes that one automatically (`{SKILL:sohopay-mcp-connect}`); it does **not** refresh the borrower token, and there is no refresh call — you re-request it.

Consequences an agent must plan for:

- Spending authority **lapses silently**. Scopes such as `spend:intent:create`, `signing:request`, and `payment:execute` stop applying once the token expires; nothing notifies you.
- After expiry, `whoami` reports only the base scopes (commonly `["borrower:token"]`), **not** the scopes you requested earlier. That is expiry, not a dropped-scope failure — do not re-run onboarding to "fix" it.
- **Re-request the token immediately before each spend**, not once at session start. A flow that pauses for operator consent, waits on settlement, or resumes minutes later will likely need a fresh token before signing or paying.
- Re-requesting is routine and does not repeat wallet proof or KYC.

### Consent

The token grants real spending scopes.

**Onboarding / first grant (setup):** before the first scoped token outside a payRequest:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

**HTTP 402 payRequest** (“pay” / merchant URL): call `request_borrower_token` **without** a STOP when refreshing scopes — the pay utterance already authorized the payment. Do **not** honour the onboarding STOP “each time” on pay.

### Dropped scope reason codes

| Code | Meaning |
|------|---------|
| `WALLET_PROOF_REQUIRED` | Complete signature challenge first |
| `KYC_NOT_APPROVED` | KYC not APPROVED |
| `PREQUAL_DECLINED` | Prequal declined |
| `STATE_UNAVAILABLE` | Gate state unreadable — fail closed |

Ungated scopes are **dropped, not fatal**. Re-request after wallet proof or KYC completes.
