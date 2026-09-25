## First-time merchant (`RISK_FIRST_TIME_MERCHANT`)

A first spend to a merchant this borrower has **no prior policy decision for** scores **35** (`RISK_FIRST_TIME_MERCHANT`) → MEDIUM → review → **DENY** (`signing_eligible: false`). Do **not** call `sign_transaction` on a DENY.

`SESSION_GATE_SKIPPED_NO_SESSION` on human-direct is **expected** (session gate skipped, status pass). It is not the deny reason. Do not create a session to "fix" it.

### Operator consent

When `evaluate_spend_policy` / prepare / settle returns `RISK_FIRST_TIME_MERCHANT`:

- **On a payRequest:** treat the pay utterance as accept for this merchant. Remember UUID **and** bytes32 `merchantId`. Retry without asking (`request_borrower_token` refresh, prepare, voucher sign / `X-PAYMENT`, settle). For prepare-route 403, reuse the **same** idempotency key.
- **No payRequest** (exploratory): STOP once and ask:

> Please accept first-time spend consent for this merchant (`merchantUuid` / on-chain `merchantId`). After you accept, I will not ask again for this merchant when you request pay.

- If they **refuse**, stop. Do not retry policy blindly.

### Signing-time vs settle-time (two merchant keys)

Policy runs **twice**, with **different merchant keys**. A signing-time **ALLOW** does not imply settle-time **ALLOW**.

| When | Merchant key for first-time lookup | Typical source |
|------|-------------------------------------|----------------|
| Signing-time (`evaluate_spend_policy`) | Spend-intent `merchant` / `merchant_id` (often the merchant **UUID**) | `create_spend_intent` |
| Settle-time (facilitator `/settle`) | PaymentIntent **`merchantId` (bytes32)** | `sign_transaction` `payment_intent.merchantId` |

Prior decisions count by **existence only** (a DENY row still counts). A UUID-keyed signing decision does **not** satisfy the bytes32 settle lookup, so the first `X-PAYMENT` can return `POLICY_DECISION_DENIED` + `RISK_FIRST_TIME_MERCHANT` even after signing ALLOW.

After a settle-time first-time DENY (payRequest already counts as consent; otherwise after explicit accept):

1. Do **not** replay the **same** `X-PAYMENT` — some merchants cache the 403 body/etag and will not re-call settle.
2. Create a **new** spend intent / prepare (new `idempotency_key` for settle-time envelope mint), evaluate, sign only if `ALLOW` + `signing_eligible`, and send a **new** payment header. The settle-time DENY row now exists under the bytes32 key, so the next settle re-eval should not flag first-time for that merchant.
3. Merchant **202** after the header means settle-time policy **allowed** that envelope (confirmation still pending).
