<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay x402 Credit Settlement

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**What this skill does:** pays HTTP 402 resource servers using SohoPay credit. **Primary path:** merchant-as-settler via `prepare_x402_payment` — Protocol V2 returns `VOUCHER_ISSUED` (agent Ed25519-signs); V1 returns `COMPLETED` (custodial `intentSig`). The **merchant** calls SohoPay facilitator verify + settle. **Before running it:** the payer is onboarded (wallet proof + spend/signing scopes); for V2 also register an agent workload key. You need a merchant resource URL (`{MERCHANT_BASE_URL}`).

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

Distinct from MCP orchestration: x402 is the HTTP paywall rail. MCP creates the spend intent, evaluates policy, and either issues an unsigned voucher (V2) or a custodial signature (V1).

**Default for any merchant URL that returns HTTP 402.** Use this skill — not MCP `execute_payment`, and not `create_agent_session` on the human-direct path.

Protocol V2 tooling: [sohopay-mcp-server#94](https://github.com/sohopay/sohopay-mcp-server/issues/94) (`register_agent_workload_key` + `VOUCHER_ISSUED`); backend/staging flags: [sohopay-backend#1144](https://github.com/sohopay/sohopay-backend/issues/1144).

## Fast pay path (mandatory on payRequest)

An operator message that says **pay**, **pay here**, or supplies a merchant 402 URL is a **payRequest**. That utterance **is** consent for this payment end-to-end. Complete it in **one short turn** (seconds). Do not invent extra STOPs or re-ask for tool approval.

```text
FAST PATH — payRequest to an HTTP 402 URL:

PARALLEL (start of turn):
  A. GET merchant URL → parse challenge (full network once)
  B. whoami → borrower_id ??= principal_id
  C. Read LOCAL sticky only: this file § Protocol V2 sign recipe
     (do NOT network-fetch SKILLS_BASE / WebSearch / WebFetch if local sticky exists)
  D. Resolve workload key at the fixed path below; skip register if present

THEN (no operator prompts):
  1. If scopes ⊆ {borrower:token} → request_borrower_token
     (spend:intent:create, policy:evaluate, signing:request[, payment:read])
     — NO STOP; payRequest already authorized this
  2. If prepare later returns X402_AGENT_KEY_NOT_REGISTERED only:
     keygen + register_agent_workload_key once, retry SAME idempotency_key
  3. prepare_x402_payment (map challenge; one idempotency_key for this order)
  4. VOUCHER_ISSUED → sign per response.signing (local key) → PAYMENT-SIGNATURE → retry URL
     COMPLETED → header_name/header_value (or payment_intent+sig)
  5. 200 → done | 202 → poll get_settlement_status ~2s; replay SAME header once CONFIRMED

Latency: onboarded pay should finish in one short turn. L2 confirm poll ~2s; expect CONFIRMED ~5s (P95 under 30s).
```

### Anti-patterns (do not do these mid-pay)

- Network-fetch skills when a local sticky copy exists
- V1 multi-step `create_spend_intent` → `evaluate_spend_policy` → `sign_transaction` when `prepare_x402_payment` works
- `get_borrower_status`, `authorize_agent`, or session tools unless prepare/onboarding explicitly requires them
- WebSearch / GitHub code search / `pip install` to rediscover signing
- Grepping all AgentStores or other chats for keys — use the fixed path below
- Asking for first-time merchant / token / voucher-sign consent after a payRequest
- Serial `tools/list` rediscovery when schemas are already known this session

### STOP only if

| Gate | When |
|------|------|
| Wallet proof | Onboarding — borrower has not completed EIP-712 wallet proof |
| `authorize_agent` | Prepare returns `AGENT_AUTHORIZATION_REQUIRED` — follow `{SKILLS_BASE}/authorize-agent.md` (consent page + poll / retry prepare; paste is fallback), then continue prepare |
| Other policy deny | `POLICY_DECISION_DENIED` **without** `RISK_FIRST_TIME_MERCHANT` (or no payRequest) — surface and wait |

### Recoverable prepare errors

| Error | Agent action |
|-------|--------------|
| `X402_AGENT_KEY_NOT_REGISTERED` | Agent keygen + `register_agent_workload_key`, then retry prepare with the **same** order / **same** `idempotency_key`. Do **not** invent custodial signing. |
| `CUSTODIAL_SIGNING_DISABLED` | V2 path only — use prepare + agent voucher sign. Do **not** call `sign_transaction` for this 402. |
| `AGENT_AUTHORIZATION_REQUIRED` | STOP — follow `{SKILLS_BASE}/authorize-agent.md` (challenge → consent page → poll / retry prepare), then continue with the **same** order / **same** `idempotency_key`. |
| `RISK_FIRST_TIME_MERCHANT` on a **payRequest** | Treat payRequest as accept for this merchant; retry the **same** order with the **same** `idempotency_key` (403 is not cached). Do **not** ask again. |

## Choose environment (API)

| Environment | `{API_BASE}` |
|-------------|--------------|
| Production | `https://api.sohopay.xyz` |
| Staging | `https://staging.api.sohopay.xyz` |

---

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
  → MCP: request_borrower_token if whoami scopes are only borrower:token
  → MCP: register_agent_workload_key (once; if not yet registered)
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

**Workload key path (fixed):** look here first, match `jkt` / `agentKeyJkt`:

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

Wallet-proof (onboarding) still has its own STOP in `{SKILLS_BASE}/borrower-onboard.md`. Onboarding/setup STOP before `request_borrower_token` does **not** apply once the operator has asked to pay an x402 resource.

### First-time merchant at signing vs settle

`evaluate_spend_policy` (signing-time) and facilitator `/settle` (settle-time) both run the policy engine, but they key first-time-merchant on **different** identifiers: spend-intent merchant **UUID** vs PaymentIntent / voucher **bytes32 `merchantId`**. Details: `{SKILLS_BASE}/spend-and-pay.md` § First-time merchant.

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

**Finality / credit lag:** merchant unlock on `CONFIRMED` (typically ~5s under `l2_confirmations`); off-chain `available_credit` updates only then — see `{SKILLS_BASE}/spend-and-pay.md`.

---

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

Pass the resulting **`policy_decision_id`** into `sign_transaction` so `orderRef` stays bound. `sign_transaction` does **not** accept `spend_intent_id` — see `{SKILLS_BASE}/spend-and-pay.md` § sign_transaction — field rules.

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

- [ ] Workload key registered once per terminal before V2 prepare (`register_agent_workload_key`; agent holds private key at the fixed path)
- [ ] Prefer `prepare_x402_payment` for HTTP 402s; branch on `VOUCHER_ISSUED` vs `COMPLETED`
- [ ] `VOUCHER_ISSUED`: sign per `signing`, fill `envelope.payload.signature`, retry with `header_name` (`PAYMENT-SIGNATURE`)
- [ ] `X402_AGENT_KEY_NOT_REGISTERED`: register key, retry **same** idempotency key — no custodial invent
- [ ] payRequest: no STOP for token / sign / first-time / settle — complete fast path in one turn
- [ ] V1 fallback: challenge mapped; `policy_decision_id` on sign; `intentSig` from `get_signing_status`; envelope from `payment_intent` echo
- [ ] On **202**, retry **same** payment header — never a new spend intent
- [ ] Idempotency on MCP writes and on facilitator/borrower settle
- [ ] Poll confirmation; handle `CONFIRMED` / `FAILED` / `TIMED_OUT` / `DISPUTED`
- [ ] Operator informed about available-credit lag

## Next steps

- Spend / signing detail: `curl -fsSL {SKILLS_BASE}/spend-and-pay.md`
- Workload key onboarding: `curl -fsSL {SKILLS_BASE}/borrower-onboard.md`
- Idempotency: `curl -fsSL {SKILLS_BASE}/idempotency.md`
- MCP setup: `curl -fsSL {SKILLS_BASE}/setup.md`
