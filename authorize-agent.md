<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1
     SKILLS_HOST (CDN origin): https://agents.sohopay.xyz
     Fetch order: local sticky → {SKILLS_BASE} → GitHub raw last-resort.
     Publish rewrites SKILLS_BASE to Prod and {SKILLS_HOST} to the origin. -->
<!-- Generated from plugins/sohopay/skills — do not hand-edit this file. Run npm run generate:hosted -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Authorize Agent (Borrower Grant)

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

Execute this grant in the same turn. Do not plan. Do not fall back to `sign_transaction`. Do not ask a chat question before the consent URL.

**Before:** MCP connected; wallet proof done; workload key registered. **Primary trigger:** onboarding, immediately after `register_agent_workload_key` (`{SKILLS_BASE}/borrower-onboard.md`). `prepare_x402_payment` → `AGENT_AUTHORIZATION_REQUIRED` is recovery only (onboard was skipped).

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

Consent URL + hash payload: [references/consent-page.md](#hosted-reference-consent-page). Staging `https://staging.sohopay.xyz/agent/authorize`. Production `https://sohopay.xyz/agent/authorize`.

Onboarding defaults (no pending merchant): `max_per_payment=1000000` (1 USDC), `daily_limit=5000000` (5 USDC), `valid_until` ~7 days, omit `allowed_merchant_ids`. On pay-time recovery, cover the pending payment.

Need `credit:facility:accept` on the borrower token. If it is missing, call `request_borrower_token` with that scope before the challenge. Do **not** ask before that token call.

```text
1. authorize_agent challenge (operational_agent_id, terms, fresh idempotency_key)
2. Open consent URL now (hash payload). Page POSTs complete and auto-returns to the harness — do not wait for a JSON paste
3. get_agent_authorization every 5s for up to 2 minutes (24 attempts). Do not remint the challenge. Do not end the turn after only opening the page
4. Stop on ACTIVE, EXPIRED, or 120s. Timeout still PENDING → tell the operator to finish signing; do not invent a signature
5. Onboarding: no prepare. Pay-time recovery: after ACTIVE, prepare_x402_payment SAME order / SAME payment idempotency_key
6. VOUCHER_ISSUED → continue sohopay-x402. Do not re-GET the merchant
```

Challenge and submit are separate writes — new idempotency_key for submit fallback only. Continue `{SKILLS_BASE}/x402-credit-pay.md` only after a pay-time recovery.

---

## Hosted references (load only when the skill says to)

Native Agent Skills read these from `references/` on demand. This hosted export inlines them so `curl -fsSL` bootstrap still works.

<a id="hosted-reference-consent-page"></a>

### Hosted reference: consent-page.md

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
- After wallet sign → the page POSTs the signature to SohoPay (`POST /api/v1/auth/agent-authorizations/complete`). If complete returns a safe harness `redirect_uri`, the page auto-navigates (same as MCP login approve). If missing or unsafe, it stays on **Grant active**. Never put `redirect_uri` in the hash.
- The grant becomes ACTIVE in the backend. **Do not wait for the operator to paste JSON.** The agent still polls `get_agent_authorization` until ACTIVE.

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

