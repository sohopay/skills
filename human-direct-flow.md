<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Human-Direct Flow

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**What this skill does:** the default operate path — the human borrower acts directly. **Before running it:** the MCP server is connected (`mcp-connect.md`).

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

## MCP catalog

The catalog covers `whoami` plus onboarding, spend, policy, signing, settlement, and repayment tools. Do not assume a fixed tool count — read the live `tools/list` from the connected server. Prefer `whoami` first when already authenticated.

**`whoami` usually omits `borrower_id` in this flow — use `principal_id` as the `borrower_id`.** The caller is the borrower here, so `principal_id` and `executor_id` both hold the borrower UUID; pass it to every tool that takes `borrower_id`. `whoami` also returns `wallet: null` because it reads JWT claims without calling the backend — get the wallet from `get_borrower_status`. Details: `{SKILLS_BASE}/borrower-onboard.md` § Resolving borrower_id from whoami.

Harnesses may also expose an extra `mcp_auth` tool for connection auth. It is a harness connection helper, not a SohoPay tool.

## End-to-end flow

```text
whoami (optional if already authenticated)
  → register_borrower
  → request_signature_challenge + submit_signature (wallet proof)
  → request_borrower_token   # spend/policy/signing scopes — whoami often shows only borrower:token until then
  → create_spend_intent (include order_ref / resource_identifier when using x402)
  → evaluate_spend_policy
  → sign_transaction (policy_decision_id; payload: {} as object; keep payment_intent echo)
  → get_signing_status (signature = intentSig)
  → merchant-as-settler X-PAYMENT → {SKILLS_BASE}/x402-credit-pay.md → keep settlement_id
  → get_settlement_status (poll by settlement_id until terminal)
```

If `whoami` scopes are only `borrower:token`, that is base/expired token state — **re-request** `request_borrower_token` with spend/policy/signing scopes before creating a spend intent. It is not an onboarding failure.

`SESSION_GATE_SKIPPED_NO_SESSION` is expected on this path and needs no action. First-time merchant (`RISK_FIRST_TIME_MERCHANT`) is a **once-per-merchant** operator consent, then a possible new envelope after settle-time deny — see `{SKILLS_BASE}/spend-and-pay.md` § First-time merchant.

`request_borrower_token` issues a **short-lived** token (staging: 15 minutes) that is not auto-refreshed. Because this flow pauses at consent gates, the token often expires before signing — re-request it immediately before `create_spend_intent` / `sign_transaction` rather than once at the start. After expiry `whoami` shows only the base scopes; that is expiry, not a scope failure. See `{SKILLS_BASE}/borrower-onboard.md` § Token lifetime.

**Wallet proof** (onboarding) is consent-critical — STOP and wait before asking the borrower to sign:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

On an **HTTP 402 payRequest**, do **not** STOP for `request_borrower_token` or for signing / `X-PAYMENT` after first-time merchant consent — complete merchant-as-settler silently (see `{SKILLS_BASE}/x402-credit-pay.md`). Onboarding/setup STOP before `request_borrower_token` does not apply once the operator asked to pay a 402 resource.

After the x402 settle submits: a mined `tx_hash` is not final until confirmation. Under **`l2_confirmations`**, expect `CONFIRMED` in **~5 seconds** after a successful receipt (P95 under 30s); confirmation worker retries are the **same** settle tx. **`available_credit` / outstanding balance update only after `CONFIRMED`** — re-check `get_outstanding_balance` after terminal confirmation. Details: `spend-and-pay.md` § Settlement finality and available credit.

Optional repayment (permissionless payer model):

```text
get_outstanding_balance → create_repayment or execute_repayment → payer submits on-chain repay tx
```

## High-risk tool

`sign_transaction` is the published high-risk tool. It requires:

- Live `POST /api/v1/auth/authorization-context`
- `AUTH_INTROSPECTION_ENABLED=true` on the MCP server
- Wallet proof + 2FA-equivalent where applicable

## Related skills

- Onboarding: `curl -fsSL {SKILLS_BASE}/borrower-onboard.md`
- Spend/policy: `curl -fsSL {SKILLS_BASE}/spend-and-pay.md`
- x402 settlement: `curl -fsSL {SKILLS_BASE}/x402-credit-pay.md`
