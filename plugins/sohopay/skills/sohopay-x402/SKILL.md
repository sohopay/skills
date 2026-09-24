---
name: sohopay-x402
description: >
  Pay HTTP 402 merchants with prepare_x402_payment, VOUCHER_ISSUED, and merchant-as-settler PAYMENT-SIGNATURE. Use when a URL returns 402, X-PAYMENT, facilitator settle, or borrower-direct /api/v2/x402 — never execute_payment or create_agent_session on human-direct.
license: Apache-2.0
metadata:
  hosted_name: x402-credit-pay
  title: SohoPay x402 Credit Settlement
  version: "1.0"
---

Execute the fast path. Do not write a plan. Do not fetch extra skills mid-pay if this file (or sticky `sohopay-x402`) is already loaded.

**Primary path:** `prepare_x402_payment` — V2 `VOUCHER_ISSUED` (agent Ed25519-signs) or V1 `COMPLETED`. Merchant settles. Never `execute_payment` / `create_agent_session` on human-direct.

**Before:** onboarding is complete — wallet proof, spend scopes, this host's terminal, a registered workload key, and an **ACTIVE** agent grant. If prepare returns `X402_AGENT_KEY_NOT_REGISTERED` or `AGENT_AUTHORIZATION_REQUIRED`, onboard was skipped — follow § Recovery if onboard was skipped before iterating prepare.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

A **payRequest** (“pay” / merchant 402 URL) is consent for token refresh, prepare, voucher sign, merchant retry, and first-time merchant. Complete the **warm** path in one short turn. `whoami` showing only `borrower:token` is token expiry — refresh and stay on the warm path. Do not re-run register, keygen, or `authorize_agent` for expiry.

```text
PARALLEL: GET merchant URL | whoami (borrower_id ??= principal_id) | resolve workload key
1. Warm: request_borrower_token if scopes ⊆ {borrower:token} — NO STOP (expiry, not re-onboard)
2. prepare_x402_payment
3. X402_AGENT_KEY_NOT_REGISTERED or AGENT_AUTHORIZATION_REQUIRED → § Recovery, then retry SAME idempotency_key
4. VOUCHER_ISSUED → open references/prepare-and-voucher.md and follow Sign steps (do not search). Key file: ~/.agents/sohopay-agent-workload/secret.json (reuse only if borrower_id and jkt match). Then PAYMENT-SIGNATURE and retry the URL
   COMPLETED → header_name/header_value
5. 200 done | 202 poll get_settlement_status(~2s) by settlement_id; replay SAME header once CONFIRMED
```

### Recovery if onboard was skipped

Do not discover prerequisites by serial 403s. Finish **sohopay-onboard** (`{SKILL:sohopay-onboard}`) once, then retry the **same** order / **same** key.

```text
whoami → register_borrower (store operational_agent_id)
  → request_borrower_token (include credit:facility:accept) — no chat prompt
  → keygen + register_agent_workload_key
  → authorize_agent: open consent URL in this turn — sohopay-authorize-agent
  → after Grant active: prepare SAME order / SAME idempotency_key
```

### STOP only if

| Gate | When |
|------|------|
| Wallet proof | Only if not already verified — off-device signature in this turn. Do not ask a chat question first |
| `authorize_agent` | Recovery only — `AGENT_AUTHORIZATION_REQUIRED`. Open the consent page in this turn. Do not ask first. Do not re-GET the merchant |
| Other policy deny | `POLICY_DECISION_DENIED` without `RISK_FIRST_TIME_MERCHANT` (or no payRequest) |

| Error | Action |
|-------|--------|
| `X402_AGENT_KEY_NOT_REGISTERED` | Terminal + key, retry same key — no custodial invent |
| `CUSTODIAL_SIGNING_DISABLED` | V2 voucher path only |
| `AGENT_AUTHORIZATION_REQUIRED` | Open consent page this turn — `{SKILL:sohopay-authorize-agent}` |
| `RISK_FIRST_TIME_MERCHANT` on payRequest | Accept; retry same order/key |
| `X402_INTENT_EXPIRED` | Retry same order/key — do not mint a new merchant `orderRef` |

Sign recipe + challenge map: [references/prepare-and-voucher.md](references/prepare-and-voucher.md). V1 `X-PAYMENT`: [references/v1-fallback.md](references/v1-fallback.md). Borrower-direct `/api/v2/x402`: [references/borrower-direct.md](references/borrower-direct.md). First-time merchant keys: **sohopay-spend**.

| Environment | `{API_BASE}` |
|-------------|--------------|
| Production | `https://api.sohopay.xyz` |
| Staging | `https://staging.api.sohopay.xyz` |
