<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Repay (Wallet Consent)

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`. GitHub raw is last-resort fallback only.

**What this skill does:** the borrower repays SohoPay credit with **one EIP-712 sign** (`ReceiveWithAuthorization`). The agent mints a consent challenge, the borrower opens a SohoPay page and signs with phone or browser wallet, the page completes repayment via the relayer, and the agent polls until the balance is cleared.

**Before running it:** MCP is connected; the borrower is onboarded. `create_repayment` / `execute_repayment` stay prepare-only for third-party payers — do **not** turn those into this flow.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

MCP tools: `request_repayment` (composite challenge → submit) and `get_repayment_status`. Prefer the local sticky copy of this file under `sohopay-integrate/docs/` when present.

## FAST PATH — operator said "repay"

```text
whoami → request_borrower_token (repayment:execute, repayment:read)
request_repayment (amount or full outstanding)
STOP — open consent_url (do not paste typed data)
poll get_repayment_status ~2s until CONFIRMED or expires_at
get_outstanding_balance
```

## When to run

| Trigger | Action |
|---------|--------|
| Operator said "repay" / "repay my credit" / "pay back SohoPay" | **Default.** Follow this skill now. |
| Outstanding balance is non-zero and the operator wants to clear it | Same path. Omit `amount` to repay the full outstanding. |

Do **not** ask the borrower to copy `SohoSettlement.repay` calldata from chat as the primary path.

## Consent page (preferred borrower UX)

Do **not** paste raw EIP-712 typed data into chat as the primary path. Open the SohoPay repay page so the borrower can review the amount and sign in their wallet.

| Environment | Consent base (live) |
|-------------|---------------------|
| Staging | `https://staging.sohopay.xyz/repay/authorize` |
| Production | `https://sohopay.xyz/repay/authorize` |

**Page contract (must match):**

- Hash payload only: `{CONSENT_BASE}#{base64url(JSON)}` — never put the challenge in the query string.
- JSON fields: `challenge_id` (UUID), `typed_data` (exact challenge `typed_data`, `primaryType` must be `ReceiveWithAuthorization`), optional `expires_at`, plus display fields `amount`, `outstanding_balance`, `currency`.
- Empty / missing hash → page shows **Invalid repayment link**.
- After wallet sign → the page POSTs `{ challenge_id, wallet_address, signature }` to `POST /api/v1/auth/repayments/complete`. The relayer submits `repayWithAuthorization`. **Do not wait for the operator to paste JSON.**

The backend returns `consent_url` already assembled. **Do not re-assemble base64url.** Open the returned URL.

**Fallback only** if the page cannot complete (shows an error, or the operator has no in-page success): they may copy:

```json
{
  "challenge_id": "…",
  "wallet_address": "0x…",
  "signature": "0x…"
}
```

Then call `request_repayment` with `challenge_id` + `wallet_address` + `signature` and a **new** submit-phase `idempotency_key`.

## Agent STOP

Show the operator:

1. Amount (e.g. 0.02 USDC) and that this clears SohoPay credit.
2. The consent URL.
3. That they sign in wallet (phone QR or browser extension); the page submits; the agent continues after confirm.

Never invent a signature. Never ask them to paste calldata as the primary path.

## Workflow

```text
1. whoami (borrower_id ??= principal_id on human-direct)
2. request_borrower_token — scopes repayment:execute, repayment:read
3. request_repayment (challenge phase)
     — borrower_id
     — optional amount (USDC base units, 6 decimals); omit = full outstanding
     — NO signature / challenge_id / wallet_address
     — fresh idempotency_key (UUID v4)
  → { challenge_id, typed_data, expires_at, amount, outstanding_balance, consent_url }

4. STOP — open consent_url in the same turn
     Page POSTs complete; challenge becomes SUBMITTED then CONFIRMED

5. poll get_repayment_status ~2s (challenge_id) until CONFIRMED, FAILED, or expires_at
6. get_outstanding_balance — quote should be 0 after CONFIRMED

Fallback only: request_repayment submit with pasted signature + NEW idempotency_key
```

### Idempotency

Challenge and submit are **separate writes**. Reusing one `idempotency_key` across both phases returns `409 IDEMPOTENCY_KEY_CONFLICT`. Always mint a fresh key for submit. See `{SKILLS_BASE}/idempotency.md`.

### Statuses

| Status | Meaning |
|--------|---------|
| `PENDING` | Challenge minted; waiting for wallet sign |
| `SUBMITTED` | Signature accepted; relayer broadcast in flight |
| `CONFIRMED` | V2 `RepaymentReceived` reconciled — not merely prepared |
| `FAILED` | Submit or on-chain repayment failed |
| `EXPIRED` | Challenge TTL elapsed (~1h) |

### Scopes

Challenge, submit, and status require `repayment:execute` (write) and `repayment:read` (poll). If the current borrower token lacks them, call `request_borrower_token` with those scopes **before** the challenge phase.

## Expiry and retries

| Situation | Action |
|-----------|--------|
| Consent page says challenge expired / `expires_at` passed | Mint a **new** challenge (new idempotency key); do not reuse the old `challenge_id` |
| Operator rejects / closes without signing | STOP; do not invent a signature |
| Submit fails (wrong wallet, reused nonce, expired) | Surface the error; mint a new challenge if the old one was consumed or expired |
| `create_repayment` / `execute_repayment` | Leave them prepare-only. Do not use them as the primary repay path. |

## Anti-patterns

- Pasting the full typed_data blob into chat as the only UX when the consent page is available
- Waiting for a JSON paste when the page already completed repayment
- Re-assembling the hash URL instead of using backend `consent_url`
- Reusing the challenge-phase `idempotency_key` on submit
- Asking the borrower to broadcast `approve` + `repay` from chat
- Fabricating a signature

## Next steps

- Human-direct operate path: `curl -fsSL {SKILLS_BASE}/human-direct-flow.md || curl -fsSL https://raw.githubusercontent.com/sohopay/skills/main/human-direct-flow.md`
- Idempotency: `curl -fsSL {SKILLS_BASE}/idempotency.md || curl -fsSL https://raw.githubusercontent.com/sohopay/skills/main/idempotency.md`
