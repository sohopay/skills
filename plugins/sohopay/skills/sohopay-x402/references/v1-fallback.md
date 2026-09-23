## V1 fallback: multi-step sign_transaction → X-PAYMENT (when V2 is off)

Use when `prepare_x402_payment` is unavailable, or when V2 is off and you follow the custodial path explicitly. Unlock header: **`X-PAYMENT`**.

```text
GET {MERCHANT_BASE_URL}/api/premium
  → 402 + challenge
  → MCP: request_borrower_token if whoami scopes are only borrower:token
  → MCP: create_spend_intent (map challenge.payment fields; no session_id)
  → MCP: evaluate_spend_policy → keep decision_id
  → MCP: sign_transaction (policy_decision_id; payload: {} object) → keep the payment_intent echo
  → MCP: get_signing_status → signature = intentSig
  → Build FacilitatorPaymentEnvelope → base64 → X-PAYMENT
  → GET same resource with X-PAYMENT
```

Pass the resulting **`policy_decision_id`** into `sign_transaction` so `orderRef` stays bound. `sign_transaction` does **not** accept `spend_intent_id` — see `{SKILL:sohopay-spend}` § sign_transaction — field rules.

### Build X-PAYMENT (V1)

Envelope (`x402Version: 2`, `scheme: "credit"`):

```json
{
  "x402Version": 2,
  "paymentPayload": {
    "x402Version": 2,
    "scheme": "credit",
    "network": "eip155:84532",
    "payload": {
      "agentId": "0x…",
      "merchantId": "0x…",
      "asset": "0x…",
      "amount": "10000",
      "feeAmount": "0",
      "orderRef": "0x…",
      "nonce": "…",
      "deadline": "…",
      "intentSig": "0x…"
    }
  }
}
```

Where each field comes from — do **not** hand-build these from the 402 challenge:

| Field | Source |
|-------|--------|
| `agentId`, `merchantId`, `asset`, `amount`, `feeAmount`, `orderRef`, `nonce`, `deadline` | The **`payment_intent` echo** returned by `sign_transaction`. Copy it verbatim. |
| `intentSig` | `signature` from `get_signing_status` once status is `COMPLETED`. |

- `agentId` and `merchantId` are **bytes32 protocol identifiers**, not EVM addresses. The challenge's `payTo` address is not `merchantId`, and the borrower wallet is not `agentId`.
- `intentSig` must be a 65-byte ECDSA hex signature — `0x` plus 130 hex characters (132 total). Validate the length before sending; a truncated or redacted value fails at the facilitator.
- PaymentIntent fields must match the signed payload and the 402 challenge bindings (`merchantId`, `orderRef`, `asset`, `amount`).
- Send as header `X-PAYMENT: <base64 of JSON>` (some merchants also accept raw JSON).

Credential-free helper in the reference merchant repo: `src/agent/build-x-payment.ts`.

On V2 staging, `sign_transaction` may return `CUSTODIAL_SIGNING_DISABLED` — switch to prepare + agent voucher sign instead of inventing a signature.

---
