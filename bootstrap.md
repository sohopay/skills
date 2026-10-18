<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1
     SKILLS_HOST (CDN origin): https://agents.sohopay.xyz
     Fetch order: local sticky → {SKILLS_BASE} → GitHub raw last-resort.
     Publish rewrites SKILLS_BASE to Prod and {SKILLS_HOST} to the origin. -->
<!-- Generated from plugins/sohopay/skills — do not hand-edit this file. Run npm run generate:hosted -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Agent Bootstrap

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**Availability:** requires a server advertising tool-catalog **v8+**. On v7 servers use `whoami` (resolve `borrower_id = whoami.borrower_id ?? whoami.principal_id`) + `get_borrower_status`.

**Boundary.** This skill orients an already-connected, authenticated session — *what is my state and which flow next*. It does **not** connect or onboard: getting connected is `{SKILLS_BASE}/mcp-connect.md` / `{SKILLS_BASE}/setup.md`; borrower onboarding steps are `{SKILLS_BASE}/borrower-onboard.md`.

### Cold-start sequence
1. Connect / authenticate → `{SKILLS_BASE}/mcp-connect.md` (setup presets: `{SKILLS_BASE}/setup.md`).
2. If not yet onboarded — identity + onboarding state → `{SKILLS_BASE}/borrower-onboard.md`.
3. **Orient in one call → `get_context`** (v8+): returns `borrower_id`, credit headroom, authorization, and `next_actions` hints. On v7: `whoami` + `get_borrower_status`.
4. Route using **Routing** below — branch on the first blocking `next_actions` entry, scan the full array for `HANDLE_CLAIM_REQUIRED`, and treat every `FINANCIAL_SOURCE_REQUIRED` entry as an alternative. Do not re-derive the next step from raw balances/statuses; `get_context` already decided it.

### Routing
`get_context` returns `next_actions` with any blocking borrower step first (if any), then `PAY` when spending is available, then `AWAIT_REPAYMENT`, then other hints. If **any** entry has `reason_code: FINANCIAL_SOURCE_REQUIRED`, take the source choice below first — it may sit behind `PROVE_WALLET` (`WALLET_PROOF_REQUIRED`) at `[0]`. Otherwise branch on `next_actions[0]`: its `reason_code`, `actor`, and `handoff_required` tell you the move and whether the borrower is needed.

**`FINANCIAL_SOURCE_REQUIRED`.** Every entry with that reason is an alternative source. Ask the borrower wallet or bank before anything else, then: `CONNECT_WALLET` + `CONNECT_BANK` (no wallet) → `start_browser_handoff` with the chosen `action` and a fresh idempotency key; `PROVE_WALLET` + `CONNECT_BANK` (wallet registered, proof missing) → wallet means the proof (`request_signature_challenge` then `submit_signature`, no link), bank means `start_browser_handoff` with `action: CONNECT_BANK`. Open `open_url` verbatim. After the borrower returns, call `get_context`. Not a stop: a `CONNECT_BANK` listed next to `EVALUATE_CREDIT` is optional evidence for a borrower who already has a source. Details: `{SKILLS_BASE}/borrower-onboard.md` step 2.

| `next_actions[0].reason_code` | `actor` · handoff | Meaning | Go to |
|-------------------------------|-------------------|---------|-------|
| `BORROWER_REGISTRATION_REQUIRED` | BORROWER · yes | Borrower not registered | `{SKILLS_BASE}/borrower-onboard.md` |
| `FACILITY_OFFER_ACCEPTANCE_REQUIRED` | BORROWER · yes | Facility offer is ready — `REVIEW_AND_ACCEPT_FACILITY` calls `review_facility_offer` | `{SKILLS_BASE}/borrower-onboard.md` |
| `FINANCIAL_SOURCE_REQUIRED` | BORROWER · yes | No verified source — `CONNECT_WALLET` / `CONNECT_BANK` are alternatives (see above) | `{SKILLS_BASE}/borrower-onboard.md` step 2 |
| `WALLET_PROOF_REQUIRED` | BORROWER · yes | `PROVE_WALLET`: wallet registered, proof missing. With `CONNECT_BANK` listed, ask wallet or bank first | `{SKILLS_BASE}/borrower-onboard.md` steps 2 and 4 |
| `AGENT_AUTHORIZATION_REQUIRED` | BORROWER · yes | No ACTIVE agent grant | `{SKILLS_BASE}/authorize-agent.md` |
| `HANDLE_CLAIM_REQUIRED` | BORROWER · yes | No @handle — required onboarding gate (usually **not** `[0]`; emitted last — see note below); borrower picks/confirms, then `claim_handle` | `{SKILLS_BASE}/borrower-onboard.md` step 10 (claim path); tool contract `{SKILLS_BASE}/handle.md` |
| `SPENDING_AVAILABLE` (`can_pay: true`) | AGENT · no | Spending available — pick the pay flow by context | HTTP 402 merchant → `{SKILLS_BASE}/x402-credit-pay.md`; non-x402 spend/sign → `{SKILLS_BASE}/spend-and-pay.md`; operate (human-direct default) → `{SKILLS_BASE}/human-direct-flow.md` |
| `REPAYMENT_IN_FLIGHT` | AGENT · no | A repayment is confirming | `{SKILLS_BASE}/repay.md` (monitor) |

**`HANDLE_CLAIM_REQUIRED` when it is not `[0]`.** The backend may list `SPENDING_AVAILABLE` (or another AGENT step) before `HANDLE_CLAIM_REQUIRED` when the borrower can pay but has no @handle. After you act on `next_actions[0]`, scan the full array: any entry with `reason_code: HANDLE_CLAIM_REQUIRED` (`action: CLAIM_HANDLE`, `tool: claim_handle`) means onboarding is **incomplete** until a handle is claimed — hand off to the borrower via `{SKILLS_BASE}/borrower-onboard.md` step 10 (or `{SKILLS_BASE}/handle.md` for claim mechanics). Do not report the borrower as fully onboarded while that entry is present.

**`handoff_required: true` → stop and hand off.** The step needs the borrower's signature/decision (`actor: BORROWER`); surface it to the borrower and do not attempt it as the agent. `actor: AGENT` steps you perform yourself. For a delegated session, continue in `{SKILLS_BASE}/agent-session.md`.

> v8 may emit a blocking step plus `PAY`, `AWAIT_REPAYMENT`, `GIFT_RECEIVED`, and `HANDLE_CLAIM_REQUIRED` (last when the borrower has no handle). Source steps (`FINANCIAL_SOURCE_REQUIRED`) may both be listed. `REPAYMENT_IN_FLIGHT` is reserved on some deployments. If `next_actions` is empty and `can_pay` is false, resolve the blocker shown in `authorization` (frozen / suspended / compliance) before retrying. Exception: when `credit` is `null` there is no credit account yet, not a blocker (see below).

### get_context essentials
`get_context` is one backend-backed call returning `borrower_id` **directly**, plus credit, authorization, and `next_actions` hints. It replaces the `whoami` → `get_borrower_status` dance on v8+. `credit` and `repayment` are `null` when the borrower has no credit account yet: say there is no credit line yet and follow `next_actions` (if it is empty, there is nothing to do yet; say so). Never report it as a zero credit limit or credit balance. Received gifts are separate: report `gifts.available` when it is above zero, even with no credit line (not spendable until a credit account exists).

**When to call:** at session start, and after onboarding, credit activation, authorization, a material payment, a repayment, or an authorization error. Not before every trivial read.

**Invariant — descriptive only.** `prepare_x402_payment` revalidates and is authoritative. Never skip a payment attempt, or assume success, because `can_pay` was true.

**Identity.** Use the `borrower_id` `get_context` returns. Do **not** substitute `principal_id` for `borrower_id`.

| Tool | Use when |
|------|----------|
| `whoami` | JWT claims only; v7 servers or a thin identity check |
| `get_context` | v8+ — **prefer**: identity + credit + authorization + next step |
| `get_session_context` | Delegated-session detail — only if the host lists it |
| `authorization-context` | Grant limits behind a specific denial |
