## Primary: prepare_x402_payment (merchant-as-settler)

Reference implementation: [x402-merchant-server](https://github.com/sohopay/x402-merchant-server). Mode: `facilitator-settle`. Prefer the unlock header returned as **`header_name`** (Protocol V2: `PAYMENT-SIGNATURE`). Legacy multi-step V1 docs below still use `X-PAYMENT`.

`prepare_x402_payment` collapses spend intent + policy + signing into one call (`POST /api/v1/spend/x402/prepare`). Supply `order_ref` **or** `nonce` (at least one); `amount` as uint256 base units; optional `merchant` **XOR** `merchant_id` (never both / never cross-fill). Pass `idempotency_key` when the harness cannot set headers.

### Security boundary

| Party | Holds | Must never |
|-------|-------|------------|
| Agent / borrower | Borrower JWT; **agent-held** workload key (V2); or custodial `intentSig` via MCP (V1) | Send borrower JWT or workload **private** key to the merchant / MCP |
| Merchant | Merchant API key (`X-API-Key`) | Call borrower signing endpoints or learn signatures except inside a complete payment header |

### Agent flow (preferred)

```text
GET {MERCHANT_BASE_URL}/api/premium
  → 402 + challenge (X-SOHO-PAYMENT-REQUIRED / body.challenge)
  → cold: MCP register_borrower → operational_agent_id + terminal_id
  → MCP: request_borrower_token only if this chat has no successful token newer than 12 minutes (do not use whoami.scopes)
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
  "signing": { "…": "signing scheme — the signer reads this from the input file" },
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
| Sign + header | Route to the signer — see [references/signer.md](references/signer.md). The signer fills the signature and returns the `PAYMENT-SIGNATURE` header; the skill builds nothing. |

Do **not** call `sign_transaction` on this path. Do **not** expect a custodial `intentSig`.

### Protocol V2 sign — route to the signer

Do **not** hand-roll the signature or the header. Resolve a signer and run one call per
[references/signer.md](references/signer.md):

- Resolve a signer (`$SOHOPAY_SIGNER` → `sohopay-signer` → `npx --no @sohopay/agent-signer`);
  none answers → `SIGNER_UNAVAILABLE`, stop (never hand-sign).
- Follow the MCP sequence in [references/signer.md](references/signer.md): one Bash call
  `mktemp -d` (note the printed `<dir>`), write the prepare response byte-for-byte to
  `<dir>/prep.json` with the file-write tool, then one Bash call
  `voucher sign --envelope --key <secret.json path> --input <dir>/prep.json --write-header <dir>/hdr.txt`.
  `secret.json` is an **opaque** `--key` path — never read or parse it; the private key never
  enters `argv`/`stdin`.
- Assert `header_name === "PAYMENT-SIGNATURE"`; cross-check the signer's `payment_id` +
  `agent_key_jkt` against the prepare `voucher.paymentId` + `voucher.agentKeyJkt` (mismatch →
  stop, no retry). `header_value` is opaque; retry with `curl -fsS -H @<dir>/hdr.txt`, then
  delete the directory (`rm -rf <dir>`).
- Any nonzero exit / malformed output → surface the signer's code and stop before the retry.
  On a lapsed voucher or terminal retry failure, **re-prepare** (new `payment_id`) — never
  re-sign a stale envelope.

### Protocol V1 — `COMPLETED` (when V2 is off)

When prepare returns `COMPLETED`, retry the merchant with `header_name` / `header_value` when the gateway composes them; otherwise build `PAYMENT-SIGNATURE` from `payment_intent` + `signature` (`intentSig`). Custodial signing may be disabled on V2 staging (`CUSTODIAL_SIGNING_DISABLED`) — if so, use the V2 path above, not this branch.

### Operator consent on payRequest

A **payRequest** authorizes token refresh, prepare, agent voucher signing, merchant retry, and **first-time merchant** for that merchant in this turn.

- Do **not** STOP for `request_borrower_token`, voucher signing, payment-header retry, settle, or a separate first-time prompt.
- Call `request_borrower_token` only when this chat has no successful token newer than 12 minutes — no STOP. Do **not** use `whoami.scopes` as a refresh signal.
- Later pays to the **same** merchant: same silent fast path. Reuse the cached token and, if the merchant repeats the same `orderRef`, the same payment `idempotency_key`.

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
| POST | `{API_BASE}/api/v1/facilitator/capture` | Terminal money call. Requires `Idempotency-Key` (receipt replay 15 min); **200** `{ success, replayed, receipt:{ paymentId, … , signature } }`. Deliver on the receipt — there is no `POST /settle`; SohoPay settles captures on-chain in a scheduled batch (default every 60s) |
| GET | `{API_BASE}/api/v1/facilitator/settle/status/by-payment/:paymentId` | Poll with the receipt's `paymentId`: `CREATED` until batched → `SUBMITTED` (batch `jobId` = `confirm-batch-<uuid>`, `txHash`) → `CONFIRMED` / `FAILED` |
| GET | `{API_BASE}/api/v1/facilitator/settle/status/:jobId` | Same body keyed on the batch `jobId` above (numeric, `confirm-<uuid>`, `confirm-batch-<uuid>`) |
| POST | `{API_BASE}/api/v1/facilitator/verify-proof` | Proof verification (optional tooling) |
| GET | `{API_BASE}/api/v1/facilitator/supported` | Public discovery |

API key must be bound to the same merchant UUID as the resource server. Unbound key → `FACILITATOR_MERCHANT_BINDING_MISSING` (403).

**Finality / credit lag:** merchant unlock on `CONFIRMED` (typically ~5s under `l2_confirmations`); off-chain `available_credit` updates only then — see `{SKILL:sohopay-spend}`.

---
