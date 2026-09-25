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
