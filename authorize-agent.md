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

Execute this grant in the same turn (hub flow: the borrower's approval is the one wait, see below). Do not plan. Do not fall back to `sign_transaction`. Do not ask a chat question before the grant call.

**Before:** MCP connected; workload key registered; borrower token includes `credit:facility:accept`. Wallet proof is **not** required for a within-threshold grant. **Primary trigger:** onboarding, immediately after `register_agent_workload_key` (`{SKILLS_BASE}/borrower-onboard.md`). `prepare_x402_payment` → `AGENT_AUTHORIZATION_REQUIRED` is recovery only (onboard was skipped).

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

**Two response shapes.** The shape of the `authorize_agent` response decides the flow, and `status: "DRAFT"` alone selects the hub flow. No `status` (onboarding hub off) → the challenge flow below. `status: "DRAFT"` (onboarding hub on) → the hub flow under it. Never mix them: a DRAFT has no `consent_url` and no `challenge_id`.

Challenge flow, consent link: open the `consent_url` returned by the challenge **verbatim** (`…/agent/authorize#<challenge_id>`) — never rebuild it from `typed_data`. Details: [references/consent-page.md](#hosted-reference-consent-page). Staging `https://staging.sohopay.xyz/agent/authorize`. Production `https://sohopay.xyz/agent/authorize`.

Onboarding defaults (no pending merchant): `max_per_payment=1000000` (1 USDC), `daily_limit=5000000` (5 USDC), `valid_until` ~7 days, omit `allowed_merchant_ids`. These are inside the passkey-only browser thresholds. On pay-time recovery, cover the pending payment; terms above the browser thresholds require an EOA signature in addition to passkey step-up.

**A2A transfers:** when the operator needs `{SKILLS_BASE}/a2a-transfer.md`, pass `allow_a2a_transfers: true` on the challenge so the grant binds `a2a_enabled`. Merchant purchases and A2A transfers share the same agent budget (`max_per_payment` / `daily_limit` / lifetime) — there is no separate A2A counter.

Need `credit:facility:accept` on the borrower token. If it is missing, call `request_borrower_token` with that scope before the challenge. Do **not** ask before that token call.

```text
1. authorize_agent (operational_agent_id, terms, fresh idempotency_key)
2. (challenge flow) Open the response's consent_url now, verbatim. Page POSTs complete and auto-returns to the harness — do not wait for a JSON paste
3. (challenge flow) get_agent_authorization every 5s for up to 2 minutes (24 attempts). Do not remint the challenge. Do not end the turn after only opening the page
4. Stop on ACTIVE, EXPIRED, or 120s. Timeout still PENDING → tell the operator to finish consent; do not invent a passkey assertion or signature
5. Onboarding: no prepare. Pay-time recovery: after ACTIVE, prepare_x402_payment SAME order / SAME payment idempotency_key
6. VOUCHER_ISSUED → continue sohopay-x402. Do not re-GET the merchant
```

**Hub flow (`status: "DRAFT"`).** The response is `{ status: "DRAFT", draft_id, version, summary: { template_version, sentence }, message }`. There is no `consent_url` and no `challenge_id`, so open no link, rebuild none, and do **not** poll `get_agent_authorization` (it needs a `challenge_id`).

```text
1. Relay summary.sentence to the borrower
2. get_context: when hub.open_url is non-null, relay it. The borrower reviews and approves the grant in the SohoPay setup page. Never invent a link
   hub.open_url null = no step needs the human right now (for example EVALUATING or WAITING_FOR_AGENT_KEY): relay no link
3. End the turn. This is the one grant step that waits for the borrower's chat reply: they say they approved
4. After they say so, get_context once. ACTIVE = hub.step DONE. Not DONE yet: tell the borrower, check again on their next message — no tight loop
5. Onboarding: no prepare. Pay-time recovery: after ACTIVE, prepare_x402_payment SAME order / SAME payment idempotency_key
```

DONE before the borrower approves does **not** confirm the new terms: an earlier ACTIVE grant also reads DONE. Only a check made after they say they approved counts.

Hub-mode errors (no consent URL fallback, ever):

| Error | Action |
|-------|--------|
| `503 HUB_TERMS_UNAVAILABLE` | Nothing was saved. Tell the borrower the grant step is temporarily unavailable. Call `authorize_agent` again later with a fresh `idempotency_key` |
| `409 HUB_GRANT_DRAFT_FROZEN` | The borrower is mid-approval. Tell them, check `get_context`, do not retry in a loop. To change terms they must decline the pending draft in the setup page first |
| `409 HUB_AGENT_REMOVED` | Tell the borrower. Do not retry |
| `409 HUB_GRANT_DRAFT_CONFLICT` | Concurrent write. One retry is reasonable; do not loop. Still failing: tell the borrower and check `get_context` |
| `403 HUB_TERMS_AGENT_NOT_OWNED` | Wrong or foreign `operational_agent_id` / `borrower_id`. Re-check both from `register_borrower` / `get_context`. Nothing to tell the borrower |

Challenge and submit are separate writes — new idempotency_key for submit fallback only. Continue `{SKILLS_BASE}/x402-credit-pay.md` only after a pay-time recovery.

---

## Hosted references (load only when the skill says to)

Native Agent Skills read these from `references/` on demand. This hosted export inlines them so `curl -fsSL` bootstrap still works.

<a id="hosted-reference-consent-page"></a>

### Hosted reference: consent-page.md

## Consent page (preferred borrower UX)

This page applies to the challenge flow only (the `authorize_agent` response has no `status`). When the response is `status: "DRAFT"` (onboarding hub on) there is no `consent_url` and no `challenge_id`: use the hub flow in `{SKILLS_BASE}/authorize-agent.md` and skip this page.

General browser rules (models, `#` fragments, polling, Hermes close-tab): see the "Browser consent and handoff pages" reference in `{SKILLS_BASE}/setup.md`.

Do **not** paste raw EIP-712 typed data into chat as the primary path. Open the SohoPay consent page so the borrower can review limits and complete passkey step-up. A wallet is optional for within-threshold grants; larger grants also require an EOA signature.

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
- The page starts a principal-bound `AGENT_AUTHORIZATION` session with passkey step-up. Within-threshold terms can complete without a wallet. Above threshold, the page also collects the EOA signature.
- After consent → the page POSTs completion to SohoPay (`POST /api/v1/auth/agent-authorizations/complete`). If complete returns a safe harness `redirect_uri`, the page auto-navigates (same as MCP login approve). If missing or unsafe, it stays on **Grant active**. Never put `redirect_uri` in the hash.
- The grant becomes ACTIVE in the backend. **Do not wait for the operator to paste JSON.** The agent still polls `get_agent_authorization` until ACTIVE.

**Preferred completion:** poll `get_agent_authorization` with this `challenge_id` every **5 seconds** for **2 minutes** (max 24 attempts). Do not poll `authorizations/current`. Do not remint the challenge while polling. After ACTIVE on pay-time recovery, retry `prepare_x402_payment` with the **same** order / **same** payment `idempotency_key`. During onboard do not invent a dummy prepare. Do not re-GET the merchant. Do not mint a new payment idempotency key.

**Fallback only** for an EOA-backed grant if the page cannot submit the wallet signature (shows an error, or the operator has no in-page success): they may copy:

```json
{
  "challenge_id": "…",
  "wallet_address": "0x…",
  "signature": "0x…"
}
```

Then call `authorize_agent` with `challenge_id` + `wallet_address` + `signature` and a **new** submit-phase `idempotency_key`.

