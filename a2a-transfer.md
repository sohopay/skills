<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1
     SKILLS_HOST (CDN origin): https://agents.sohopay.xyz
     Fetch order: local sticky → {SKILLS_BASE} → GitHub raw last-resort.
     Publish rewrites SKILLS_BASE to Prod and {SKILLS_HOST} to the origin. -->
<!-- Generated from plugins/sohopay/skills — do not hand-edit this file. Run npm run generate:hosted -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay A2A Transfer (Agent-to-Agent Credit)

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

Send the A2A transfer in the same turn. Do not plan.

**Before:** MCP connected; borrower onboarded with an **ACTIVE** grant; `operational_agent_id` stored from `register_borrower`. Grant terms: `{SKILLS_BASE}/authorize-agent.md`. Handle rules: `{SKILLS_BASE}/handle.md`.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

Need `a2a:send` on the borrower token. If it is missing, call `request_borrower_token` with `a2a:send` before the write — do not ask the operator first. `payment:execute` does **not** imply A2A permission.

```text
1. Grant — get_agent_authorization: a2a_enabled must be true and status ACTIVE
2. Send —
   - @handle → prefer send_to_handle(handle, amount_usd, …) (resolves + sends in one call)
   - UUID already known → a2a_send_transfer(recipient_borrower_id, …)
   Fresh UUID v4 idempotency_key; include borrower_id + operational_agent_id
3. Report — a2a_transfer_id, amount, recipient (handle and/or UUID), remaining_usd
```

## Phase 1 — Authorization & capability check

Read `get_agent_authorization` (or the authorization block on `get_context`). The grant must be live and A2A-permitted:

| Field | Meaning |
|-------|---------|
| `a2a_enabled` | Borrower signed permission for A2A transfers. Grants minted before the field existed read `false`; permission is never inferred. |
| `status` | Must be `ACTIVE` (and the grant inside its validity window). |
| `authorization_version` | Echoed back in the transfer response. |

- `a2a_enabled: false` → **STOP** and present the `authorize_agent` consent URL so the operator can
  sign a grant with A2A enabled (`allow_a2a_transfers: true`). Open the page verbatim; do not rebuild the
  URL, do not end the turn on "please open this page".
- Grant not `ACTIVE` (`PENDING`, `REVOKED`, `SUPERSEDED`, `EXPIRED`) → recover with
  `{SKILLS_BASE}/authorize-agent.md` first, then continue in the same turn.

**Shared budget:** merchant purchases and A2A transfers share the same agent limits
(`max_per_payment` / `daily_limit` / lifetime). Do **not** treat A2A as a separate grant counter.
Still do not invent local headroom math beyond those fields — the backend also enforces available
credit, the exposure ceiling, and SohoPay A2A caps (per-sender outstanding, per-pair-per-day, hourly
velocity, minimum sender account age). Send and let the backend decide:

- `A2A_INSUFFICIENT_CREDIT` (409) → the amount exceeds available credit or the exposure ceiling. Report
  it and offer a smaller amount; a larger grant may help only if shared payment limits were the blocker.
- `A2A_CAP_EXCEEDED` (409, `details.cap` names the limit hit) → report the named cap. Do **not** split
  into smaller sends to slip under a cap — that is deliberate cap evasion.
- `AGENT_A2A_NOT_PERMITTED` (403) → A2A is off on the grant; take the `a2a_enabled: false` path above.
- `A2A_SELF_A2A_FORBIDDEN` (400) → the recipient is the sender; refuse and say so.
- `A2A_AMOUNT_BELOW_MINIMUM` (400) → ask the operator for a larger amount.
- `A2A_RECIPIENT_ONBOARDING_INCOMPLETE` (409) → the recipient cannot receive yet; tell the operator, do not retry.

## Phase 2 — Execution

### Prefer `send_to_handle` for `@handle`

`send_to_handle` with `borrower_id`, `operational_agent_id`, `handle`, `amount_usd`, optional
`description`, `idempotency_key`.

- Resolves the handle server-side then sends in one call. Do **not** call `resolve_handle` first
  unless you already need the UUID for another reason.
- `404 NOT_RESOLVABLE` → **STOP.** The handle does not exist or is not discoverable. Tell the
  operator; do not guess a UUID and do not retry.
- `400 HANDLE_INVALID_FORMAT` → the handle is malformed; ask the operator to confirm it.
- `429 HANDLE_RESOLUTION_RATE_LIMITED` → back off, then retry once with the **same** `idempotency_key`.
- Response includes `recipient_handle`, `avatar_hash`, and `resolved_at` so you can confirm what
  was sent.

### Use `a2a_send_transfer` for a known UUID

`a2a_send_transfer` with `borrower_id`, `operational_agent_id`, `recipient_borrower_id`, `amount_usd`,
`idempotency_key`.

- `recipient_borrower_id` must be a UUID v4. An `@handle` fails schema validation by design —
  use `send_to_handle` instead.
- Sending to **yourself** (`recipient_borrower_id == borrower_id`) is not an A2A transfer; refuse.

### Common write rules

- `idempotency_key`: fresh UUID v4 per transfer (`{SKILLS_BASE}/idempotency.md`). Same transfer
  retried after a timeout or an `AGENT_AUTHORIZATION_REQUIRED` → **same** key. Never mint a new
  key to "make it work".
- `amount_usd`: `0.01`–`1_000_000`, at most 2 decimal places. More precision is a client-side
  validation error — ask the operator which amount they want.
- Both tools are writes: `Idempotency-Key` header **or** `idempotency_key` arg (required for
  Cursor/ChatGPT). One write per turn; no retry loop on a non-idempotent-looking failure.

## Phase 3 — Confirmation

The response includes `{ a2a_transfer_id, sender_borrower_id, recipient_borrower_id, amount_usd,
remaining_usd, transferred_at, spendable, operational_agent_id, authorization_version }`
(`send_to_handle` also returns `recipient_handle` / `avatar_hash` / `resolved_at`). Report
`a2a_transfer_id`, the amount actually sent, the recipient (`@handle` and/or UUID), and
`remaining_usd` as that transfer's unspent remainder — not the sender's available credit.

Transferred credit is **immediately spendable** (`spendable: true`) — it funds the recipient's own
payments, including x402, and it is not a refundable credit line. Say that once in the
confirmation. Do not follow up with a payment on the recipient's behalf; that needs the
recipient's own grant.

A later payment may come back with a `funding` breakdown (`a2a_transfers[]`, `own_credit_amount`,
`total_amount`) from `prepare_x402_payment` — A2A value is spent first. Mention it when the
operator asks why a payment was smaller than the balance.

## Out of scope

- Merchant HTTP 402 pays → `{SKILLS_BASE}/x402-credit-pay.md`.
- Paying back SohoPay debt → `{SKILLS_BASE}/repay.md` (an A2A transfer is not a repayment and does
  not reduce on-chain `outstanding` alone; sender A2A debt may appear as `a2a_debt_owed`).
- Sending USDC from an external wallet, or any on-chain transfer — SohoPay A2A moves **credit**,
  not tokens.
- Transferring to yourself, splitting a transfer to evade a cap, or sending on a non-`ACTIVE` grant.
