<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1 -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Human-Direct Flow (Catalog v2)

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**What this skill does:** runs the full **19-tool catalog v2** path when the human borrower acts directly (no delegated agent session). **Before running it:** the MCP server is connected (`mcp-connect.md`).

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise or guess the missing steps. Report the exact failed URL and error to the operator and suggest support@sohopay.xyz.

Use this path when the **human borrower** acts directly — no delegated agent session.

## Skip these tools

- `create_agent_session`
- `get_session_context`
- `revoke_session`

Never pass `session_id` on spend, payment, or signing tools.

## MCP catalog v2 (19 tools)

Catalog v2 includes `whoami` plus onboarding, spend, policy, signing, payment, settlement, repayment, and credit-approve tools. Prefer `whoami` first when already authenticated.

**`whoami` usually omits `borrower_id` in this flow — use `principal_id` as the `borrower_id`.** The caller is the borrower here, so `principal_id` and `executor_id` both hold the borrower UUID; pass it to every tool that takes `borrower_id`. `whoami` also returns `wallet: null` because it reads JWT claims without calling the backend — get the wallet from `get_borrower_status`. Details: `{SKILLS_BASE}/borrower-onboard.md` § Resolving borrower_id from whoami.

Harnesses may also expose an extra `mcp_auth` tool for connection auth. It is **not** part of catalog v2 — seeing 20 tools is expected and does not mean the catalog changed.

## End-to-end flow

```text
whoami (optional if already authenticated)
  → register_borrower
  → request_signature_challenge + submit_signature (wallet proof)
  → request_borrower_token
  → create_spend_intent (include order_ref / resource_identifier when using x402)
  → evaluate_spend_policy
  → sign_transaction (pass policy_decision_id; keep the payment_intent echo)
  → get_signing_status (signature = intentSig)
  → execute_payment  → keep settlement_id
  → get_settlement_status (poll by settlement_id until terminal: CONFIRMED / FAILED / DISPUTED / TIMED_OUT)
```

`request_borrower_token` issues a **short-lived** token (staging: 15 minutes) that is not auto-refreshed. Because this flow pauses at consent gates, the token often expires before signing — re-request it immediately before `create_spend_intent` / `sign_transaction` rather than once at the start. After expiry `whoami` shows only the base scopes; that is expiry, not a scope failure. See `{SKILLS_BASE}/borrower-onboard.md` § Token lifetime.

Wallet proof, the token request, and payment execution are all consent-critical. At each of those points:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

After execute: a mined `tx_hash` is not final. Base L2 `finalized` often lags ~15–19 minutes; confirmation worker retries are the **same** settle tx. **`available_credit` / outstanding balance update only after `CONFIRMED`** — tell the operator to expect a lag, and re-check `get_outstanding_balance` after terminal confirmation. Details: `spend-and-pay.md` § Settlement finality and available credit.

For HTTP 402 merchant paywalls, prefer merchant-as-settler (`X-PAYMENT`) after signing — see `{SKILLS_BASE}/x402-credit-pay.md`.

Optional repayment (permissionless payer model):

```text
get_outstanding_balance → create_repayment or execute_repayment → payer submits on-chain repay tx
```

## High-risk tools

`approve_credit_limit` requires `borrower_id` **and `reason`** (5–500 chars, a documented risk-officer or credit-admin justification). Set the limit with `new_limit` (uint256 base units) or legacy `approved_limit` (USDC decimal); `policy_tier` (0–2), `per_tx_cap`, and `daily_cap` are optional protocol-v1 controls.

`execute_payment`, `sign_transaction`, and `approve_credit_limit` require:

- Live `POST /api/v1/auth/authorization-context`
- `AUTH_INTROSPECTION_ENABLED=true` on the MCP server
- Wallet proof + 2FA-equivalent where applicable

## Related skills

- Onboarding: `curl -fsSL {SKILLS_BASE}/borrower-onboard.md`
- Spend/policy: `curl -fsSL {SKILLS_BASE}/spend-and-pay.md`
- x402 settlement: `curl -fsSL {SKILLS_BASE}/x402-credit-pay.md`
