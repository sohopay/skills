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

Execute this grant, then retry prepare. Do not plan. Do not fall back to `sign_transaction`.

**Before:** MCP connected; wallet proof done; workload key registered. Usual trigger: `prepare_x402_payment` → `AGENT_AUTHORIZATION_REQUIRED`.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

Consent URL + hash payload: [references/consent-page.md](#hosted-reference-consent-page). Staging `https://staging.sohopay.xyz/agent/authorize`. Production `https://sohopay.xyz/agent/authorize`.

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

```text
1. authorize_agent challenge (operational_agent_id, terms, fresh idempotency_key)
2. Open consent URL (hash payload). Page POSTs complete — do not wait for JSON paste
3. Retry prepare_x402_payment SAME order / SAME payment idempotency_key
4. VOUCHER_ISSUED → continue sohopay-x402. Do not re-GET the merchant
```

Challenge and submit are separate writes — new idempotency_key for submit fallback only. Need `credit:facility:accept` on the borrower token. Continue `{SKILLS_BASE}/x402-credit-pay.md`.

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

