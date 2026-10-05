---
name: sohopay-handle
description: >
  Resolve a recipient @handle to a borrower_id, claim or check the borrower's
  own @handle, and turn their handle discoverability on or off. Use when you
  have an @handle and need the borrower_id, when a borrower wants to claim or
  check availability of a handle, asks about their handle, or wants it findable
  by others or hidden. Not for sending value itself, or for renaming or
  releasing an existing handle.
license: Apache-2.0
metadata:
  hosted_name: handle
  title: SohoPay Handles
  version: "1.0"
---

Handles are a borrower's public address. `register_borrower` returns the
borrower's own `handle` — not an input to `resolve_handle`, which takes someone
else's @handle. To send value to someone by their @handle, resolve it to a
`borrower_id` first — use the returned `borrower_id`, never the raw handle.

1. `resolve_handle` — input `{ handle }` (a raw `@handle`; the gateway
   normalizes `@alice` / `alice` / ` Alice `). Returns `{ borrower_id,
   display_name, avatar_hash, resolved_at, expires_at }`. **Bind to
   `borrower_id`**, not the handle, and re-resolve after `expires_at`.
   - `404 NOT_RESOLVABLE` → the handle does not exist, or its owner has opted
     out of discoverability. Handles are discoverable by default, so this
     usually means no such handle. Ask the recipient to share their
     `borrower_id` directly, or (if it is theirs) to re-enable discoverability.
   - `429` → you are resolving too fast; back off.
2. Use the returned `borrower_id` as the recipient when you send value.

Separately — your own handle (an independent action, not a step in the flow
above):

- `set_discoverability` — input `{ discoverable: boolean }`. Returns
  `{ discoverable }`, the value now in effect. Turns discoverability on or off
  for the ACTING borrower's OWN handle only; it cannot change anyone else's.
  Idempotent: setting the same value again succeeds as a no-op.
  - Handles are discoverable by default (set at claim / onboarding), so others
    can `resolve_handle` them. Call `set_discoverability { discoverable: false }`
    to hide the borrower's handle — others then get `404 NOT_RESOLVABLE` — and
    `{ discoverable: true }` to make it resolvable again.
  - Only do this when the borrower wants it; it changes their privacy.

Separately — claim or check the borrower's OWN handle (also independent of the
resolve flow; this is where handle claiming lives, during onboarding via
`{SKILL:sohopay-onboard}` or any time after):

- `check_handle_availability` — input `{ handle }`. Returns
  `{ handle, available, reason? }` (`handle` normalized; `reason` explains an
  unavailable or invalid one). Read-only and throttled — check a few
  candidates, not a brute-force sweep.
- `claim_handle` — input `{ handle }` (+ `idempotency_key`,
  `{SKILL:sohopay-idempotency}`). Returns `{ handle, discoverable, claimed_at }`
  — a first claim, discoverable by default. A claim is public and hard to undo,
  so confirm the exact handle with the borrower before calling. A borrower is
  still addressed by `borrower_id` for every payment, so a handle only adds
  discoverability — but **claiming one is a required onboarding gate**
  (`{SKILL:sohopay-onboard}`): this skill owns the mechanics, that skill owns the
  gate. `register_borrower` returns `handle: null` + `suggested_handles` +
  `next_action: "claim_handle"` when the borrower has none — claim a suggestion
  directly, or a custom handle after `check_handle_availability`.
  - **Never claim without an explicit yes on the exact string.** The gate requires
    the borrower's choice, not the agent's; a claim is public and hard to undo.
  - **Format:** 3–30 chars, lowercase ASCII `a-z0-9` with `.`/`_` as internal
    separators (start alphanumeric, no trailing or consecutive separators). A
    leading `@`, case, and whitespace normalize server-side.
  - Errors are recoverable — offer the next candidate: `HANDLE_UNAVAILABLE`
    (taken) → try another;
    `HANDLE_ALREADY_CLAIMED` → the borrower already has one, show it;
    `HANDLE_INVALID_FORMAT` / `HANDLE_ALPHABET` / `HANDLE_MIN_LENGTH` /
    `HANDLE_MAX_LENGTH` → fix the format; `HANDLE_RESERVED_BLOCKLIST` → pick
    another; availability `429` / rate-limit → back off, claim a suggestion.

Scopes on the borrower token: `handle:resolve` for `resolve_handle`,
`handle:update` for `set_discoverability` (a lookup scope never implies the
privacy change), `handle:claim` for `claim_handle` + `check_handle_availability`.
