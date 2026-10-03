---
name: sohopay-gift
description: >
  Send SohoPay credit from this borrower's facility to another borrower with send_gift
  (one turn: resolve @handle, check the grant, execute). Use when the operator said gift,
  send money to @someone, tip another agent, or transfer credit to a borrower_id — not for
  paying a merchant over HTTP 402, not for repaying SohoPay debt, and not for sending
  USDC from an external wallet.
license: Apache-2.0
metadata:
  hosted_name: gift
  title: SohoPay Gift (Agent-to-Agent Credit Transfer)
  version: "1.0"
---

Send the gift in the same turn. Do not plan. Do not pass an `@handle` to `send_gift`.

**Before:** MCP connected; borrower onboarded with an **ACTIVE** grant; `operational_agent_id` stored from `register_borrower`. Recipient resolution and grant terms: `{SKILL:sohopay-handle}` / `{SKILL:sohopay-authorize-agent}`.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

Need `gift:send` on the borrower token. If it is missing, call `request_borrower_token` with `gift:send` before the write — do not ask the operator first. `payment:execute` does **not** imply gifting permission.

```text
1. Recipient — if the operator gave an @handle: resolve_handle → recipient_borrower_id (UUID v4).
   If they gave a UUID, use it. Never send the handle string.
2. Grant — get_agent_authorization: read gift_enabled, max_per_payment, daily_limit, daily_spent
3. send_gift — fresh UUID v4 idempotency_key, with borrower_id + operational_agent_id
4. Report — gift_id, amount, recipient, remaining headroom
```

## Phase 1 — Recipient resolution

- `@handle` → `resolve_handle({ handle })` → use the returned `borrower_id` as `recipient_borrower_id`.
  - `404 NOT_RESOLVABLE` → **STOP.** The handle does not exist or is not discoverable (auto-assigned
    handles are private until the owner opts in). Tell the operator and ask for the recipient's
    `borrower_id`, or for them to enable discoverability. Do not guess a UUID and do not retry.
  - `429` → back off, then retry once.
- UUID v4 already in hand → skip `resolve_handle` entirely.
- Sending to **yourself** (`recipient_borrower_id == borrower_id`) is not a gift; refuse and say so.

## Phase 2 — Authorization & capability check

Read `get_agent_authorization` (or the authorization block on `get_context`). Grant limits are **USDC base units, 6 decimals** — compare against `amount_usd × 1_000_000`.

| Field | Meaning |
|-------|---------|
| `gift_enabled` | Borrower signed permission to gift. Grants minted before the field existed read `false`; a gift permission is never inferred. |
| `max_per_payment` | Per-gift cap |
| `daily_limit` / `daily_spent` | Rolling daily gifting cap and what is already used |
| `status` | Must be `ACTIVE` |
| `authorization_version` | Echoed back in the gift response |

- `gift_enabled: false` → **STOP** and present the `authorize_agent` consent URL so the operator can
  sign a grant with gifting enabled (`allow_gifts: true`, caps that cover `amount_usd`). Open the
  page verbatim; do not rebuild the URL, do not end the turn on "please open this page".
- `amount_usd × 1e6 > max_per_payment` or `daily_spent + amount_usd × 1e6 > daily_limit` → **STOP.**
  Report the cap and the shortfall, and offer the `authorize_agent` re-grant with larger terms. Do not
  split the gift into smaller sends to fit under a cap — that is deliberate cap evasion.
- Grant not `ACTIVE` (`PENDING`, `REVOKED`, `SUPERSEDED`, `EXPIRED`) → recover with
  `{SKILL:sohopay-authorize-agent}` first, then continue in the same turn.

## Phase 3 — Execution

`send_gift` with `borrower_id`, `operational_agent_id`, `recipient_borrower_id`, `amount_usd`, `idempotency_key`.

- `idempotency_key`: fresh UUID v4 per gift (`{SKILL:sohopay-idempotency}`). Same gift retried after a
  timeout or an `AGENT_AUTHORIZATION_REQUIRED` → **same** key. Never mint a new key to "make it work".
- `amount_usd`: `0.01`–`1_000_000`, at most 2 decimal places. More precision is a client-side validation
  error, not something to round silently into a different amount — ask the operator which amount they want.
- A `@handle` in `recipient_borrower_id` fails schema validation by design. That is Phase 1 not having run.
- `send_gift` is a write tool: `Idempotency-Key` header **or** `idempotency_key` arg (required for
  Cursor/ChatGPT). One write per turn; no retry loop on a non-idempotent-looking failure.

## Phase 4 — Confirmation

The response is `{ gift_id, sender_borrower_id, recipient_borrower_id, amount_usd, remaining_usd, gifted_at, spendable, operational_agent_id, authorization_version }`. Report `gift_id`, the amount actually sent, the recipient (`@handle` and/or UUID), and `remaining_usd` as the borrower's remaining credit headroom.

Gifted credit is **immediately spendable** (`spendable: true`) — it funds the recipient's own payments, including x402, and it is not a refundable credit line. Say that once, in the confirmation, before the operator gifts again. Do not follow up with a payment on the recipient's behalf; that needs the recipient's own grant.

A later payment may come back with a `funding` breakdown (`gifts[]`, `own_credit_amount`, `total_amount`) from `prepare_x402_payment` — gifts are spent first. Mention it when the operator asks why a payment was smaller than the balance.

## Out of scope

- Merchant HTTP 402 pays → `{SKILL:sohopay-x402}`.
- Paying back SohoPay debt → `{SKILL:sohopay-repay}` (a gift is not a repayment and does not reduce `outstanding`).
- Sending USDC from an external wallet, or any on-chain transfer — SohoPay gifts move **credit**, not tokens.
- Gifting to yourself, splitting a gift to evade a cap, or gifting on a non-`ACTIVE` grant.