<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Authorize Agent (Borrower Grant)

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**What this skill does:** obtains an ACTIVE off-chain `AgentAuthorizationGrant` so Protocol V2 `prepare_x402_payment` can issue vouchers. The **borrower** signs EIP-712 typed data with their linked EOA. The agent never holds the borrower private key and never invents a signature.

**Before running it:** MCP is connected; the borrower is onboarded (wallet proof); an agent workload key is registered (`register_agent_workload_key`). Usually you arrive here because `prepare_x402_payment` returned `AGENT_AUTHORIZATION_REQUIRED`.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

MCP tool: `authorize_agent` (challenge; submit-with-signature is fallback only). Prefer the local sticky copy of this file under `sohopay-integrate/docs/` when present.

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
- After wallet sign → the page POSTs `{ challenge_id, wallet_address, signature }` to the first-party complete route and shows **Grant active**. The agent does **not** wait for a chat paste.

Build the link (Node):

```js
const hash = Buffer.from(JSON.stringify({
  challenge_id,
  expires_at, // omit if absent
  typed_data, // exact object from authorize_agent challenge response
})).toString("base64url");
const url = `https://staging.sohopay.xyz/agent/authorize#${hash}`; // or sohopay.xyz in prod
```

Use **standard base64url** (no padding). The page reads the **hash only**. After you open the URL, **poll** until the grant is ACTIVE (or until `expires_at`). Do **not** ask the operator to paste.

### Poll (preferred resume)

Every ~2s until `expires_at` (or ~2 minutes if `expires_at` is missing):

- Retry `prepare_x402_payment` with the **same** order and the **same** payment `idempotency_key`.

Do **not** remint a challenge to poll. Stop when prepare is no longer `AGENT_AUTHORIZATION_REQUIRED` (typically `VOUCHER_ISSUED`) or when the challenge expires.

### Paste (fallback only)

If the page cannot submit (old deploy, network error, or the operator still sees a copy-JSON box), ask **once** for:

```json
{
  "challenge_id": "…",
  "wallet_address": "0x…",
  "signature": "0x…"
}
```

Then call `authorize_agent` with `challenge_id` + `wallet_address` + `signature` (new idempotency key). Do not ask for paste on the preferred path.

## STOP — operator consent

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

Show the operator:

1. Why the stop happened (`AGENT_AUTHORIZATION_REQUIRED`).
2. The proposed limits (USDC, validity window, merchant scope).
3. The consent URL (staging or production) for them to open and sign in their wallet.
4. That the page activates the grant after they sign — they can return to the agent; it continues automatically.

After opening the URL, poll as above. Do not invent a signature. Do not continue the payment until prepare succeeds or the grant is ACTIVE.

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
     Page POSTs the signature (Grant active). Agent polls.

3. Poll every ~2s until expires_at
     — retry prepare_x402_payment with the SAME order / SAME payment idempotency_key
     — do NOT remint a challenge
     — paste + authorize_agent submit is fallback only (NEW idempotency_key)

4. Continue the blocked prepare (VOUCHER_ISSUED → agent voucher sign)
```

### Idempotency

Challenge and the optional paste-submit are **separate writes**. Reusing one `idempotency_key` across both phases returns `409 IDEMPOTENCY_KEY_CONFLICT`. Always mint a fresh key for submit. The **payment** `idempotency_key` used for prepare must stay the same across polls. See `{SKILLS_BASE}/idempotency.md`.

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

- Grant status becomes ACTIVE for that `operational_agent_id` + workload key `jkt` (the consent page writes it; paste-submit is only the fallback).
- Resume the blocked payment: `prepare_x402_payment` with the **same** order tuple and the **same** payment `idempotency_key` used before the STOP.
- Continue `{SKILLS_BASE}/x402-credit-pay.md` (VOUCHER_ISSUED → agent signs → PAYMENT-SIGNATURE).

## Expiry and retries

| Situation | Action |
|-----------|--------|
| Consent page says challenge expired / `expiresAt` passed | Mint a **new** challenge (new idempotency key); do not reuse the old `challenge_id` |
| Operator rejects / closes without signing | STOP; do not pay |
| Page submit / fallback submit fails (`WALLET_PROOF_SIGNER_MISMATCH`, typed-data mismatch, etc.) | Surface the error; mint a new challenge if the old one was consumed or expired |

## Anti-patterns

- Asking the operator to paste JSON when the consent page can activate the grant
- Pasting the full typed_data blob into chat as the only UX when the consent page is available
- Calling `sign_transaction` / inventing an `intentSig` to skip the grant
- Reminting a challenge while polling a live consent URL
- Reusing the challenge-phase `idempotency_key` on fallback submit
- Minting a **new** payment `idempotency_key` for the same 402 order after the grant succeeds (resume the original key)
- Submitting a signature the borrower did not produce

## Next steps

- x402 fast path: `curl -fsSL {SKILLS_BASE}/x402-credit-pay.md`
- Workload key: `curl -fsSL {SKILLS_BASE}/borrower-onboard.md`
- Idempotency: `curl -fsSL {SKILLS_BASE}/idempotency.md`
