<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1
     SKILLS_HOST (CDN origin): https://agents.sohopay.xyz
     Fetch order: local sticky → {SKILLS_BASE} → GitHub raw last-resort.
     Publish rewrites SKILLS_BASE to Prod and {SKILLS_HOST} to the origin. -->
<!-- Generated from plugins/sohopay/skills — do not hand-edit this file. Run npm run generate:hosted -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Borrower Onboarding

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

Execute the numbered workflow in **one turn**. Do not plan. Do not defer the workload key or `authorize_agent` until the first payment. **Before:** MCP connected (`{SKILLS_BASE}/mcp-connect.md`).

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

Canonical identity: **borrowerId = User.id (UUID)**. Pass `idempotency_key` on writes — `{SKILLS_BASE}/idempotency.md`.

0. `get_context` (catalog v8+) or `whoami` (v7) — skip *user* register if borrower exists; still `register_borrower` if this host has no `operational_agent_id`. On v8+, `get_context` returns `borrower_id` + credit + authorization directly; on v7 use `whoami` (field caveats: [references/whoami.md](#hosted-reference-whoami)) + `get_borrower_status`. `{SKILLS_BASE}/bootstrap.md`
1. `register_borrower` — creates this host’s terminal; store `operational_agent_id` + `terminal_id`
2. Wallet proof — skip if `wallet_proof_verified` is already true. Otherwise `request_signature_challenge` → borrower signs EIP-712 off-device in this same turn → `submit_signature`. Never fabricate a signature, and do not insert a yes/no chat question before the challenge
3. `get_borrower_status`
4. `request_borrower_token` immediately with `spend:intent:create`, `policy:evaluate`, `signing:request`, `payment:read`, **`credit:facility:accept`**, `handle:claim`. Store `token_requested_at` + `expires_in`. Do **not** ask the operator, and do **not** wait for a chat reply, before `request_borrower_token`. `whoami.scopes` of `borrower:token` is the OAuth JWT, not expiry. A later pay refreshes only when this chat has no successful token newer than 12 minutes — `{SKILLS_BASE}/x402-credit-pay.md`
5. Protocol V2 workload key — [references/workload-key.md](#hosted-reference-workload-key) (requires step 1). Skipping step 1 → `TERMINAL_NOT_OWNED`. Run this during onboarding, not on first pay
6. Agent grant — `{SKILLS_BASE}/authorize-agent.md` immediately after the key. Open the consent URL in this same turn. Onboarding is incomplete until the grant is ACTIVE. Do not invent a dummy `prepare_x402_payment` to poll
7. `POST /api/v1/auth/authorization-context` before privileged tools
8. Handle (**required gate**) — only **after** steps 4–6 (never a chat question before the token). Onboarding is **incomplete until a handle is claimed**. If step 1's `register_borrower` returned `handle: null` with `next_action: "claim_handle"`, present its `suggested_handles` and ask the borrower to pick one or propose their own; for a custom handle, `check_handle_availability` first. Show the exact handle and get an explicit yes (one allowed chat question), then `claim_handle` (write, `idempotency_key`). Recoverable errors → offer more candidates and keep going. When candidates are exhausted, or `handle:claim` was never granted, STOP and report — do **not** report the borrower as onboarded. Details: [references/handle-claim.md](#hosted-reference-handle-claim)

Dropped scopes are not fatal — re-request after gates complete. Scope table: [references/scopes.md](#hosted-reference-scopes). Operate: `{SKILLS_BASE}/human-direct-flow.md`. Warm pay after the grant is ACTIVE: `{SKILLS_BASE}/x402-credit-pay.md`.

---

## Hosted references (load only when the skill says to)

Native Agent Skills read these from `references/` on demand. This hosted export inlines them so `curl -fsSL` bootstrap still works.

<a id="hosted-reference-handle-claim"></a>

### Hosted reference: handle-claim.md

## Handle claim (required gate)

A **@handle** is the public address other agents resolve to send gifts. It is a **required** part of onboarding: the borrower is not onboarded until they hold one. A borrower is still *addressed* by `borrowerId` for payments and repayment — the handle's job is to make them discoverable and resolvable by others — but onboarding does not complete without a claimed handle. Report the step as outstanding rather than quietly dropping it; the borrower can still change one any time via `{SKILLS_BASE}/handle.md`.

Tools ship with MCP catalog **v13** ([sohopay-mcp-server#142](https://github.com/sohopay/sohopay-mcp-server/pull/142)); scope `handle:claim` in `@sohopay/mcp-contract` ≥ `0.19.0`; backend [sohopay-backend#1296](https://github.com/sohopay/sohopay-backend/pull/1296). Add `handle:claim` to the `request_borrower_token` scope list (step 4). A dropped scope is not fatal on its own — re-request after gates and confirm `handle:claim` is in `scopes` before claiming; if it never arrives, this gate cannot be satisfied and onboarding stays incomplete (see **When the claim cannot succeed**).

**Ordering (critical):** run the handle step **after** `request_borrower_token` and the workload key, never before them. The borrower-token rule forbids any chat question before the token, and the confirmation below is a chat question. Keep it out of the critical chain (steps 1–7).

### Flow

1. `register_borrower` (step 1) returns `handle` (`null` or an existing handle), `suggested_handles` (ready-to-claim candidates), and `next_action`.
2. If `handle` is already set — show it, skip claiming. This gate is satisfied.
3. If `next_action == "claim_handle"` — present `suggested_handles` and ask the borrower to pick one or propose a custom handle. Do not pick for them and do not claim one silently; the agent's job here is to ask, not to decide.
4. Custom handle → `check_handle_availability` first. If unavailable, offer the `suggested_handles` or another candidate. A `suggested_handles` entry can be claimed directly without checking.
5. **Confirmation STOP** — show the exact handle that will be claimed and wait for an explicit yes. A claim is public and hard to undo, so this is the one allowed chat question in the otherwise no-question turn. Never read an implied assent ("go ahead", "whatever you pick") as consent for a specific handle — re-ask with the concrete string.
6. `claim_handle` with the confirmed handle and an `idempotency_key` — `{SKILLS_BASE}/idempotency.md`.

### When the claim cannot succeed

Recoverable failures keep the gate open and the turn going — offer another candidate each time:

- `HANDLE_UNAVAILABLE` / `HANDLE_RESERVED_BLOCKLIST` → next candidate.
- `HANDLE_INVALID_FORMAT` / `HANDLE_ALPHABET` / `HANDLE_MIN_LENGTH` / `HANDLE_MAX_LENGTH` → fix the format and re-confirm; a corrected string is a new handle, so it needs its own yes.
- `429` / rate-limit → back off, then claim a `suggested_handles` entry (no availability check needed).
- `HANDLE_ALREADY_CLAIMED` → the borrower already has one; show it. Gate satisfied, not a failure.

Once candidates are exhausted — the borrower has declined to choose, every candidate is taken, or `handle:claim` is absent from `scopes` after re-requesting — **STOP and report**. Say plainly that the borrower is **not onboarded** and that the handle is the one unmet gate, name the last error code, and state what would clear it (a free handle the borrower picks, or a token carrying `handle:claim`). Do **not** mark onboarding complete, do **not** loop asking again, and do **not** invent a handle or claim one to make the step pass.

### Tool mechanics, format rules, and errors

The `claim_handle` / `check_handle_availability` contract — routes, input/return shapes, the 3–30-char lowercase `a-z0-9` + `.`/`_` format rules, and the error codes — is owned by `{SKILLS_BASE}/handle.md`. This onboarding step only orchestrates **when** to run them; that skill is also where a borrower changes a handle any time after onboarding.

On any non-2xx, follow the skill's global failure rule (STOP and report the exact failed route). A handle failure is the one error that also leaves onboarding incomplete: report the unmet gate rather than declaring the borrower ready.


<a id="hosted-reference-scopes"></a>

### Hosted reference: scopes.md

## Authorization context

`POST /api/v1/auth/authorization-context`

Returns live `{ permissions, scopes, roles, borrower_status, frozen, suspended, active, ... }`.

JWT stays thin — always resolve fresh before privileged MCP tools. `whoami` returns token claims only (not a live authz re-check).

## Scope gates (summary)

| Scope | Wallet proof | KYC approved |
|-------|:------------:|:------------:|
| session:* | — | — |
| spend:intent:create | ✅ | ✅ |
| payment:execute | ✅ | ✅ (+ 2FA-equiv) |
| signing:request | ✅ | — (+ 2FA-equiv) |
| credit:approve | — | ✅ (+ 2FA-equiv) |
| repayment:execute | ✅ | NOT KYC-gated |
| handle:claim | — | — (discoverability only, but a **required** onboarding gate) |

## MCP tools (via sohopay-mcp-server)

| Tool | Purpose |
|------|---------|
| `get_context` | Backend-backed identity + credit + authorization + one next step — prefer when connected (catalog v8+) |
| `whoami` | JWT identity snapshot (start here on v7; on v8+ prefer `get_context`) |
| `register_borrower` | Register HUMAN/AGENT/BUSINESS |
| `request_signature_challenge` | Start wallet proof |
| `submit_signature` | Complete wallet proof (`challenge_id` + `signature` + `wallet_address`) |
| `get_borrower_status` | Onboarding status |
| `request_borrower_token` | Scope-gated token (onboard: include `credit:facility:accept`) |
| `register_agent_workload_key` | Register agent-held Ed25519 workload public key (PoP); alias `onboard_sohopay_agent` |
| `authorize_agent` | Borrower EIP-712 grant — required during onboarding after the workload key |
| `check_handle_availability` | Check a candidate @handle before claiming (read, scope `handle:claim`) — [references/handle-claim.md](#hosted-reference-handle-claim) |
| `claim_handle` | Claim the borrower's own @handle (write, scope `handle:claim`, `idempotency_key`) — [references/handle-claim.md](#hosted-reference-handle-claim) |


<a id="hosted-reference-whoami"></a>

### Hosted reference: whoami.md

## whoami — what it actually returns

`whoami` reads **thin JWT claims only** and never calls the backend, so several fields are frequently absent or `null` even for a fully onboarded borrower:

```json
{
  "identity_source": "jwt_claims",
  "principal_id": "…", "executor_id": "…",
  "wallet": null, "principal_type": null,
  "scopes": ["borrower:token"], "roles": []
}
```

| Field | Caveat |
|-------|--------|
| `borrower_id` | **May be missing entirely** when the token carries no borrower claim. Do not assume the key exists. |
| `wallet` | Commonly `null` even when wallet proof is verified — the wallet is backend state, not a token claim. |
| `principal_type` | `null` unless the claim is present. |
| `scopes` | Token claims, **not** live grants. A fresh token may hold only `borrower:token`. |

> **Catalog v8+:** `get_context` returns `borrower_id` plus facility/credit state in one backend-backed call, so the `whoami` → `get_borrower_status` sequence below is unnecessary there. Everything in this section stays the v7 / human-direct path. `{SKILLS_BASE}/bootstrap.md`

### Resolving borrower_id from whoami

**Use `principal_id` as the `borrower_id`.** In the human-direct flow the authenticated caller *is* the borrower, so `principal_id` and `executor_id` both carry the borrower UUID, and `whoami` typically omits `borrower_id` altogether. Feed `principal_id` straight into `get_borrower_status`, `create_spend_intent`, `sign_transaction`, and every other tool that takes `borrower_id`.

```text
borrower_id = whoami.borrower_id ?? whoami.principal_id
```

This substitution holds for the human-direct flow (the default), where the caller is the borrower. If you ever hold an explicit `borrower_id` that differs from `principal_id`, use the explicit `borrower_id` — `principal_id` identifies the caller, not necessarily the credit owner.

**Wallet and onboarding state:** `whoami` cannot supply these. Call `get_borrower_status`, which returns `wallet_address`, `kyc_status`, `prequal_status`, and `wallet_proof_verified` from the backend.

## Register borrower

`POST /api/v1/borrowers/register` via tool `register_borrower`

**MCP `borrower_type`:** `HUMAN` | `AGENT` | `BUSINESS`  
**Backend also accepts** `INDIVIDUAL` (alias for human); prefer the MCP values when calling tools.

Typical MCP fields (execute-time): `borrower_id`, optional `terminal_id`; omit `terminal_id` to use `SOHO_TERMINAL_ID` or the host default. Returns `operational_agent_id`, `terminal_id`, `agent_id` (bytes32 — do not pass that as `operational_agent_id`), `spend_ready`, `available_credit`.

`register_borrower` is also the **terminal bind** for an already-onboarded borrower on a new MCP host. Call it before `register_agent_workload_key`. Do not invent `terminal_id` — use the value the tool returns (or the host default you omitted).

## Wallet proof (EIP-712)

| Step | MCP tool | Backend | Idempotent |
|------|----------|---------|:----------:|
| Challenge | `request_signature_challenge` | `POST /api/v1/signature/challenge` | Yes |
| Submit | `submit_signature` | `POST /api/v1/signature/submit` | Yes |

Flow:

1. Challenge returns `challenge_id`, `nonce`, `typed_data`, `expires_at`
2. Borrower signs EIP-712 **off-device** (wallet/app — never in MCP)
3. Submit with **`{ borrower_id, challenge_id, signature, wallet_address }`** → `{ verified, wallet_address }`

Before requesting the signature:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

## Request borrower token

`POST /api/v1/borrowers/token` via `request_borrower_token`

Body: `borrower_id` (UUID), `requested_scopes[]`

Response: `access_token`, `token_type`, `expires_in`, `borrower_id`, `scopes[]`, optional `dropped_scopes[{scope, reason}]`

Note: MCP may **redact** `access_token` in tool responses; harness OAuth is the primary transport auth.

### Token lifetime — the borrower token is short-lived

**The scoped borrower token expires quickly** — staging returns `expires_in: 900` (15 minutes). Read `expires_in` from the response rather than hardcoding a value.

This is a **different token from the OAuth transport token** your harness obtained at MCP login. The harness stores and refreshes that one automatically (`{SKILLS_BASE}/mcp-connect.md`); it does **not** refresh the borrower token, and there is no refresh call — you re-request it.

Consequences an agent must plan for:

- Spending authority **lapses silently**. Scopes such as `spend:intent:create`, `signing:request`, and `payment:execute` stop applying once the token expires; nothing notifies you.
- `whoami` always reports OAuth JWT claims (commonly `["borrower:token"]`), **even immediately after** a successful `request_borrower_token`. That is **not** expiry. Do not use `whoami.scopes` as a refresh signal, and do not re-run onboarding to "fix" it.
- Track `token_requested_at` + `expires_in` in this conversation. **Re-request when the cached token is older than 12 minutes** (or `expires_in − 180s`). Do not re-request before every spend in the same chat.
- Re-requesting is routine and does not repeat wallet proof or KYC.

### Consent

The token grants real spending scopes.

Call `request_borrower_token` with no chat prompt — not on first setup, and not when the cached token is older than 12 minutes. Do **not** use `whoami.scopes` to decide. Skip `authorization-context` on the warm x402 path.

### Dropped scope reason codes

| Code | Meaning |
|------|---------|
| `WALLET_PROOF_REQUIRED` | Complete signature challenge first |
| `KYC_NOT_APPROVED` | KYC not APPROVED |
| `PREQUAL_DECLINED` | Prequal declined |
| `STATE_UNAVAILABLE` | Gate state unreadable — fail closed |

Ungated scopes are **dropped, not fatal**. Re-request after wallet proof or KYC completes.


<a id="hosted-reference-workload-key"></a>

### Hosted reference: workload-key.md

## Protocol V2 agent workload key

Required before Protocol V2 x402 (`prepare_x402_payment` → `VOUCHER_ISSUED`). Without a registered key, prepare returns `X402_AGENT_KEY_NOT_REGISTERED`. Tool ships with MCP catalog **v5** ([sohopay-mcp-server#94](https://github.com/sohopay/sohopay-mcp-server/issues/94)); backend alignment [sohopay-backend#1144](https://github.com/sohopay/sohopay-backend/issues/1144).

**Key ownership:** the **agent** (client runtime) generates and holds the Ed25519 workload keypair. SohoPay / MCP never see the private key. Do **not** ask the MCP host to keygen or store the private key. Lifecycle alias: `onboard_sohopay_agent` → tool name `register_agent_workload_key`.

**Fixed local path** (look here first on pay — do not grep all AgentStores / other chats):

```text
~/.agents/sohopay-agent-workload/secret.json
```

or Cursor agent-store: `<store>/files/sohopay-agent-workload/secret.json` with `{ private_key_base64url, public_jwk, jkt, terminal_id, borrower_id }`. Reuse only when **both** `borrower_id` (this borrower) **and** `jkt` / `voucher.agentKeyJkt` match. If the file is missing or `borrower_id` belongs to a different borrower, generate a fresh Ed25519 keypair for the current borrower — do not register another borrower's key. Voucher recipe: `{SKILLS_BASE}/x402-credit-pay.md` § Protocol V2 sign recipe.

**Prerequisite:** step 1 (`register_borrower`) must have created this host's terminal. Sign PoP over the **resolved** `terminal_id` from that call (or `SOHO_TERMINAL_ID` / host default). Registering a key against an unregistered or guessed terminal returns `TERMINAL_NOT_OWNED`.

### Steps (once per terminal)

1. Generate an Ed25519 keypair locally. Persist the private key only at the fixed path above.
2. Build a public JWK `{ kty: "OKP", crv: "Ed25519", x }` — **never** include private material (`d` is rejected).
3. Compute `jkt` (RFC 7638 JWK thumbprint of `public_jwk`).
4. Create a single-use `nonce` and `iat` (unix seconds).
5. Sign PoP over canonicalize(`{ borrowerId, terminalId, jkt, nonce, iat }`) with the workload private key → `pop_signature`.
6. Call `register_agent_workload_key` → `POST /api/v1/agents/{terminal_id}/keys`.

| Field | Detail |
|-------|--------|
| `borrower_id` | Canonical borrower UUID (`whoami.borrower_id ?? whoami.principal_id`) |
| `terminal_id` | Must match the terminal from `register_borrower`. Omit to use `SOHO_TERMINAL_ID` or the host default — then sign PoP over that same resolved value |
| `public_jwk` | `{ kty: "OKP", crv: "Ed25519", x }` only — no `d` |
| `jkt` | RFC 7638 thumbprint; gateway recomputes and must match |
| `nonce` | Single-use PoP nonce (agent-generated) |
| `iat` | Unix seconds; gateway enforces skew |
| `pop_signature` | Ed25519 signature over the PoP payload |
| Scope | `borrower:token` |
| Idempotent | Yes — pass `idempotency_key` when the harness cannot set headers |

Register once per terminal during onboarding (step 5). On later pays, reuse the same key only when `borrower_id` and `jkt` match. Voucher signing after `VOUCHER_ISSUED`: `{SKILLS_BASE}/x402-credit-pay.md`.

Registering the key does **not** authorize spending. Immediately follow `{SKILLS_BASE}/authorize-agent.md` — do not wait for a payRequest or a `prepare_x402_payment` 403. Pay-time `AGENT_AUTHORIZATION_REQUIRED` is recovery only.

