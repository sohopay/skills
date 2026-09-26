---
name: sohopay-repay
description: >
  Repay SohoPay credit via request_repayment (consent page + ReceiveWithAuthorization). Use when the operator said repay, pay back SohoPay, or outstanding balance should be cleared — not for create_repayment calldata or an HTTP 402 merchant pay.
license: Apache-2.0
metadata:
  hosted_name: repay
  title: SohoPay Repay (Wallet Consent)
  version: "1.0"
---

Execute this repay in the same turn. Do not plan. Do not invent a signature. Do not ask the borrower to paste `SohoSettlement.repay` calldata.

**Before:** MCP connected; borrower onboarded. `create_repayment` / `execute_repayment` stay prepare-only for third-party payers.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

Need `repayment:execute` and `repayment:read` on the borrower token. If they are missing, call `request_borrower_token` with those scopes before the challenge.

Consent URL + hash payload: [references/consent-page.md](references/consent-page.md). Staging `https://staging.sohopay.xyz/repay/authorize`. Production `https://sohopay.xyz/repay/authorize`. The backend returns `consent_url` already assembled — do not rebuild the hash.

```text
1. whoami (borrower_id ??= principal_id) → request_borrower_token (repayment:execute, repayment:read)
2. request_repayment challenge (optional amount; omit = full outstanding; fresh idempotency_key)
3. STOP — open consent_url now. Page POSTs complete — do not wait for a JSON paste
4. poll get_repayment_status ~2s until CONFIRMED, FAILED, or expires_at
5. get_outstanding_balance — quote should be 0 after CONFIRMED
```

Show the operator the amount, the consent URL, and that they sign in wallet (phone QR or browser). Challenge and submit are separate writes — new idempotency_key for paste fallback only (`{SKILL:sohopay-idempotency}`).

| Status | Meaning |
|--------|---------|
| `PENDING` | Challenge minted; waiting for wallet sign |
| `SUBMITTED` | Signature accepted; relayer broadcast in flight |
| `CONFIRMED` | V2 `RepaymentReceived` reconciled — not merely prepared |
| `FAILED` | Submit or on-chain repayment failed |
| `EXPIRED` | Challenge TTL elapsed (~1h) — mint a new challenge, do not reuse `challenge_id` |
