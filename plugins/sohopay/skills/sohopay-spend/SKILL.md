---
name: sohopay-spend
description: >
  Create spend intents, evaluate policy, and sign PaymentIntents (policy_decision_id, intentSig). Use when creating spend, evaluate_spend_policy, sign_transaction, RISK_FIRST_TIME_MERCHANT, or polling settlement_id — not for assembling X-PAYMENT or VOUCHER_ISSUED.
license: Apache-2.0
metadata:
  hosted_name: spend-and-pay
  title: SohoPay Spend, Policy, and Signing
  version: "1.0"
---

HTTP 402 → **sohopay-x402** (`prepare_x402_payment`). This skill is the non-x402 / V1 multi-step path and first-time merchant rules.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

`idempotency_key` on writes — `{SKILL:sohopay-idempotency}`. Default operate: `{SKILL:sohopay-human-direct}`.

**V1 / non-x402:** `create_spend_intent` → `evaluate_spend_policy` → `sign_transaction(policy_decision_id, payload: {})` → `get_signing_status` (`signature` = `intentSig`) → x402 settle → poll `settlement_id`.

Merchant XOR `merchant`/`merchant_id`. Amount XOR `amount`/`amount_decimal`. `sign_transaction` does **not** accept `spend_intent_id`. Signing: [references/signing.md](references/signing.md).

First-time merchant: [references/first-time-merchant.md](references/first-time-merchant.md). On a payRequest treat as accepted. Settle uses bytes32 `merchantId` — signing ALLOW can still DENY at settle.

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

Only when there is **no** payRequest and policy is first-time / high-risk.

Settlement: [references/settlement.md](references/settlement.md). Poll `settlement_id`; credit after `CONFIRMED` (`l2_confirmations`, ~5s).
