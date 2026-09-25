---
name: sohopay-authorize-agent
description: >
  Obtain an ACTIVE AgentAuthorizationGrant via authorize_agent (consent page + borrower EIP-712). Use when onboarding just registered the workload key, or prepare_x402_payment returns AGENT_AUTHORIZATION_REQUIRED — not for wallet-proof or voucher Ed25519 signing.
license: Apache-2.0
metadata:
  hosted_name: authorize-agent
  title: SohoPay Authorize Agent (Borrower Grant)
  version: "1.0"
---

Execute this grant in the same turn. Do not plan. Do not fall back to `sign_transaction`. Do not ask a chat question before the consent URL.

**Before:** MCP connected; wallet proof done; workload key registered. **Primary trigger:** onboarding, immediately after `register_agent_workload_key` (`{SKILL:sohopay-onboard}`). `prepare_x402_payment` → `AGENT_AUTHORIZATION_REQUIRED` is recovery only (onboard was skipped).

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

Consent URL + hash payload: [references/consent-page.md](references/consent-page.md). Staging `https://staging.sohopay.xyz/agent/authorize`. Production `https://sohopay.xyz/agent/authorize`.

Onboarding defaults (no pending merchant): `max_per_payment=1000000` (1 USDC), `daily_limit=5000000` (5 USDC), `valid_until` ~7 days, omit `allowed_merchant_ids`. On pay-time recovery, cover the pending payment.

Need `credit:facility:accept` on the borrower token. If it is missing, call `request_borrower_token` with that scope before the challenge. Do **not** ask before that token call.

```text
1. authorize_agent challenge (operational_agent_id, terms, fresh idempotency_key)
2. Open consent URL now (hash payload). Page POSTs complete — do not wait for a JSON paste
3. Onboarding: wait only for Grant active on the page — do not call prepare with no order
   Pay-time recovery: retry prepare_x402_payment SAME order / SAME payment idempotency_key
4. VOUCHER_ISSUED → continue sohopay-x402. Do not re-GET the merchant
```

Challenge and submit are separate writes — new idempotency_key for submit fallback only. Continue `{SKILL:sohopay-x402}` only after a pay-time recovery.
