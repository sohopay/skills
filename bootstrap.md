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
2. Identity + onboarding state → `{SKILLS_BASE}/borrower-onboard.md`.
3. **Orient in one call → `get_context`** (v8+): returns `borrower_id`, credit headroom, authorization, and one `next_actions` step. On v7: `whoami` + `get_borrower_status`.
4. Route on `next_actions` / `can_pay`:
   - operate (human-direct default) → `{SKILLS_BASE}/human-direct-flow.md`
   - spend / sign, non-x402 → `{SKILLS_BASE}/spend-and-pay.md`
   - pay an HTTP 402 merchant → `{SKILLS_BASE}/x402-credit-pay.md`
   - repay outstanding credit → `{SKILLS_BASE}/repay.md`
   - authorize an agent grant → `{SKILLS_BASE}/authorize-agent.md`
   - delegated session → `{SKILLS_BASE}/agent-session.md`

### get_context essentials
`get_context` is one backend-backed call returning `borrower_id` **directly**, plus credit, authorization, and one `next_actions` step. It replaces the `whoami` → `get_borrower_status` dance on v8+.

**When to call:** at session start, and after onboarding, credit activation, authorization, a material payment, a repayment, or an authorization error. Not before every trivial read.

**Invariant — descriptive only.** `prepare_x402_payment` revalidates and is authoritative. Never skip a payment attempt, or assume success, because `can_pay` was true.

**Identity.** Use the `borrower_id` `get_context` returns. Do **not** substitute `principal_id` for `borrower_id`.

| Tool | Use when |
|------|----------|
| `whoami` | JWT claims only; v7 servers or a thin identity check |
| `get_context` | v8+ — **prefer**: identity + credit + authorization + next step |
| `get_session_context` | Delegated-session detail — only if the host lists it |
| `authorization-context` | Grant limits behind a specific denial |
