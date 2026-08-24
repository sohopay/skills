<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay x402 Credit Settlement

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**What this skill does:** pays HTTP 402 resource servers using SohoPay credit. **Primary path:** merchant-as-settler — the agent signs a PaymentIntent via MCP and retries with `X-PAYMENT`; the **merchant** calls SohoPay facilitator verify + settle. **Before running it:** the payer is onboarded (wallet proof + spend/signing scopes) and you have a merchant resource URL (`{MERCHANT_BASE_URL}`).

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

Distinct from MCP orchestration: x402 is the HTTP paywall rail. MCP still creates the spend intent, evaluates policy, and produces the `intentSig`.

## Choose environment (API)

| Environment | `{API_BASE}` |
|-------------|--------------|
| Production | `https://api.sohopay.xyz` |
| Staging | `https://staging.api.sohopay.xyz` |

---

## Primary: merchant-as-settler (agent pays with X-PAYMENT)

Reference implementation: [x402-merchant-server](https://github.com/sohopay/x402-merchant-server). Mode: `facilitator-settle`. Unlock header: **`X-PAYMENT`** only (legacy proof / settlement-ref headers are removed).

### Security boundary

| Party | Holds | Must never |
|-------|-------|------------|
| Agent / borrower | Borrower JWT; signs via MCP | Send borrower JWT to the merchant |
| Merchant | Merchant API key (`X-API-Key`) | Call borrower signing endpoints or learn `intentSig` except inside a complete `X-PAYMENT` |

### Agent flow

```text
GET {MERCHANT_BASE_URL}/api/premium
  → 402 + challenge (X-SOHO-PAYMENT-REQUIRED / body.challenge)
  → MCP: create_spend_intent (map challenge.payment fields)
  → MCP: evaluate_spend_policy
  → MCP: sign_transaction (pass policy_decision_id) → keep the payment_intent echo
  → MCP: get_signing_status → signature = intentSig
  → Build FacilitatorPaymentEnvelope → base64 → X-PAYMENT
  → GET {MERCHANT_BASE_URL}/api/premium  (same resource) with X-PAYMENT
  → 200 resource  |  202 retry same header  |  402 with reason
```

Before signing and before any real credit movement:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

### Map 402 challenge → create_spend_intent

From `challenge.payment` (and `challenge.resource`):

| Challenge field | Spend intent field |
|-----------------|--------------------|
| `merchantUuid` or registry id | `merchant_id` **XOR** use `payTo` as `merchant` (address) — do not cross-fill |
| `amount` (atomic USDC) | `amount` (or equivalent `amount_decimal`) |
| `orderRef` | `order_ref` |
| `resource.identifier` | `resource_identifier` |
| network / asset / chain | `asset`, `chain_id` when required |

Then evaluate policy and pass the resulting **`policy_decision_id`** into `sign_transaction` so `orderRef` stays bound to the intent. `sign_transaction` does **not** accept `spend_intent_id` — see `{SKILLS_BASE}/spend-and-pay.md` § sign_transaction — field rules.

### Scopes for this flow

Merchant-as-settler needs only `spend:intent:create`, `policy:evaluate`, and `signing:request`. **`payment:execute` is not required** — the merchant settles, so the agent never calls `execute_payment`. Add `payment:read` if you want to poll settlement status yourself.

### Build X-PAYMENT

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

### Merchant HTTP contract (agent-facing)

| Status | Meaning | Agent action |
|--------|---------|--------------|
| **402** | Payment required or payment rejected | Read challenge / `reason`; fix binding or stop |
| **202** | Settle submitted; confirmation still pending | **Retry the identical `X-PAYMENT`** (same envelope). Honor `Retry-After`. **Do not** create a new spend intent |
| **200** | Unlocked | Use resource; optional `X-PAYMENT-RESPONSE` header |

The 202 body carries `settlementId`, `jobId`, `paymentId`, and `facilitatorStatus` (typically `PENDING_CONFIRMATION`).

**Prefer status polling over header replay.** `Retry-After` is usually ~2s, but Base L2 confirmation takes ~15–19 minutes, so a tight retry loop means hundreds of pointless replays of a payment authorization header. If the agent holds `payment:read`, poll `get_settlement_status` with the `settlementId` from the 202 body until the status is terminal, then send the identical `X-PAYMENT` **once** to collect the resource. Replaying the header is safe when you do need it — settle is idempotent for 72h and the confirmation worker re-polls the same `txHash` — but it is not a way to make settlement finish sooner.

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

**Finality / credit lag:** merchant unlock on `CONFIRMED` still leaves off-chain `available_credit` subject to the same lag as MCP — tell the operator; see `{SKILLS_BASE}/spend-and-pay.md`.

---

## Secondary: borrower-direct settle (`/api/v2/x402`)

Use when the **agent/borrower** settles against SohoPay directly (no merchant facilitator unlock). Canonical mount: **`{API_BASE}/api/v2/x402/`**.

| Method | Path | Auth | Idempotency |
|--------|------|------|-------------|
| POST | `/check-eligibility` | Public | — |
| POST | `/check-nonce` | Public | — |
| POST | `/verify` | Public | — |
| POST | `/settle` | JWT + 2FA + `x402:settle:create` | Required, 72h |
| GET | `/settle/status/:jobId` | JWT | — |
| GET | `/health` | Public | — |

Always **verify before settle**. Settle returns **202** with `{ txHash, jobId, settlementId, status }` — poll until terminal.

Unlinked wallets on verify may return HTTP 200 with `isValid: false` (`BORROWER_WALLET_UNKNOWN`, `BORROWER_WALLET_NOT_VERIFIED`).

Policy denial: HTTP 403 with `reasonCodes` / `policyDecisionId` — surface to user; do not retry blindly.

### Legacy mount (do not use for new integrations)

`{API_BASE}/api/v1/x402/v2/*` is **deprecated** (same handlers; RFC 8594 deprecation headers). **Sunset: 2027-02-10.** Successor: `/api/v2/x402`.

---

## Integration checklist

- [ ] Merchant-as-settler: challenge mapped; `policy_decision_id` on sign; `intentSig` from `get_signing_status`
- [ ] Envelope built from the `sign_transaction` `payment_intent` echo, not hand-assembled from the challenge
- [ ] `X-PAYMENT` envelope `x402Version: 2`, `scheme: "credit"`, bindings match challenge
- [ ] On **202**, retry **same** `X-PAYMENT` — never a new spend intent
- [ ] Idempotency on MCP writes and on facilitator/borrower settle
- [ ] Poll confirmation; handle `CONFIRMED` / `FAILED` / `TIMED_OUT` / `DISPUTED`
- [ ] Operator informed about available-credit lag

## Next steps

- Spend / signing detail: `curl -fsSL {SKILLS_BASE}/spend-and-pay.md`
- Idempotency: `curl -fsSL {SKILLS_BASE}/idempotency.md`
- MCP setup: `curl -fsSL {SKILLS_BASE}/setup.md`
