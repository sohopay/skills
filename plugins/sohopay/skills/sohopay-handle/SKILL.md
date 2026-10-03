---
name: sohopay-handle
description: >
  Resolve a recipient @handle to a borrower_id, and turn the borrower's own
  handle discoverability on or off. Use when you have an @handle and need the
  borrower_id, when a borrower asks about their handle, or when they want their
  handle to be findable by others or hidden. Not for sending value itself, or
  for renaming or releasing a handle.
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
   - `404 NOT_RESOLVABLE` → the handle is not discoverable (auto-assigned
     handles are private until the owner opts in) or does not exist. Ask the
     recipient to share their `borrower_id` directly, or to make their handle
     discoverable.
   - `429` → you are resolving too fast; back off.
2. Use the returned `borrower_id` as the recipient when you send value.

Separately — your own handle (an independent action, not a step in the flow
above):

- `set_discoverability` — input `{ discoverable: boolean }`. Returns
  `{ discoverable }`, the value now in effect. Turns discoverability on or off
  for the ACTING borrower's OWN handle only; it cannot change anyone else's.
  Idempotent: setting the same value again succeeds as a no-op.
  - Auto-assigned handles start non-discoverable (private), so others get
    `404 NOT_RESOLVABLE` from `resolve_handle`. Call
    `set_discoverability { discoverable: true }` to make the borrower's handle
    resolvable by others; `{ discoverable: false }` hides it again.
  - Only do this when the borrower wants it; it changes their privacy.

Scopes on the borrower token: `handle:resolve` for `resolve_handle`,
`handle:update` for `set_discoverability` (a lookup scope never implies the
privacy change).
