## Primary: prepare_x402_payment (merchant-as-settler)

Reference implementation: [x402-merchant-server](https://github.com/sohopay/x402-merchant-server). Mode: `facilitator-settle`. Prefer the unlock header returned as **`header_name`** (Protocol V2: `PAYMENT-SIGNATURE`). Legacy multi-step V1 docs below still use `X-PAYMENT`.

`prepare_x402_payment` collapses spend intent + policy + signing into one call (`POST /api/v1/spend/x402/prepare`). Supply `order_ref` **or** `nonce` (at least one); `amount` as uint256 base units; optional `merchant` **XOR** `merchant_id` (never both / never cross-fill). Pass `idempotency_key` when the harness cannot set headers.

### Security boundary

| Party | Holds | Must never |
|-------|-------|------------|
| Agent / borrower | Borrower JWT; **agent-held** Ed25519 workload key (V2); or custodial `intentSig` via MCP (V1) | Send borrower JWT or workload **private** key to the merchant / MCP |
| Merchant | Merchant API key (`X-API-Key`) | Call borrower signing endpoints or learn signatures except inside a complete payment header |

### Agent flow (preferred)

```text
GET {MERCHANT_BASE_URL}/api/premium
  → 402 + challenge (X-SOHO-PAYMENT-REQUIRED / body.challenge)
  → cold: MCP register_borrower → operational_agent_id + terminal_id
  → MCP: request_borrower_token if whoami scopes are only borrower:token
  → MCP: register_agent_workload_key (once; if not yet registered for THIS borrower)
  → MCP: prepare_x402_payment (map challenge; no session_id)
  → branch on status:
       VOUCHER_ISSUED → agent signs → PAYMENT-SIGNATURE → retry
       COMPLETED      → header_name/header_value or payment_intent+signature → retry
  → GET {MERCHANT_BASE_URL}/api/premium  (same resource) with payment header
  → 200 resource  |  202 retry same header  |  402 with reason
```

### Protocol V2 — `VOUCHER_ISSUED`

When `X402_V2_ENABLED`, prepare returns an unsigned `AgentPaymentVoucher`. The **agent** signs it with the registered workload key — MCP does **not** custodial-sign.

Typical fields (use tool response, not this sketch, as source of truth):

```json
{
  "status": "VOUCHER_ISSUED",
  "spend_intent_id": "…",
  "decision_id": "…",
  "payment_id": "0x…",
  "voucher": {
    "paymentId": "0x…",
    "agentId": "…",
    "agentKeyJkt": "…",
    "merchantId": "0x…",
    "asset": "0x…",
    "chainId": "8453",
    "amount": "1000000",
    "feeAmount": "0",
    "orderRef": "0x…",
    "nonce": "…",
    "deadline": "…"
  },
  "signing": {
    "algorithm": "Ed25519",
    "domain_tag": "SohoPay:AgentPaymentVoucher:v2",
    "canonicalization": "RFC8785",
    "preimage": "utf8(domain_tag) || 0x00 || JCS(voucher)",
    "signature_encoding": "base64url"
  },
  "header_name": "PAYMENT-SIGNATURE",
  "envelope": {
    "x402Version": 2,
    "paymentPayload": {
      "x402Version": 2,
      "scheme": "credit",
      "network": "base",
      "payload": { "voucher": { "…": "…" }, "signature": null }
    }
  }
}
```

| Field / action | Source |
|----------------|--------|
| Unsigned voucher | `voucher` (also echoed inside `envelope.paymentPayload.payload.voucher`) |
| How to sign | `signing` — Ed25519 over preimage `utf8(domain_tag) + 0x00 + JCS(voucher)`; encode per `signature_encoding` |
| Fill signature | Set `envelope.paymentPayload.payload.signature` (was `null`) |
| Merchant header | Prefer `header_name` + `header_value` when present; else base64-encode the filled `envelope` as `PAYMENT-SIGNATURE` |

Do **not** call `sign_transaction` on this path. Do **not** expect a custodial `intentSig`.

### Protocol V2 sign recipe (copy this — do not rediscover)

**Workload key path (fixed):** look here first. Reuse only when **both** `borrower_id` (this borrower) **and** `jkt` / `agentKeyJkt` match. If the file is missing or `borrower_id` belongs to a different borrower, generate a fresh Ed25519 keypair for the current borrower — do not register another borrower's key.

```text
<Cursor AgentStores>/<this-or-known-store>/files/sohopay-agent-workload/secret.json
```

Canonical sticky copy when present:

```text
~/.agents/sohopay-agent-workload/secret.json
```

Shape:

```json
{
  "borrower_id": "…",
  "terminal_id": "mcp-staging",
  "private_key_base64url": "…",
  "public_jwk": { "kty": "OKP", "crv": "Ed25519", "x": "…" },
  "jkt": "…"
}
```

**Sign steps:**

1. Take `voucher` and `signing` from the prepare response (source of truth — do not re-fetch skills).
2. `jcs = RFC8785/JCS(voucher)` (e.g. npm `canonicalize`).
3. `preimage = utf8(signing.domain_tag) || 0x00 || utf8(jcs)`.
4. Ed25519-sign `preimage` with `private_key_base64url` (e.g. `@noble/curves/ed25519`).
5. Encode signature per `signing.signature_encoding` (usually `base64url`).
6. Set `envelope.paymentPayload.payload.signature` (was `null`).
7. Send `PAYMENT-SIGNATURE: <base64(JSON(envelope))>` (or use `header_value` if the tool already composed it). Prefer `header_name` from the response.

Deps: prefer Node already on the machine (`@noble/curves` + `canonicalize` from a local SohoPay checkout). **Do not** WebSearch, GitHub-search, or `pip install` unless this recipe fails.

### Protocol V1 — `COMPLETED` (when V2 is off)

When prepare returns `COMPLETED`, retry the merchant with `header_name` / `header_value` when the gateway composes them; otherwise build `PAYMENT-SIGNATURE` from `payment_intent` + `signature` (`intentSig`). Custodial signing may be disabled on V2 staging (`CUSTODIAL_SIGNING_DISABLED`) — if so, use the V2 path above, not this branch.

### Operator consent on payRequest

A **payRequest** authorizes token refresh, prepare, agent voucher signing, merchant retry, and **first-time merchant** for that merchant in this turn.

- Do **not** STOP for `request_borrower_token`, voucher signing, payment-header retry, settle, or a separate first-time prompt.
- If `whoami` scopes are only `borrower:token`, call `request_borrower_token` immediately — no STOP.
- Later pays to the **same** merchant: same silent fast path.

Wallet-proof (onboarding) still has its own STOP in `{SKILL:sohopay-onboard}`. Onboarding/setup STOP before `request_borrower_token` does **not** apply once the operator has asked to pay an x402 resource.

### First-time merchant at signing vs settle

`evaluate_spend_policy` (signing-time) and facilitator `/settle` (settle-time) both run the policy engine, but they key first-time-merchant on **different** identifiers: spend-intent merchant **UUID** vs PaymentIntent / voucher **bytes32 `merchantId`**. Details: `{SKILL:sohopay-spend}` § First-time merchant.

When a merchant returns 402 with `POLICY_DECISION_DENIED` + `RISK_FIRST_TIME_MERCHANT`:

1. On a **payRequest**, treat the pay utterance as accept — do **not** ask. Remember UUID **and** bytes32 `merchantId` for this conversation.
2. Do **not** replay the same payment header (merchants may cache the 403).
3. Mint a **new** prepare (new `idempotency_key` only when the denial was settle-time and a new envelope is required — for prepare-route 403 reuse the **same** key) → **new** payment header. A later **202** means settle-time policy allowed that envelope.
4. Only if there was **no** payRequest (e.g. exploratory prepare) ask once: **please accept first-time spend consent for this merchant.**

### Map 402 challenge → prepare / spend intent

From `challenge.payment` (and `challenge.resource`):

| Challenge field | Prepare / spend intent field |
|-----------------|------------------------------|
| `merchantUuid` or registry id | `merchant_id` **XOR** use `payTo` as `merchant` (address) — do not cross-fill |
| `amount` (atomic USDC) | `amount` (uint256 base units on prepare; or `amount_decimal` on standalone spend) |
| `orderRef` | `order_ref` |
| `resource.identifier` | `resource_identifier` (standalone spend) |
| network / asset / chain | `asset`, `chain_id` when required |

### Scopes for this flow

Merchant-as-settler needs `spend:intent:create`, `policy:evaluate`, and `signing:request`. Workload-key registration needs `borrower:token`. **`payment:execute` is not required** — the merchant settles, so the agent never calls `execute_payment`. Add `payment:read` if you want to poll settlement status yourself.

### Merchant HTTP contract (agent-facing)

| Status | Meaning | Agent action |
|--------|---------|--------------|
| **402** | Payment required or payment rejected | Read challenge / `reason`; fix binding or stop. If `reason` / body contains `POLICY_DECISION_DENIED` + `RISK_FIRST_TIME_MERCHANT`, follow § First-time merchant at signing vs settle — do **not** treat this like a 202 replay |
| **202** | Settle submitted; confirmation still pending | **Retry the identical payment header** (same envelope). Honor `Retry-After`. **Do not** create a new spend intent |
| **200** | Unlocked | Use resource; optional response header |

The 202 body carries `settlementId`, `jobId`, `paymentId`, and `facilitatorStatus` (typically `PENDING_CONFIRMATION`).

**Prefer status polling over header replay.** Confirmation uses **`l2_confirmations`** (L2 receipt + depth) — expect `CONFIRMED` in **~5 seconds** after a successful receipt (P95 under 30s). Poll about every **2 seconds**. If the agent holds `payment:read`, poll `get_settlement_status` with the `settlementId` from the 202 body until the status is terminal, then send the identical payment header **once** to collect the resource. Replaying the header is safe when you do need it — settle is idempotent for 72h and the confirmation worker re-polls the same `txHash` — but prefer a short poll loop over tight `Retry-After` header spam.

### What the merchant does (for operators)

Merchant calls SohoPay with `X-API-Key` (never the borrower JWT):

| Method | Path | Notes |
|--------|------|-------|
| POST | `{API_BASE}/api/v1/facilitator/verify` | Gate-1 verify; body = envelope |
| POST | `{API_BASE}/api/v1/facilitator/settle` | Requires `Idempotency-Key` (72h TTL); **202** |
| GET | `{API_BASE}/api/v1/facilitator/settle/status/:jobId` | Poll until `CONFIRMED` or terminal |
| POST | `{API_BASE}/api/v1/facilitator/verify-proof` | Proof verification (optional tooling) |
| GET | `{API_BASE}/api/v1/facilitator/supported` | Public discovery |

API key must be bound to the same merchant UUID as the resource server. Unbound key → `FACILITATOR_MERCHANT_BINDING_MISSING` (403).

**Finality / credit lag:** merchant unlock on `CONFIRMED` (typically ~5s under `l2_confirmations`); off-chain `available_credit` updates only then — see `{SKILL:sohopay-spend}`.

---
