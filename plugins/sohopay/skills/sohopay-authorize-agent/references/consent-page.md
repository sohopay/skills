## Consent page (preferred borrower UX)

Do **not** paste raw EIP-712 typed data into chat as the primary path. Open the SohoPay consent page so the borrower can review limits and sign in their wallet.

| Environment | Consent base (live) |
|-------------|---------------------|
| Staging | `https://staging.sohopay.xyz/agent/authorize` |
| Production | `https://sohopay.xyz/agent/authorize` |

**Use `consent_url` from the challenge response — do not build the link yourself.**

The `authorize_agent` challenge response includes `consent_url`:

```text
https://staging.sohopay.xyz/agent/authorize#<challenge_id>
```

Open it **verbatim**. The fragment is only the challenge UUID; the page loads the typed data from SohoPay (`GET /api/v1/auth/agent-authorizations/<challenge_id>`), so the link is short (~80 chars) and safe for any browser tool or URL cap. Never re-encode `typed_data` into the URL — a hand-typed or truncated payload would make the borrower sign something the backend rejects (`AGENT_AUTHORIZATION_SIGNATURE_INVALID`).

If your browser tool cannot open URLs, print `consent_url` for the operator to open on their phone or desktop browser. Do not set `window.location.hash` from a console; do not retype the typed data.

**Page contract:**

- `#<challenge_id>` (preferred) — page fetches the pending challenge. Unknown id → **Invalid link**; expired or already completed → **Expired**.
- Legacy `#{base64url(JSON{ challenge_id, typed_data, expires_at? })}` is still accepted for older agents but is not the path to use.
- `typed_data.primaryType` is `AgentAuthorizationGrant`.
- Empty / missing hash → **Invalid authorization link** (expected without a challenge).
- After wallet sign → the page POSTs the signature to SohoPay (`POST /api/v1/auth/agent-authorizations/complete`). If complete returns a safe harness `redirect_uri`, the page auto-navigates (same as MCP login approve). If missing or unsafe, it stays on **Grant active**. Never put `redirect_uri` in the hash.
- The grant becomes ACTIVE in the backend. **Do not wait for the operator to paste JSON.** The agent still polls `get_agent_authorization` until ACTIVE.

**Preferred completion:** poll `get_agent_authorization` with this `challenge_id` every **5 seconds** for **2 minutes** (max 24 attempts). Do not poll `authorizations/current`. Do not remint the challenge while polling. After ACTIVE on pay-time recovery, retry `prepare_x402_payment` with the **same** order / **same** payment `idempotency_key`. During onboard do not invent a dummy prepare. Do not re-GET the merchant. Do not mint a new payment idempotency key.

**Fallback only** if the page cannot complete (shows an error, or the operator has no in-page success): they may copy:

```json
{
  "challenge_id": "…",
  "wallet_address": "0x…",
  "signature": "0x…"
}
```

Then call `authorize_agent` with `challenge_id` + `wallet_address` + `signature` and a **new** submit-phase `idempotency_key`.
