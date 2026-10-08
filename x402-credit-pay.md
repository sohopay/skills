<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1
     SKILLS_HOST (CDN origin): https://agents.sohopay.xyz
     Fetch order: local sticky → {SKILLS_BASE} → GitHub raw last-resort.
     Publish rewrites SKILLS_BASE to Prod and {SKILLS_HOST} to the origin. -->
<!-- Generated from plugins/sohopay/skills — do not hand-edit this file. Run npm run generate:hosted -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay x402 Credit Settlement

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

Execute the fast path. Do not write a plan. Do not fetch extra skills mid-pay if this file (or sticky `sohopay-x402`) is already loaded.

**Primary path:** `prepare_x402_payment` — V2 `VOUCHER_ISSUED` (agent Ed25519-signs) or V1 `COMPLETED`. Merchant settles. Never `execute_payment` / `create_agent_session` on human-direct.

**Before:** onboarding is complete — wallet proof, spend scopes, this host's terminal, a registered workload key, and an **ACTIVE** agent grant. If prepare returns `X402_AGENT_KEY_NOT_REGISTERED` or `AGENT_AUTHORIZATION_REQUIRED`, onboard was skipped — follow § Recovery if onboard was skipped before iterating prepare. Context should already be established via `{SKILLS_BASE}/bootstrap.md` (v8+ `get_context`; v7 `whoami` + `get_borrower_status`) — do not fetch it mid-pay if this file is already loaded.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

A **payRequest** (“pay” / merchant 402 URL) is consent for a stale-token refresh, prepare, voucher sign, merchant retry, and first-time merchant. Complete a **warm** pay in **three waves, under 15 seconds**. Do not chat between waves. Skip `whoami`. `whoami.scopes` of `["borrower:token"]` is the OAuth JWT, not expiry.

Session cache: `borrower_id`, `operational_agent_id`, `token_requested_at` + `expires_in`, and the payment `idempotency_key` already used for this `orderRef`. Same `orderRef` → same payment key.

```text
Wave 1 (parallel): GET merchant URL | request_borrower_token ONLY if this chat has no successful token newer than 12 minutes (NO STOP) | reuse cached borrower_id + operational_agent_id
Wave 2: prepare_x402_payment (one idempotency_key per orderRef)
  X402_AGENT_KEY_NOT_REGISTERED or AGENT_AUTHORIZATION_REQUIRED → § Recovery, then retry SAME key
  RISK_FIRST_TIME_MERCHANT → retry SAME key
Wave 3: VOUCHER_ISSUED → route signing to the signer (references/signer.md): the signer's envelope mode (one file-based call) with the opaque --key (canonical path in references/signer.md); use the signer's header file (curl -fsS -H @<hdrfile>) and retry the URL. No signer → SIGNER_UNAVAILABLE, stop
  COMPLETED → header_name/header_value
  200 done | 202 poll get_settlement_status(~2s) by settlement_id; replay SAME header once CONFIRMED
SKIP: whoami, get_borrower_status, tools/list, authorization-context, register_borrower, authorize_agent
```

### Recovery if onboard was skipped

Do not discover prerequisites by serial 403s. `whoami.scopes` of `["borrower:token"]` is not a reason to re-onboard. Finish **sohopay-onboard** (`{SKILLS_BASE}/borrower-onboard.md`) once, then retry the **same** order / **same** key.

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
| `AGENT_AUTHORIZATION_REQUIRED` | Open consent page this turn — `{SKILLS_BASE}/authorize-agent.md` |
| `RISK_FIRST_TIME_MERCHANT` on payRequest | Accept; retry same order/key |
| `X402_INTENT_EXPIRED` | Retry same order/key — do not mint a new merchant `orderRef` |

Sign recipe + challenge map: [references/prepare-and-voucher.md](#hosted-reference-prepare-and-voucher). V1 `X-PAYMENT`: [references/v1-fallback.md](#hosted-reference-v1-fallback). Borrower-direct `/api/v2/x402`: [references/borrower-direct.md](#hosted-reference-borrower-direct). First-time merchant keys: **sohopay-spend**.

| Environment | `{API_BASE}` |
|-------------|--------------|
| Production | `https://api.sohopay.xyz` |
| Staging | `https://staging.api.sohopay.xyz` |

---

## Hosted references (load only when the skill says to)

Native Agent Skills read these from `references/` on demand. This hosted export inlines them so `curl -fsSL` bootstrap still works.

<a id="hosted-reference-borrower-direct"></a>

### Hosted reference: borrower-direct.md

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


<a id="hosted-reference-prepare-and-voucher"></a>

### Hosted reference: prepare-and-voucher.md

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
| Sign + header | Route to the signer — see [references/signer.md](#hosted-reference-signer). The signer fills the signature and returns the `PAYMENT-SIGNATURE` header; the skill builds nothing. |

Do **not** call `sign_transaction` on this path. Do **not** expect a custodial `intentSig`.

### Protocol V2 sign — route to the signer

Do **not** hand-roll the signature or the header. Resolve a signer and run one call per
[references/signer.md](#hosted-reference-signer):

- Resolve a signer (`$SOHOPAY_SIGNER` → `sohopay-signer` → `npx --no @sohopay/agent-signer@0.3.0`);
  none answers → `SIGNER_UNAVAILABLE`, stop (never hand-sign).
- Follow the MCP sequence in [references/signer.md](#hosted-reference-signer): one Bash call
  `mktemp -d` (note the printed `<dir>`), write the prepare response byte-for-byte to
  `<dir>/prep.json` with the file-write tool, then one Bash call
  `voucher sign --envelope --key <secret.json path> --input <dir>/prep.json --write-header <dir>/hdr.txt --output json`.
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
| POST | `{API_BASE}/api/v1/facilitator/capture` | Terminal money call. Requires `Idempotency-Key` (receipt replay 15 min); **200** `{ success, replayed, receipt:{ paymentId, … , signature } }`. Deliver on the receipt — there is no `POST /settle`; SohoPay settles captures on-chain in a scheduled batch (default every 60s) |
| GET | `{API_BASE}/api/v1/facilitator/settle/status/by-payment/:paymentId` | Poll with the receipt's `paymentId`: `CREATED` until batched → `SUBMITTED` (batch `jobId` = `confirm-batch-<uuid>`, `txHash`) → `CONFIRMED` / `FAILED` |
| GET | `{API_BASE}/api/v1/facilitator/settle/status/:jobId` | Same body keyed on the batch `jobId` above (numeric, `confirm-<uuid>`, `confirm-batch-<uuid>`) |
| POST | `{API_BASE}/api/v1/facilitator/verify-proof` | Proof verification (optional tooling) |
| GET | `{API_BASE}/api/v1/facilitator/supported` | Public discovery |

API key must be bound to the same merchant UUID as the resource server. Unbound key → `FACILITATOR_MERCHANT_BINDING_MISSING` (403).

**Finality / credit lag:** merchant unlock on `CONFIRMED` (typically ~5s under `l2_confirmations`); off-chain `available_credit` updates only then — see `{SKILLS_BASE}/spend-and-pay.md`.

---


<a id="hosted-reference-signer"></a>

### Hosted reference: signer.md

## Route signing to the signer (never hand-roll crypto)

The agent **never** canonicalizes, hashes, Ed25519-signs, or base64-encodes a voucher. It
routes to a runtime **signer** that does, and copies the result opaquely. If no conformant
signer is present, **fail closed** — do not improvise.

**Ordering invariant:** sign runs only after the consent / first-time-merchant gate has
passed — `consent_ok → prepare → sign → retry`. The gate lives in the pay flow
(`{SKILLS_BASE}/spend-and-pay.md`); this reference covers only sign → retry.

### Resolve a signer

Try these in order; use the first that **answers**:

1. `$SOHOPAY_SIGNER` (explicit command/path override)
2. `sohopay-signer` on `PATH`
3. `npx --no @sohopay/agent-signer@0.3.0` (exact pin — never a floating tag; **disallowed for `key generate`**, see below)

Each candidate gets a **10 s** timeout; a timeout or spawn failure is a **miss** — try the
next. Worst case is ~30 s. A candidate **answers** iff: `<signer> capabilities --output json` exits 0, its
stdout parses as JSON, and `signer_protocol === "sohopay-signer/1"`. If `capabilities`
reports embedded vectors, run `<signer> verify-vectors --output json` once and require exit 0 — a
**nonzero exit is a miss** (try the next candidate, not a hard stop). When `implementation`
is `@sohopay/agent-signer`, also require `implementation_version >= 0.2.0` (the version that
emits the curl-ready header line).

If **no** candidate answers → **`SIGNER_UNAVAILABLE`**: stop and report to the operator.
Never hand-sign, never WebSearch for crypto, never `pip install` / `npm install` a crypto lib.

**Pin + keygen carve-out (A2).** The npx tier is pinned to the exact version `@sohopay/agent-signer@0.3.0` for all voucher invocations — never a floating tag. True supply-chain integrity arrives with SP3's attested bundle (future: pin the bundle hash). **For `key generate` the npx tier is disallowed entirely** — a secret-writing command runs only on a locally-installed signer (`$SOHOPAY_SIGNER` or `sohopay-signer` on `PATH`). See `{SKILLS_BASE}/borrower-onboard.md` `references/workload-key.md` for the keygen resolution rules and the `SIGNER_KEYGEN_REQUIRES_LOCAL` install path.

### Sign the voucher

First obtain the prepare response; then one signer invocation (the envelope-mode
`voucher sign` call) produces the whole header.

**MCP flow (normal).** Prepare is the **MCP `prepare_x402_payment` tool** (see the prepare
recipe in `{SKILLS_BASE}/x402-credit-pay.md`); its response is already in context. Shell variables do
not survive between tool calls, so use the **literal** directory that `mktemp` prints:

1. One Bash call: `mktemp -d`. Note the directory it prints — `<dir>` below.
2. Write the prepare response to `<dir>/prep.json` with the host's **file-write tool**,
   **byte-for-byte as received — no re-serialization**. Never put the JSON in a shell command.
3. One Bash call:

   ```
   <signer> voucher sign --envelope --key <secret.json path> --input <dir>/prep.json --write-header <dir>/hdr.txt --output json
   ```
4. Retry the merchant with the header file: `curl -fsS -H @<dir>/hdr.txt {MERCHANT_BASE_URL}`
   (see **Consume the output and retry** below).
5. On any exit, delete the directory: `rm -rf <dir>`.

**Raw-HTTP fallback (non-MCP host only).** A host that calls prepare over raw HTTP does it all
in **one** Bash call, response straight to disk byte-for-byte:

```
dir=$(mktemp -d); chmod 700 "$dir"
umask 077
# Raw-HTTP fallback only (non-MCP host), response straight to disk byte-for-byte:
curl -fsS … -o "$dir/prep.json" {API_BASE}/api/v1/spend/x402/prepare
<signer> voucher sign --envelope --key <secret.json path> --input "$dir/prep.json" --write-header "$dir/hdr.txt" --output json
```

- `--input` is the **full** prepare response (`{ voucher, signing, envelope, header_name, … }`),
  written byte-for-byte as received from the prepare call (no re-serialization). **Never** interpolate the JSON into a shell string.
- `--key` is the **canonical key path** — the single source of this literal across all skills:
  `~/.agents/sohopay-agent-workload/secret.json`. Onboarding (`{SKILLS_BASE}/borrower-onboard.md`)
  writes the key here via `key generate --out`, and the voucher path reads it via
  `voucher sign --key`. The agent **MUST NOT** read, print, parse, copy, or summarize this
  file; the private key **MUST NOT** appear in `argv`, `stdin`, or any tool input.
- `--write-header` writes a curl-ready `PAYMENT-SIGNATURE: <value>` line (mode 0600).

### Consume the output and retry

The signer prints JSON on stdout with `signer_protocol`, `payment_id`, `agent_key_jkt`,
`header_name`, `header_value` (and more).

1. Assert `header_name === "PAYMENT-SIGNATURE"`, else stop (`UNEXPECTED_HEADER_NAME`).
2. **Cross-check** against the prepare response: `payment_id` must equal the prepare
   `voucher.paymentId`, and `agent_key_jkt` must equal the prepare `voucher.agentKeyJkt`
   (the backend-registered key's thumbprint). Any mismatch → stop, **no retry**.
3. `header_value` is **opaque** — never decode, edit, re-encode, or echo it (it is a
   replayable credential until expiry). Retry the merchant with the header **file** —
   `curl -fsS -H @<dir>/hdr.txt {MERCHANT_BASE_URL}` in the MCP flow, or in the raw-HTTP
   fallback call:

   ```
   curl -fsS -H @"$dir/hdr.txt" {MERCHANT_BASE_URL}
   ```
4. **On any exit from this flow** (success, cross-check mismatch stop, or signer error),
   delete the temp dir: `rm -rf <dir>` (fallback: `rm -rf "$dir"`). Both `prep.json` and
   `hdr.txt` must never be left on disk.

### If the signer fails

Any **nonzero signer exit**, unparseable stdout, incompatible `signer_protocol`, or a
missing required field → surface the signer's error **code** and **stop before the merchant
retry**. Never fall back to hand-signing; never re-invoke with modified input. The error
codes and their meanings are the SP1 signer contract — do not restate them here.

| Condition | Action |
|-----------|--------|
| No candidate answers | `SIGNER_UNAVAILABLE` → stop, report |
| Nonzero exit / `{"error":{"code",…}}` | Surface the code → stop (no retry, no hand-sign) |
| `header_name` ≠ `PAYMENT-SIGNATURE` | `UNEXPECTED_HEADER_NAME` → stop |
| `payment_id` / `agent_key_jkt` mismatch | Stop, no retry |
| Retry fails terminally or voucher expired | **Re-prepare** (new `payment_id`), then sign the fresh envelope — never re-sign a stale one |


<a id="hosted-reference-v1-fallback"></a>

### Hosted reference: v1-fallback.md

## V1 fallback: multi-step sign_transaction → X-PAYMENT (when V2 is off)

Use when `prepare_x402_payment` is unavailable, or when V2 is off and you follow the custodial path explicitly. Unlock header: **`X-PAYMENT`**.

```text
GET {MERCHANT_BASE_URL}/api/premium
  → 402 + challenge
  → MCP: request_borrower_token only if this chat has no successful token newer than 12 minutes
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

