<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Authorize Agent (Borrower Grant)

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`. GitHub raw is last-resort fallback only.

**What this skill does:** obtains an ACTIVE off-chain `AgentAuthorizationGrant` so Protocol V2 `prepare_x402_payment` can issue vouchers. The **borrower** signs EIP-712 typed data with their linked EOA. The agent never holds the borrower private key and never invents a signature.

**Before running it:** MCP is connected; the borrower is onboarded (wallet proof); an agent workload key is registered (`register_agent_workload_key`). Usually you arrive here because `prepare_x402_payment` returned `AGENT_AUTHORIZATION_REQUIRED`.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

MCP tool: `authorize_agent` (composite challenge → submit). Prefer the local sticky copy of this file under `sohopay-integrate/docs/` when present.

## When to run

| Trigger | Action |
|---------|--------|
| `prepare_x402_payment` → `AGENT_AUTHORIZATION_REQUIRED` | STOP — follow this skill, then retry prepare with the **same** order / **same** payment `idempotency_key` |
| First Protocol V2 spend on a terminal with no ACTIVE grant | Same STOP before or after the first prepare denial |

Do **not** invent custodial `sign_transaction` to bypass this grant.

## Consent page (preferred borrower UX)

Do **not** paste raw EIP-712 typed data into chat as the primary path. Open the SohoPay consent page so the borrower can review limits and sign in their wallet.

| Environment | Consent base (live) |
|-------------|---------------------|
| Staging | `https://staging.sohopay.xyz/agent/authorize` |
| Production | `https://sohopay.xyz/agent/authorize` |

**Page contract (must match):**

- Hash payload only: `{CONSENT_BASE}#{base64url(JSON)}` — never put the challenge in the query string.
- JSON fields: `challenge_id` (UUID), `typed_data` (exact challenge `typed_data`), optional `expires_at` (ISO string from the challenge response).
- `typed_data.primaryType` must be `AgentAuthorizationGrant`.
- Empty / missing hash → page shows **Invalid authorization link** (expected without a challenge).
- After wallet sign → the page POSTs the signature to SohoPay (`POST /api/v1/auth/agent-authorizations/complete`) and shows **Grant signed**. The grant becomes ACTIVE in the backend. **Do not wait for the operator to paste JSON.**

Build the link (Node):

```js
const hash = Buffer.from(JSON.stringify({
  challenge_id,
  expires_at, // omit if absent
  typed_data, // exact object from authorize_agent challenge response
})).toString("base64url");
const url = `https://staging.sohopay.xyz/agent/authorize#${hash}`; // or sohopay.xyz in prod
```

Use **standard base64url** (no padding). The page reads the **hash only**.

**Preferred completion:** poll `prepare_x402_payment` with the **same** order / **same** payment `idempotency_key` until it returns `VOUCHER_ISSUED` (or a non-grant error). Do not re-GET the merchant. Do not mint a new payment idempotency key.

**Fallback only** if the page cannot complete (shows an error, or the operator has no in-page success): they may copy:

```json
{
  "challenge_id": "…",
  "wallet_address": "0x…",
  "signature": "0x…"
}
```

Then call `authorize_agent` with `challenge_id` + `wallet_address` + `signature` and a **new** submit-phase `idempotency_key`.

## STOP — operator consent

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

Show the operator:

1. Why the stop happened (`AGENT_AUTHORIZATION_REQUIRED`).
2. The proposed limits (USDC, validity window, merchant scope).
3. The consent URL (staging or production) for them to open and sign.
4. That the page completes the grant after they sign — they should reply "done" (no JSON paste required).

Do **not** invent a signature. After they confirm they signed (or after a short poll window), retry prepare with the same order / same payment idempotency key.

## Workflow

```text
1. authorize_agent (challenge phase)
     — operational_agent_id from register_borrower
     — borrower_id from whoami (borrower_id ??= principal_id on human-direct)
     — terms: max_per_payment, daily_limit, valid_until (required)
     — optional: total_allowance, valid_from, allowed_merchant_ids, tier
     — NO signature / challenge_id / wallet_address
     — fresh idempotency_key (UUID v4)
  → { challenge_id, typed_data, expires_at, authorization_version }

2. STOP — open consent URL; borrower signs in-wallet
     Page POSTs complete; grant becomes ACTIVE

3. Preferred: retry prepare_x402_payment (SAME order / SAME payment idempotency_key)
     Fallback only: authorize_agent submit with pasted signature + NEW idempotency_key,
     then retry prepare with the ORIGINAL payment key

4. VOUCHER_ISSUED → sign locally → PAYMENT-SIGNATURE
     Do not re-GET the merchant (orderRef must stay the first challenge)
```

### Idempotency

Challenge and submit are **separate writes**. Reusing one `idempotency_key` across both phases returns `409 IDEMPOTENCY_KEY_CONFLICT`. Always mint a fresh key for submit. See `{SKILLS_BASE}/idempotency.md`.

### Terms (USDC base units, 6 decimals)

| Field | Meaning |
|-------|---------|
| `max_per_payment` | Cap per single payment (required for challenge) |
| `daily_limit` | Rolling 24h cap; must be ≥ `max_per_payment` |
| `total_allowance` | Optional lifetime cap; omit for none |
| `valid_until` | Unix seconds end of grant validity (required) |
| `allowed_merchant_ids` | Optional UUID or bytes32 list; omit / empty = any merchant |

Pick limits that cover the pending payment (and a sane daily headroom). Example for a $0.01 premium resource: `max_per_payment=1000000` (1 USDC), `daily_limit=5000000` (5 USDC), `valid_until` ~7 days ahead.

### Scopes

Challenge and submit require `credit:facility:accept` (projected on the MCP tool). If the current borrower token lacks it, call `request_borrower_token` with that scope (plus any existing spend scopes needed to resume pay) **before** the challenge phase. On a payRequest, token refresh does not need a separate STOP once the operator already authorized the payment — but **this grant STOP still applies**.

## After the grant is ACTIVE

- Resume the blocked payment: `prepare_x402_payment` with the **same** order tuple and the **same** payment `idempotency_key` used before the STOP.
- Continue `{SKILLS_BASE}/x402-credit-pay.md` (VOUCHER_ISSUED → agent signs → PAYMENT-SIGNATURE).

## Expiry and retries

| Situation | Action |
|-----------|--------|
| Consent page says challenge expired / `expiresAt` passed | Mint a **new** challenge (new idempotency key); do not reuse the old `challenge_id` |
| Operator rejects / closes without signing | STOP; do not pay |
| Submit fails (`WALLET_PROOF_SIGNER_MISMATCH`, typed-data mismatch, etc.) | Surface the error; mint a new challenge if the old one was consumed or expired |
| `X402_INTENT_EXPIRED` on retry | Do **not** re-GET the merchant. Retry prepare on the **same** order / same payment key (backend remints an expired unsettled deadline). Only use a new `orderRef` if the merchant already issued a new challenge. |

## Anti-patterns

- Pasting the full typed_data blob into chat as the only UX when the consent page is available
- Waiting for a JSON paste when the page already completed the grant
- Calling `sign_transaction` / inventing an `intentSig` to skip the grant
- Reusing the challenge-phase `idempotency_key` on submit
- Minting a **new** payment `idempotency_key` for the same 402 order after the grant succeeds (resume the original key)
- Re-GETting the merchant after the grant STOP (new `orderRef` breaks resume)
- Submitting a signature the borrower did not produce

## Next steps

- x402 fast path: `curl -fsSL {SKILLS_BASE}/x402-credit-pay.md || curl -fsSL https://raw.githubusercontent.com/sohopay/skills/main/x402-credit-pay.md`
- Workload key: `curl -fsSL {SKILLS_BASE}/borrower-onboard.md || curl -fsSL https://raw.githubusercontent.com/sohopay/skills/main/borrower-onboard.md`
- Idempotency: `curl -fsSL {SKILLS_BASE}/idempotency.md || curl -fsSL https://raw.githubusercontent.com/sohopay/skills/main/idempotency.md`
