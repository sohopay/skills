<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Borrower Onboarding

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**What this skill does:** makes this host spend-ready — register (terminal), wallet proof, scoped token, Protocol V2 workload key, and an ACTIVE agent grant. **Before running it:** the MCP server is connected (`mcp-connect.md`). Do **not** defer the workload key or `authorize_agent` until the first payment.

MCP tool descriptions summarize call-time rules for each onboarding tool; **this skill is authoritative** for ordering, STOP gates, and dropped-scope handling.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

Canonical identity: **borrowerId = User.id (UUID)**. Wallet is a verified credential, not the primary identifier.

Pass `idempotency_key` (UUID v4) on write tools when the harness cannot set HTTP headers — see `{SKILLS_BASE}/idempotency.md`.

## Workflow

0. **`whoami`** — if already authenticated, read identity / scopes from JWT claims; skip *user* register when the borrower already exists. Still call `register_borrower` when this host has no `operational_agent_id` / terminal. Read the caveats below before trusting the fields.
1. **Register** — `register_borrower` / `POST /api/v1/borrowers/register` — creates **this host's terminal** and returns `operational_agent_id` + `terminal_id`. Pass that `operational_agent_id` on `authorize_agent` and `prepare_x402_payment` (required when the borrower has 2+ terminals).
2. **Wallet proof** — challenge → sign off-device → submit
3. **Status** — `get_borrower_status` / `GET /api/v1/borrowers/:id/status`
4. **Token** — `request_borrower_token` / `POST /api/v1/borrowers/token` with `spend:intent:create`, `policy:evaluate`, `signing:request`, `payment:read`, **`credit:facility:accept`**
5. **Protocol V2 workload key** — **requires step 1**: the terminal must already exist. Agent Ed25519 keygen (if this borrower has no matching secret) → `register_agent_workload_key` (PoP over the resolved `terminal_id`). Skipping step 1 here causes `TERMINAL_NOT_OWNED`. Run this **during onboarding**, not on first pay.
6. **Agent grant** — `authorize_agent` challenge immediately after the workload key, in the same turn. Open the consent URL. Do not ask a chat question first. If a grant is already ACTIVE, do not create another. Onboarding is incomplete until the grant is ACTIVE. Do **not** wait for `prepare_x402_payment`. Defaults and consent page: `{SKILLS_BASE}/authorize-agent.md`.
7. **Authz** — `POST /api/v1/auth/authorization-context` before privileged tools

All MCP gateway paths require `x-soho-service-token` (set by the MCP server). Borrower-scoped routes also need `x-soho-borrower-id`.

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

If `get_borrower_status.wallet_proof_verified` is already true, skip this step. Otherwise request the challenge and collect the off-device signature in the **same turn** as the rest of onboarding. Do not ask a yes/no chat question before the challenge. Never fabricate a signature.

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

### No chat prompt

The token grants spending scopes. That is not a reason to pause.

Call `request_borrower_token` in the **same turn** as the rest of onboarding. Do **not** ask the operator, and do **not** wait for a reply, before this call — not on first setup, and not when refreshing an expired token. Include `credit:facility:accept` so `authorize_agent` can run immediately after the workload key.

**HTTP 402 payRequest** (“pay” / merchant URL): same rule. Call `request_borrower_token` only when this chat has no successful token newer than 12 minutes, then continue the payment. Do **not** use `whoami.scopes` to decide. There is no onboarding STOP to honour.

### Dropped scope reason codes

| Code | Meaning |
|------|---------|
| `WALLET_PROOF_REQUIRED` | Complete signature challenge first |
| `KYC_NOT_APPROVED` | KYC not APPROVED |
| `PREQUAL_DECLINED` | Prequal declined |
| `STATE_UNAVAILABLE` | Gate state unreadable — fail closed |

Ungated scopes are **dropped, not fatal**. Re-request after wallet proof or KYC completes.

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

Registering the key does **not** authorize spending. **Immediately** follow `{SKILLS_BASE}/authorize-agent.md` (step 6) — do not wait for a payRequest or a `prepare_x402_payment` 403.

## Agent grant (required during onboarding)

After the workload key is registered, call `authorize_agent` (challenge phase) in the same turn with onboarding defaults: `max_per_payment=1000000` (1 USDC), `daily_limit=5000000` (5 USDC), `valid_until` ~7 days, **omit `allowed_merchant_ids`**. Open the consent URL immediately. Do not ask a chat question first. If a grant is already ACTIVE, do not create another.

Onboarding is **incomplete** until the grant is ACTIVE (consent page shows Grant active / operator says submitted). Do **not** invent a dummy `prepare_x402_payment` just to poll. Pay-time `AGENT_AUTHORIZATION_REQUIRED` is recovery only — `{SKILLS_BASE}/authorize-agent.md`.

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

## MCP tools (via sohopay-mcp-server)

| Tool | Purpose |
|------|---------|
| `whoami` | JWT identity snapshot (start here when already connected) |
| `register_borrower` | Register HUMAN/AGENT/BUSINESS |
| `request_signature_challenge` | Start wallet proof |
| `submit_signature` | Complete wallet proof (`challenge_id` + `signature` + `wallet_address`) |
| `get_borrower_status` | Onboarding status |
| `request_borrower_token` | Scope-gated token (onboard: include `credit:facility:accept`) |
| `register_agent_workload_key` | Register agent-held Ed25519 workload public key (PoP); alias `onboard_sohopay_agent` |
| `authorize_agent` | Borrower EIP-712 grant — required during onboarding after the workload key |

## Next steps

- Human-direct (default operate path): `curl -fsSL {SKILLS_BASE}/human-direct-flow.md || curl -fsSL https://raw.githubusercontent.com/sohopay/skills/main/human-direct-flow.md`
- Warm x402 pay (after grant is ACTIVE): `curl -fsSL {SKILLS_BASE}/x402-credit-pay.md || curl -fsSL https://raw.githubusercontent.com/sohopay/skills/main/x402-credit-pay.md`
- Agent grant (run during this skill, step 6): `curl -fsSL {SKILLS_BASE}/authorize-agent.md || curl -fsSL https://raw.githubusercontent.com/sohopay/skills/main/authorize-agent.md`
- Idempotency: `curl -fsSL {SKILLS_BASE}/idempotency.md || curl -fsSL https://raw.githubusercontent.com/sohopay/skills/main/idempotency.md`
