## Signing and intentSig

Use this section for **non-x402 spend** and the **V1 multi-step** path. For HTTP 402s under Protocol V2, prefer `prepare_x402_payment` — if prepare returns `VOUCHER_ISSUED` or `sign_transaction` returns `CUSTODIAL_SIGNING_DISABLED`, do **not** use this custodial path.

1. Call `sign_transaction` with `borrower_id`, `signing_purpose`, `payload_type`, `payload`, and **`policy_decision_id`** (the `decision_id` returned by `evaluate_spend_policy`).
2. Keep `request_id` from the accepted response. The response also echoes **`payment_intent`** — `agentId`, `merchantId`, `asset`, `amount`, `feeAmount`, `orderRef`, `nonce`, `deadline`. Keep it: these are the exact wire values an `X-PAYMENT` envelope needs, and `nonce` / `deadline` are not available from any other tool.
3. Poll `get_signing_status` until `COMPLETED`.
4. The returned **`signature`** is the unredacted **`intentSig`** (Envelope 1 over PaymentIntent). Use it for merchant `X-PAYMENT` envelopes and for borrower-direct x402 settle. It is the only tool response field exempt from MCP redaction on this path.

### sign_transaction — field rules

| Rule | Detail |
|------|--------|
| Binding | **`policy_decision_id` is required in practice.** The gateway maps it to `decision_id` and hydrates merchant / asset / amount / `orderRef` from the bound policy decision, keeping the PaymentIntent byte-identical across sign → settle. The backend signing DTO declares `decision_id` as a required UUID. |
| `spend_intent_id` | **Not accepted by this tool.** It is absent from the MCP signing schema and silently stripped, so passing it changes nothing. Bind through `policy_decision_id` — the decision already points at the spend intent. |
| `payload` | Must be a **JSON object**, not a string. Pass `{}` when you have no precomputed hash — never a stringified `"{}"`. Only `payload.payload_hash` is forwarded to the backend; every other key stays local. |
| `signing_purpose` / `payload_type` | Required by the tool schema but **not forwarded**; the gateway derives signing mode from `decision_id`. |

Before requesting a signature:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

On an **HTTP 402 / merchant-as-settler** payRequest, do **not** STOP for signing / voucher sign / first-time — see § First-time merchant and `{SKILL:sohopay-x402}` § Fast pay path.
