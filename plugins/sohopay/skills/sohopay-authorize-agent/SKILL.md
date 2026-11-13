---
name: sohopay-authorize-agent
description: >
  Obtain an ACTIVE AgentAuthorizationGrant via authorize_agent and the passkey-backed consent page (hub off) or the SohoPay setup page (hub on), with EOA signature only above browser thresholds. Use when onboarding just registered the workload key, or prepare_x402_payment returns AGENT_AUTHORIZATION_REQUIRED — not for wallet-proof or voucher Ed25519 signing.
license: Apache-2.0
metadata:
  hosted_name: authorize-agent
  title: SohoPay Authorize Agent (Borrower Grant)
  version: "1.0"
---

Execute this grant in the same turn (hub flow: the borrower's approval is the one wait, see below). Do not plan. Do not fall back to `sign_transaction`. Do not ask a chat question before the grant call.

**Before:** MCP connected; workload key registered; borrower token includes `credit:facility:accept`. Wallet proof is **not** required for a within-threshold grant. **Primary trigger:** onboarding, immediately after `register_agent_workload_key` (`{SKILL:sohopay-onboard}`). `prepare_x402_payment` → `AGENT_AUTHORIZATION_REQUIRED` is recovery only (onboard was skipped).

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

**Two response shapes.** The shape of the `authorize_agent` response decides the flow, and `status: "DRAFT"` alone selects the hub flow. No `status` (onboarding hub off) → the challenge flow below. `status: "DRAFT"` (onboarding hub on) → the hub flow under it. Never mix them: a DRAFT has no `consent_url` and no `challenge_id`.

Challenge flow, consent link: open the `consent_url` returned by the challenge **verbatim** (`…/agent/authorize#<challenge_id>`) — never rebuild it from `typed_data`. Details: [references/consent-page.md](references/consent-page.md). Staging `https://staging.sohopay.xyz/agent/authorize`. Production `https://sohopay.xyz/agent/authorize`.

Onboarding defaults (no pending merchant): `max_per_payment=1000000` (1 USDC), `daily_limit=5000000` (5 USDC), `valid_until` ~7 days, omit `allowed_merchant_ids`. These are inside the passkey-only browser thresholds. On pay-time recovery, cover the pending payment; terms above the browser thresholds require an EOA signature in addition to passkey step-up.

**A2A transfers:** when the operator needs `{SKILL:sohopay-a2a-transfer}`, pass `allow_a2a_transfers: true` on the challenge so the grant binds `a2a_enabled`. Merchant purchases and A2A transfers share the same agent budget (`max_per_payment` / `daily_limit` / lifetime) — there is no separate A2A counter.

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
3. If `get_context` lists `CLAIM_HANDLE`, claim a handle the borrower confirms first (`{SKILL:sohopay-onboard}` step 6), then end the turn. This is the one grant step that waits for the borrower's chat reply: they say they approved
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

Challenge and submit are separate writes — new idempotency_key for submit fallback only. Continue `{SKILL:sohopay-x402}` only after a pay-time recovery.
