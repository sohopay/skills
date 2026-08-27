<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay x402 Credit Settlement

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**What this skill does:** pays HTTP 402 resource servers using SohoPay credit. **Primary path:** merchant-as-settler — the agent signs a PaymentIntent via MCP and retries with `X-PAYMENT`; the **merchant** calls SohoPay facilitator verify + settle. **Before running it:** the payer is onboarded (wallet proof + spend/signing scopes) and you have a merchant resource URL (`{MERCHANT_BASE_URL}`).

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

Distinct from MCP orchestration: x402 is the HTTP paywall rail. MCP still creates the spend intent, evaluates policy, and produces the `intentSig`.

**Default for any merchant URL that returns HTTP 402.** Use this skill — not MCP `execute_payment`, and not `create_agent_session` on the human-direct path.

## Human-direct paywall checklist (mandatory)

```text
HTTP 402 merchant paywall (human-direct):
1. whoami → borrower_id ??= principal_id
2. If scopes are only borrower:token → request_borrower_token
   (spend:intent:create, policy:evaluate, signing:request[, payment:read])
3. create_spend_intent from challenge (merchant_id XOR merchant; amount; order_ref; resource_identifier)
4. evaluate_spend_policy → keep decision_id
5. sign_transaction(policy_decision_id, payload: {} as object, payload_type EIP712)
6. get_signing_status → signature = intentSig; keep payment_intent echo
7. Build X-PAYMENT (scheme credit) → retry same URL
8. On 202: poll get_settlement_status(settlementId); replay SAME X-PAYMENT once CONFIRMED

Do NOT:
- create_agent_session / pass session_id on this path
- call execute_payment (merchant settles via facilitator)
- send payload as a stringified "{}"
- mint a new spend intent when retrying a 202
```

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
  → MCP: request_borrower_token if whoami scopes are only borrower:token
  → MCP: create_spend_intent (map challenge.payment fields; no session_id)
  → MCP: evaluate_spend_policy
  → MCP: sign_transaction (policy_decision_id; payload: {} object) → keep the payment_intent echo
  → MCP: get_signing_status → signature = intentSig
  → Build FacilitatorPaymentEnvelope → base64 → X-PAYMENT
  → GET {MERCHANT_BASE_URL}/api/premium  (same resource) with X-PAYMENT
  → 200 resource  |  202 retry same header  |  402 with reason
```

### Operator consent — first-time merchant only

On an x402 payRequest, ask the operator **once** for first-time spend consent for this merchant (see § First-time merchant below). After they accept:

- Do **not** STOP again for `request_borrower_token`, signing, `X-PAYMENT`, or settle.
- If `whoami` scopes are only `borrower:token`, call `request_borrower_token` **without** a STOP — token refresh is part of completing the pay.
- Later pays to the **same** merchant: complete merchant-as-settler end-to-end with **no** further operator questions.

Wallet-proof (onboarding) still has its own STOP in `{SKILLS_BASE}/borrower-onboard.md`. Onboarding/setup STOP before `request_borrower_token` does **not** apply once the operator has asked to pay an x402 resource.

### First-time merchant at signing vs settle

`evaluate_spend_policy` (signing-time) and facilitator `/settle` (settle-time) both run the policy engine, but they key first-time-merchant on **different** identifiers: spend-intent merchant **UUID** vs PaymentIntent **bytes32 `merchantId`**. Details and the once-per-merchant consent prompt: `{SKILLS_BASE}/spend-and-pay.md` § First-time merchant.

When signing-time is `ALLOW` but `X-PAYMENT` returns 402 with `POLICY_DECISION_DENIED` + `RISK_FIRST_TIME_MERCHANT`:

1. If the operator has **not** yet accepted first-time spend for this merchant, ask once: **please accept first-time spend consent for this merchant.** After they accept, do **not** re-ask on later pays to that merchant.
2. If they **already** accepted, do **not** ask again — mint a new envelope immediately.
3. Do **not** replay the same `X-PAYMENT` (merchants may cache the 403).
4. Mint a **new** spend intent → evaluate → sign → **new** `X-PAYMENT` (no extra STOP after consent). A later **202** means settle-time policy allowed that envelope.

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
| **402** | Payment required or payment rejected | Read challenge / `reason`; fix binding or stop. If `reason` / body contains `POLICY_DECISION_DENIED` + `RISK_FIRST_TIME_MERCHANT`, follow § First-time merchant at signing vs settle — do **not** treat this like a 202 replay |
| **202** | Settle submitted; confirmation still pending | **Retry the identical `X-PAYMENT`** (same envelope). Honor `Retry-After`. **Do not** create a new spend intent |
| **200** | Unlocked | Use resource; optional `X-PAYMENT-RESPONSE` header |

The 202 body carries `settlementId`, `jobId`, `paymentId`, and `facilitatorStatus` (typically `PENDING_CONFIRMATION`).

**Prefer status polling over header replay.** Confirmation uses **`l2_confirmations`** (L2 receipt + depth) — expect `CONFIRMED` in **~5 seconds** after a successful receipt (P95 under 30s). Poll about every **2 seconds**. If the agent holds `payment:read`, poll `get_settlement_status` with the `settlementId` from the 202 body until the status is terminal, then send the identical `X-PAYMENT` **once** to collect the resource. Replaying the header is safe when you do need it — settle is idempotent for 72h and the confirmation worker re-polls the same `txHash` — but prefer a short poll loop over tight `Retry-After` header spam.

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

**Finality / credit lag:** merchant unlock on `CONFIRMED` (typically ~5s under `l2_confirmations`); off-chain `available_credit` updates only then — see `{SKILLS_BASE}/spend-and-pay.md`.

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
- [ ] First-time merchant: once-per-merchant consent; after accept, later pays need no further prompts; new envelope after settle-time `RISK_FIRST_TIME_MERCHANT` (not a cached-403 replay)

## Next steps

- Spend / signing detail: `curl -fsSL {SKILLS_BASE}/spend-and-pay.md`
- Idempotency: `curl -fsSL {SKILLS_BASE}/idempotency.md`
- MCP setup: `curl -fsSL {SKILLS_BASE}/setup.md`
