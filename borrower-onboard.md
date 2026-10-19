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
1. `register_borrower` — creates this host’s terminal; store `operational_agent_id` + `terminal_id`. Its `next_actions` is a list of action names (no `reason_code`)
2. Protocol V2 workload key — **route keygen + PoP to the signer**, never hand-roll crypto: [references/workload-key.md](#hosted-reference-workload-key) (requires step 1). Skipping step 1 → `TERMINAL_NOT_OWNED`. Run this immediately after `register_borrower`, even with no wallet and even when `COMPLETE_PROFILE` is listed. A missing profile does not block the key. Do not call `start_browser_handoff` to unblock the key. If the signer binary is missing, stop and do not install it
3. `request_borrower_token` immediately with `spend:intent:create`, `policy:evaluate`, `signing:request`, `payment:read`, **`credit:facility:accept`**, `handle:claim`. Store `token_requested_at` + `expires_in`. Do **not** ask the operator before this call. `whoami.scopes` of `borrower:token` is the OAuth JWT, not expiry. A later pay refreshes only when this chat has no successful token newer than 12 minutes — `{SKILLS_BASE}/x402-credit-pay.md`
4. Agent grant — `{SKILLS_BASE}/authorize-agent.md` immediately after the key and token. Open the consent URL in this same turn. The page uses passkey step-up; within-threshold grants can complete without a wallet, while larger grants also require an EOA signature. Poll until the grant is ACTIVE. Do not invent a dummy `prepare_x402_payment` to poll
5. Repeat `get_context` and do only the current blocker. `COMPLETE_PROFILE` is first, ahead of any wallet or bank step:
   - `COMPLETE_PROFILE`: say the borrower enters legal name and date of birth on the SohoPay page. Do not ask for them in chat. Do not invent a link. Do not start a wallet or bank step. This is not agent-actionable: report it and end the turn. Do not poll
   - `CONNECT_WALLET` and `CONNECT_BANK` together: ask once, wallet or bank. Then `start_browser_handoff` with that `action` and a fresh `idempotency_key`. Open `open_url` verbatim, `#…` included. Wait. When the borrower returns, if step 3 returned wallet-gated scopes in `dropped_scopes`, re-request the borrower token, then re-read `get_context`. A borrower with no wallet is registered, not an error: never ask for a wallet signature to invent one
   - `PROVE_WALLET` plus `CONNECT_BANK`: wallet means `request_signature_challenge` then `submit_signature` (no link). Bank means `action: CONNECT_BANK`. Never send `CONNECT_WALLET` while `PROVE_WALLET` is listed (`409 NO_BROWSER_HANDOFF`). Once the wallet is chosen, do not insert another chat question before the challenge. Never fabricate a signature. After the source step, re-request the token when step 3 returned those scopes in `dropped_scopes`
   - `REVIEW_AND_ACCEPT_FACILITY`: `review_facility_offer` (fresh `idempotency_key`, no offer argument), open `open_url`, wait, re-read. This opens the credit line. Never build a `/facility/accept` link. Acceptance needs no wallet proof
   - Wallet proof when `wallet_proof_verified` is false and no source step is listed (a deployment without `PROVE_WALLET`). Skip it when the proof is already verified, the borrower chose a bank, or there is no wallet
   - Older server without the tool, `409`, expired link: [references/onboarding-context.md](#hosted-reference-onboarding-context)
   - Stop when no agent-actionable step is left. Report the state and end the turn. Do not poll. That includes `EVALUATE_CREDIT`, `REVIEW_CREDIT_OFFER` (report the status, no tool, no invented link; a `CONNECT_BANK` beside `EVALUATE_CREDIT` is optional evidence), `REPAYMENT_METHOD_REQUIRED`, `IN_REVIEW`, and `INELIGIBLE`. Say they are **onboarded but not spend-ready**
6. If `CLAIM_HANDLE` is listed, claim a handle the borrower confirms. Only **after** the token in step 3 (never a chat question before the token). A missing handle does not block `can_pay`, but the borrower is not fully onboarded without one. If step 1's `register_borrower` returned `handle: null` with `next_action: "claim_handle"`, present its `suggested_handles` and ask the borrower to pick one or propose their own; for a custom handle, `check_handle_availability` first. Show the exact handle and get an explicit yes (one allowed chat question), then `claim_handle` (write, `idempotency_key`). Recoverable errors → offer more candidates and keep going. When candidates are exhausted, or `handle:claim` was never granted, STOP and report — do **not** report the borrower as onboarded. Details: [references/handle-claim.md](#hosted-reference-handle-claim)
7. Stop when `purchasing_power.can_pay` is true. Report available credit. Do not start a payment. `get_borrower_status`, then `POST /api/v1/auth/authorization-context` before privileged tools

**Bank only.** A borrower who connected a bank and has no proven wallet still completes steps 2–4: the workload key is wallet-independent and a within-threshold grant uses passkey consent. Skip the wallet proof inside step 5. If `get_context` still reports `REPAYMENT_METHOD_REQUIRED`, they are onboarded but not spend-ready. Do not repeat key registration or authorization, and do not ask for a wallet signature in chat.

`EVALUATE_CREDIT` and `REVIEW_CREDIT_OFFER` are statuses: report them, call no tool, and invent no link. The only links you give are the `open_url`s that `start_browser_handoff` or `review_facility_offer` returned. Never ask for a legal name, date of birth, bank details, or a passkey in chat. Keep doing any `PAY`, repayment or handle action listed alongside these steps. Details: [references/onboarding-context.md](#hosted-reference-onboarding-context)

Dropped scopes are not fatal — re-request after gates complete. Scope table: [references/scopes.md](#hosted-reference-scopes). Operate: `{SKILLS_BASE}/human-direct-flow.md`. Warm pay after the grant is ACTIVE: `{SKILLS_BASE}/x402-credit-pay.md`.

---

## Hosted references (load only when the skill says to)

Native Agent Skills read these from `references/` on demand. This hosted export inlines them so `curl -fsSL` bootstrap still works.

<a id="hosted-reference-handle-claim"></a>

### Hosted reference: handle-claim.md

## Handle claim (required gate)

A **@handle** is the public address other agents resolve to send gifts. It is a **required** part of onboarding: the borrower is not onboarded until they hold one. A borrower is still *addressed* by `borrowerId` for payments and repayment — the handle's job is to make them discoverable and resolvable by others — but onboarding does not complete without a claimed handle. Report the step as outstanding rather than quietly dropping it; the borrower can still change one any time via `{SKILLS_BASE}/handle.md`.

Tools ship with MCP catalog **v13** ([sohopay-mcp-server#142](https://github.com/sohopay/sohopay-mcp-server/pull/142)); scope `handle:claim` in `@sohopay/mcp-contract` ≥ `0.19.0`; backend [sohopay-backend#1296](https://github.com/sohopay/sohopay-backend/pull/1296). Add `handle:claim` to the `request_borrower_token` scope list (step 3). A dropped scope is not fatal on its own — re-request after gates and confirm `handle:claim` is in `scopes` before claiming; if it never arrives, this gate cannot be satisfied and onboarding stays incomplete (see **When the claim cannot succeed**).

**Ordering (critical):** run the handle step **after** `request_borrower_token` and, when it runs, the workload key, never before them. The borrower-token rule forbids any chat question before the token, and the confirmation below is a chat question. Keep it out of the critical chain (steps 1–9).

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


<a id="hosted-reference-onboarding-context"></a>

### Hosted reference: onboarding-context.md

## Reading `onboarding` from `get_context`

Some deployments add an `onboarding` section to `get_context`. When it is absent, ignore this reference, except "No credit account yet" below, which applies on every deployment.

| Field | Meaning |
|---|---|
| `verification_tier` | Which verified sources the borrower has: `PHONE_ONLY`, `WALLET_VERIFIED`, `FINANCIAL_VERIFIED`, `MULTI_SOURCE_VERIFIED`. Coverage, not credit quality. |
| `profile_complete` | The borrower declared their legal name and date of birth. Absent when the deployment does not track it. Not identity or credit approval. |
| `credit_eligibility` | `status` (`NOT_EVALUATED`, `IN_REVIEW`, `ELIGIBLE`, `INELIGIBLE`) and an opaque `band`. Never a score; do not interpret the band. |
| `spend_ready` | Onboarding gates for spending are passed. Not the same as `purchasing_power.can_pay`: decide whether to pay from `can_pay`, and `prepare_x402_payment` stays authoritative. |

### No credit account yet (`credit: null`)

A registered borrower with no credit account gets `credit: null` and `repayment: null`, with `purchasing_power.can_pay` false. That is a normal state, not an error: there is no credit limit, credit balance or credit debt to report yet. Tell the operator there is no credit line yet and follow the listed next actions. If none are listed, there is nothing to do yet; say so plainly. Never present it as a zero limit or a zero balance.

This covers the borrower's own credit only. Gifts they have received still count: when the `gifts` section is `supported` and `gifts.available` is above zero (a `GIFT_RECEIVED` action is listed), report that balance. Gift value cannot be spent until the borrower has a credit account, so do not attempt a payment: report the balance and follow the listed next actions.

### Browser steps (`handoff_type: "OPEN_URL"`)

A next action with `handoff_type: "OPEN_URL"` is a step the borrower does on a SohoPay browser page.

| Action | What to do |
|---|---|
| `COMPLETE_PROFILE` | Report it: the borrower enters their legal name and date of birth on the SohoPay page, never in chat. It does not delay the workload key or the grant. After those, it is the first blocker, ahead of any wallet or bank step. There is no link. Report it and end the turn. Do not poll. |
| `CONNECT_WALLET` / `CONNECT_BANK` | Alternatives (`reason_code: FINANCIAL_SOURCE_REQUIRED`): ask the borrower wallet or bank, then get the link for that choice with `start_browser_handoff` (see "Choosing a source" and "Connect link" below). Either connection is enough for **evidence**; it does **not** by itself activate spendable credit. |
| `REVIEW_AND_ACCEPT_FACILITY` | Get the borrower a link with `review_facility_offer` (see "Facility acceptance" below). |

`COMPLETE_PROFILE` has no link tool: report the step and never invent a link.

### Choosing a source (`FINANCIAL_SOURCE_REQUIRED`)

Every entry with `reason_code: FINANCIAL_SOURCE_REQUIRED` is an alternative, so never act on the first one alone. `register_borrower` lists the same steps as bare action names (`CONNECT_WALLET`, `CONNECT_BANK`, `PROVE_WALLET`), with no reason code.

1. The workload key, token, and ACTIVE grant come first, even when `COMPLETE_PROFILE` is listed. After that, `COMPLETE_PROFILE` is ahead of this choice: report it, invent no link, and do not start a wallet or bank step. When it is not listed, ask the borrower one question naming both options: connect a wallet, or connect a bank.
2. `CONNECT_WALLET` + `CONNECT_BANK` (no wallet): get the link for the chosen step ("Connect link").
3. `PROVE_WALLET` + `CONNECT_BANK` (wallet registered, proof missing): a wallet choice is the wallet proof below, with no link; a bank choice is the `CONNECT_BANK` link.
4. Do not start a link, or a signature challenge, before the borrower has chosen.
5. A `CONNECT_BANK` listed next to `EVALUATE_CREDIT` belongs to a borrower who already has a verified source: it is optional evidence, so report it and do not stop for it.

A borrower who picks the bank and has no proven wallet still registers the workload key and may activate a within-threshold grant through passkey consent. Payment can remain blocked by `REPAYMENT_METHOD_REQUIRED`; report that readiness state separately. See **Bank only** in the onboarding steps.

`EVALUATE_CREDIT` and `REVIEW_CREDIT_OFFER` are statuses, not browser steps (an older deployment may still mark them `handoff_type: "OPEN_URL"`; treat them the same). Report them: the borrower needs SohoPay to evaluate them for credit, or has an offer waiting. Call no tool and give no link. A `CONNECT_BANK` listed next to `EVALUATE_CREDIT` is optional evidence and does not block that status.

### Facility acceptance (`REVIEW_AND_ACCEPT_FACILITY`)

The backend lists it with `tool: "review_facility_offer"`. Until acceptance completes, there is no credit line (`credit` is null) and `can_pay` is false, even when wallet or bank sources are connected. Linking a source is evidence only, not spendable credit.

1. If your tool list has no `review_facility_offer` (an older server), report that the borrower must review and accept the facility offer in SohoPay, and give no link.
2. Call `review_facility_offer` with a fresh `idempotency_key`. It takes no offer argument: the backend picks the open offer and returns `action` (`FACILITY_ACCEPT`), `open_url` and `expires_at`.
3. Open `open_url` for the borrower exactly as returned, as in step 3 of "Connect link": whole, never shortened, rewritten or rebuilt. Never build a `/facility/accept` link yourself. It is single-use and bound to this borrower: give it to no one else, and do not fetch it with your own tools. The page handles sign-in and confirmation.
4. Do not poll. Ask the borrower to tell you when they have finished, then call `get_context` again and follow what it lists.
5. `409 FACILITY_OFFER_NOT_AVAILABLE` means no offer can be reviewed right now (it expired, was withdrawn, or is already accepted). Call `get_context` again. Do not retry.
6. Reuse an `idempotency_key` only to retry a call that failed in transit. If the link is past `expires_at`, or the borrower lost it, call `review_facility_offer` again with a **new** `idempotency_key`; the new link replaces the old one.

### Connect link (`start_browser_handoff`)

1. If your tool list has no `start_browser_handoff` (an older server), report the step as the borrower's to do in SohoPay and give no link.
2. Call `start_browser_handoff` with `action` set to the borrower's choice (`CONNECT_WALLET` or `CONNECT_BANK`) and a fresh `idempotency_key`. It returns `action`, `open_url` and `expires_at`; the backend mints only a step that is current. Tell the borrower which connection the link is for (`action`). An older server's tool takes no `action` argument and mints the first connect step listed: use it that way only when that step is the borrower's choice, otherwise report the chosen step with no link.
3. Open `open_url` for the borrower exactly as returned, the same way as the agent-grant consent page. If you cannot open a browser, give it to the borrower verbatim. Never shorten, rewrite or rebuild it, and never drop its `#…` part. It is single-use and bound to this borrower: give it to no one else, and do not fetch it with your own tools.
4. Do not poll. Ask the borrower to tell you when they have finished in the browser, then call `get_context` again and follow what it lists.
5. `409 NO_BROWSER_HANDOFF` means the chosen connect step is not current (your `get_context` is out of date, or you sent `CONNECT_WALLET` while `PROVE_WALLET` is listed). Call `get_context` again. Do not retry the handoff.
6. If the link is past `expires_at`, or the borrower lost it, call `start_browser_handoff` again with a **new** `idempotency_key`. Reusing the old key returns the same expired link.
7. When `PROVE_WALLET` is listed, call it only with `action: CONNECT_BANK`, after the borrower chose the bank. A wallet choice is the wallet proof (see below).

### Wallet proof (`PROVE_WALLET`)

`PROVE_WALLET` is not a browser step. It carries `tool: "request_signature_challenge"` and no `handoff_type`. Its `handoff_required` is `true` only because the borrower signs; there is no page to send them to. It means the borrower's wallet is registered and only its ownership proof is missing: run the wallet-proof step (`request_signature_challenge` → the borrower signs → `submit_signature`). Never fabricate the signature. `CONNECT_BANK` may be listed alongside it, because a bank is an alternative source: ask the borrower wallet or bank first ("Choosing a source"). Run the proof only after they choose the wallet; if they choose the bank, get the `CONNECT_BANK` link instead and skip the proof.

`CONNECT_WALLET` is for a borrower with no wallet. The two are never listed together.

### Rules

- The only link you give is one a tool returned: `start_browser_handoff`'s `open_url` for a connect step, or `review_facility_offer`'s for facility acceptance. Never invent a link. Never ask for a legal name, date of birth, bank details, or a passkey in chat.
- `PROVE_WALLET` stays on `request_signature_challenge` / `submit_signature`.
- Keep doing any `PAY`, repayment or handle action that is listed alongside it. An `OPEN_URL` action only stops the work that depends on it; wait for the borrower only when nothing else is listed.
- `COMPLETE_PROFILE` and a source step do not delay the workload key or `authorize_agent`. Those are done first. The source step gates spendable credit. Wallet proof runs when `PROVE_WALLET` is the borrower's choice. If no source step is listed and `PROVE_WALLET` is not either (a deployment may not enable it), the wallet-proof step still runs whenever `wallet_proof_verified` is false.
- `IN_REVIEW` or `INELIGIBLE` with no action listed means there is nothing to do; say so plainly. Do not retry, poll, or ask for more data. The borrower is onboarded but not spend-ready.


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

**Key ownership:** the **agent** (client runtime) holds the Ed25519 workload keypair; SohoPay / MCP never see the private key. The agent does **not** generate, read, or sign with the key itself — a runtime **signer** owns generation, persistence, and signing. The agent only passes a key **path** and relays the signer's public output. Lifecycle alias: `onboard_sohopay_agent` → tool name `register_agent_workload_key`.

**Route to the signer — never hand-roll crypto.** The agent never generates a keypair, builds a JWK, computes a thumbprint, or signs a proof-of-possession in prose. It resolves the signer and calls it. If no conformant signer with the keygen contract is present, **fail closed** — do not improvise, do not fall back to in-prose crypto.

### Resolve the signer (keygen rules)

Resolve via `{SKILLS_BASE}/x402-credit-pay.md` `references/signer.md`, with two keygen-specific gates on top of the shared resolver:

1. **The npx tier is disallowed for `key generate`.** A secret-writing command runs only on a locally-installed signer: `$SOHOPAY_SIGNER`, then `sohopay-signer` on `PATH`. `$SOHOPAY_SIGNER` comes from the operator's environment — the agent **never** sets it inline.
2. **`command_contracts["key generate"]` must equal `"workload-keygen/1"`** (read from `<signer> capabilities --output json`). An absent key ⇒ fail closed `SIGNER_KEYGEN_UNSUPPORTED`.

- No local signer is installed (`$SOHOPAY_SIGNER` unset and no `sohopay-signer` on `PATH`; npx is disallowed here) ⇒ **`SIGNER_KEYGEN_REQUIRES_LOCAL`**. Hand the operator the exact pinned install command and **stop**:

  ```text
  npm i -g @sohopay/agent-signer@0.3.1
  ```

  The agent **does not** run the install itself and **does not** set `$SOHOPAY_SIGNER` — secret-handling software is installed by a human, once, auditably. Setup shows this same command and does not run it. `install.sh` is operator-run and may run it.
- A signer resolves but lacks the keygen contract ⇒ **`SIGNER_KEYGEN_UNSUPPORTED`**: stop, no prose fallback.
- A local signer is installed but none answers `capabilities --output json` (nonzero exit, stdout that is not JSON, or another `signer_protocol`) ⇒ **`SIGNER_UNRESOLVED`**: stop and surface.

### Generate + register (once per terminal)

Use the **canonical key path defined in `{SKILLS_BASE}/x402-credit-pay.md` `references/signer.md`** (its `--key` bullet) for both `--out` and `--key` (do not restate the literal here — it has one home). Open signer.md with the host's **file-read tool**; never search for the path with `grep` or any shell command — a command that names the key file counts as accessing it. Never `ls`, `stat` or `echo` the key file, its directory or `~/.agents`: the signer checks the key; the agent never inspects it. signer.md's `--key` bullet shows both commands below **fully literal** — copy them from there, filling in only the JSON values.

**Paste the path itself** after `--out` / `--key`, unquoted, exactly as signer.md shows it. Never put it in a variable (no `KEY=…` line, no `KEY=… <signer> …` prefix — the shell expands `"$KEY"` before a prefix assignment, so the signer gets an empty path), and never single-quote it (`'~/…'` leaves `~` unexpanded). Write `<signer>` exactly as the candidate that answered (`sohopay-signer` or `"$SOHOPAY_SIGNER"`) — never an absolute path to the binary and never `${SOHOPAY_SIGNER:-…}`.

Run each command below as **its own** Bash call: the command and its heredoc — nothing else. Never chain anything before or after it (no `;`, `&&` or `|`, no `echo`, no `timeout` wrapper, no `capabilities` / `verify-vectors` check in the same call). A key-touching call with anything else in it counts as an access to the key store.

Supply stdin with a **single-quoted heredoc** (`<<'SOHOPAY_EOF'` … `SOHOPAY_EOF`) exactly as shown, filling in the values — never `echo … |` or `printf … |`, and never an unquoted heredoc.

1. **Generate (signer owns it):**

   ```text
   <signer> key generate --out <canonical key path> --input - --output json <<'SOHOPAY_EOF'
   { "borrower_id": "…", "terminal_id": "…" }
   SOHOPAY_EOF
   ```

   stdin is the non-secret `{ "borrower_id": "…", "terminal_id": "…" }`. Capture the signer's stdout `{ public_jwk, jkt, borrower_id, terminal_id, created }`. **The agent never reads `secret.json`** — the signer writes and owns it. `created: false` means the key already existed for this borrower+terminal and was reused (a retry after a partial failure is safe — never regenerate).

2. **Proof-of-possession (signer owns it):**

   ```text
   <signer> pop sign --key <canonical key path> --input - --output json <<'SOHOPAY_EOF'
   { "fields": { "borrowerId": "…", "terminalId": "…", "jkt": "…" } }
   SOHOPAY_EOF
   ```

   stdin is exactly `{ "fields": { "borrowerId": "…", "terminalId": "…", "jkt": "…" } }` (the `jkt` from step 1). The signer mints its own `nonce` + `iat` — **never** supply them (a client-supplied `nonce`/`iat` is rejected `MALFORMED_INPUT`). Capture `{ pop_signature, nonce, iat }`.

3. **Register:** call `register_agent_workload_key` → `POST /api/v1/agents/{terminal_id}/keys` with the captured public material + `pop_signature` + `nonce` + `iat`.

   **If registration fails** with a transient error (e.g. `UPSTREAM_UNAVAILABLE`), first re-run step 1 (its own call, same `borrower_id` + `terminal_id`) to confirm the key: it must return `created: false` and the **same** `jkt` — if it returns `created: true` or a different `jkt`, stop and surface it. This confirm call is **mandatory on every retry**, even when step 1 returned `created: true` moments ago in this same turn: the key file may have changed since, and only the signer can say it did not. Never retry registration without it. Then retry `register_agent_workload_key` with the **identical** request (same `idempotency_key`, same PoP) — a changed body under the same key is an idempotency conflict.

| Field | Detail |
|-------|--------|
| `borrower_id` | Canonical borrower UUID (`whoami.borrower_id ?? whoami.principal_id`) |
| `terminal_id` | Must match the terminal from `register_borrower`. Omit to use `SOHO_TERMINAL_ID` or the host default — then pass that same resolved value as the signer's PoP `fields.terminalId` |
| `public_jwk` | From the signer's `key generate` output — `{ kty, crv, x }` only; the agent never adds or inspects fields |
| `jkt` | From the signer; gateway recomputes and must match |
| `nonce` | From the signer's `pop sign` output (signer-generated) |
| `iat` | From the signer's `pop sign` output |
| `pop_signature` | From the signer's `pop sign` output |
| Scope | `borrower:token` |
| Idempotent | Yes — pass `idempotency_key` when the harness cannot set headers |

**Prerequisite:** step 1 (`register_borrower`) must have created this host's terminal. Pass the **resolved** `terminal_id` from that call (or `SOHO_TERMINAL_ID` / host default) as the signer's `fields.terminalId`. Registering against an unregistered or guessed terminal returns `TERMINAL_NOT_OWNED`.

### If the signer refuses (stop; never "fix" the key store)

Surface the signer's error **code** and stop. The same holds for the resolver stops above (`SIGNER_KEYGEN_REQUIRES_LOCAL`, `SIGNER_KEYGEN_UNSUPPORTED`, `SIGNER_UNRESOLVED`): **name the code verbatim** in the final message to the operator — the exact token, never only a paraphrase. Never delete, move, rename, or edit `secret.json`; never edit the signer config or set `SOHOPAY_SIGNER_KEY_ROOTS`.

| Code | Action |
|------|--------|
| `CROSS_BORROWER_KEY` | A key for a different borrower exists at the path. Stop and surface — never delete/move/rename the key file |
| `TERMINAL_MISMATCH` | The key is bound to another terminal. Stop and surface — no destructive "fix" |
| `KEY_INTEGRITY_FAILED` | Stored public ≠ derived. Stop and **escalate to the human as possible tampering** |
| `KEY_PATH_INVALID` | Stop and surface — never edit the signer config (`~/.config/sohopay-signer/config.json`) and never set `SOHOPAY_SIGNER_KEY_ROOTS` to widen roots |
| `KEY_PERSIST_FAILED` | Surface the I/O failure; do not retry blindly |
| `MALFORMED_INPUT` | Fix the call shape (e.g. a wrongly client-supplied `nonce`/`iat`) and retry correctly |
| `INLINE_KEY_REJECTED` | Not a stop: re-run the **same** command once, as its own Bash call, with `--key <canonical key path>` (as signer.md shows it); **never** retry with an inline key |

Registering the key does **not** authorize spending. Immediately follow `{SKILLS_BASE}/authorize-agent.md` — do not wait for a payRequest or a `prepare_x402_payment` 403. Pay-time `AGENT_AUTHORIZATION_REQUIRED` is recovery only. Voucher signing after `VOUCHER_ISSUED`: `{SKILLS_BASE}/x402-credit-pay.md`.

