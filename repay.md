<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1
     SKILLS_HOST (CDN origin): https://agents.sohopay.xyz
     Fetch order: local sticky → {SKILLS_BASE} → GitHub raw last-resort.
     Publish rewrites SKILLS_BASE to Prod and {SKILLS_HOST} to the origin. -->
<!-- Generated from plugins/sohopay/skills — do not hand-edit this file. Run npm run generate:hosted -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Repay (Wallet Consent)

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

Execute this repay in the same turn. Do not plan. Do not invent a signature. Do not ask the borrower to paste `SohoSettlement.repay` calldata.

**Before:** MCP connected; borrower onboarded. `create_repayment` / `execute_repayment` stay prepare-only for third-party payers.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

Need `repayment:execute` and `repayment:read` on the borrower token. If they are missing, call `request_borrower_token` with those scopes before the challenge.

Consent URL + hash payload: [references/consent-page.md](#hosted-reference-consent-page). Staging `https://staging.sohopay.xyz/repay/authorize`. Production `https://sohopay.xyz/repay/authorize`. The backend returns `consent_url` already assembled — do not rebuild the hash.

```text
1. whoami (borrower_id ??= principal_id) → request_borrower_token (repayment:execute, repayment:read)
2. request_repayment challenge (optional amount; omit = full outstanding; fresh idempotency_key)
3. STOP — open consent_url now. Page POSTs complete — do not wait for a JSON paste
4. poll get_repayment_status ~2s until CONFIRMED, FAILED, or expires_at
5. get_outstanding_balance — quote should be 0 after CONFIRMED
```

Show the operator the amount, the consent URL, and that they sign in wallet (phone QR or browser). Challenge and submit are separate writes — new idempotency_key for paste fallback only (`{SKILLS_BASE}/idempotency.md`).

| Status | Meaning |
|--------|---------|
| `PENDING` | Challenge minted; waiting for wallet sign |
| `SUBMITTED` | Signature accepted; relayer broadcast in flight |
| `CONFIRMED` | V2 `RepaymentReceived` reconciled — not merely prepared |
| `FAILED` | Submit or on-chain repayment failed |
| `EXPIRED` | Challenge TTL elapsed (~1h) — mint a new challenge, do not reuse `challenge_id` |

---

## Hosted references (load only when the skill says to)

Native Agent Skills read these from `references/` on demand. This hosted export inlines them so `curl -fsSL` bootstrap still works.

<a id="hosted-reference-consent-page"></a>

### Hosted reference: consent-page.md

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

The challenge response includes `consent_url`. **Open that URL.** Do not re-assemble base64url.

**Fallback only** if the page cannot complete (shows an error, or the operator has no in-page success): they may copy:

```json
{
  "challenge_id": "…",
  "wallet_address": "0x…",
  "signature": "0x…"
}
```

Then call `request_repayment` with `challenge_id` + `wallet_address` + `signature` and a **new** submit-phase `idempotency_key`.

