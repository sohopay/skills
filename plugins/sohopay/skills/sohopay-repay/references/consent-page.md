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
