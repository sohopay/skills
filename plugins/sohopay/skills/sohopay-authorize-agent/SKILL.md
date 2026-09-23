---
name: sohopay-authorize-agent
description: >
  Obtain an ACTIVE AgentAuthorizationGrant via authorize_agent (consent page + borrower EIP-712). Use when prepare_x402_payment returns AGENT_AUTHORIZATION_REQUIRED — not for wallet-proof onboarding or voucher Ed25519 signing.
license: Apache-2.0
metadata:
  hosted_name: authorize-agent
  title: SohoPay Authorize Agent (Borrower Grant)
  version: "1.0"
---

Execute this grant, then retry prepare. Do not plan. Do not fall back to `sign_transaction`.

**Before:** MCP connected; wallet proof done; workload key registered. Usual trigger: `prepare_x402_payment` → `AGENT_AUTHORIZATION_REQUIRED`.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

Consent URL + hash payload: [references/consent-page.md](references/consent-page.md). Staging `https://staging.sohopay.xyz/agent/authorize`. Production `https://sohopay.xyz/agent/authorize`.

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

```text
1. authorize_agent challenge (operational_agent_id, terms, fresh idempotency_key)
2. Open consent URL (hash payload). Page POSTs complete — do not wait for JSON paste
3. Retry prepare_x402_payment SAME order / SAME payment idempotency_key
4. VOUCHER_ISSUED → continue sohopay-x402. Do not re-GET the merchant
```

Challenge and submit are separate writes — new idempotency_key for submit fallback only. Need `credit:facility:accept` on the borrower token. Continue `{SKILL:sohopay-x402}`.
