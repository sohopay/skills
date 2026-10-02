---
name: sohopay-handle
description: >
  Resolve a recipient @handle to a borrower_id, and explain what a borrower's
  own handle is. Use when you have an @handle (e.g. to address a gift) and need
  the borrower_id, or when a borrower asks about their handle. Not for sending
  the gift itself ({SKILL:sohopay-spend}) or for changing/hiding a handle (that
  is a borrower web action).
license: Apache-2.0
metadata:
  hosted_name: handle
  title: SohoPay Handles
  version: "1.0"
---

Handles are a borrower's public address. `register_borrower` returns the
borrower's own `handle`. To send value TO someone by their @handle, resolve it
to a `borrower_id` first — the gift/payment routes bind a `borrower_id`, never a
raw handle.

1. `resolve_handle` — input `{ handle }` (a raw `@handle`; the gateway
   normalizes `@alice` / `alice` / ` Alice `). Returns `{ borrower_id,
   display_name, avatar_hash, resolved_at, expires_at }`. **Bind to
   `borrower_id`**, not the handle, and re-resolve after `expires_at`.
   - `404 NOT_RESOLVABLE` → the handle is not discoverable (auto-assigned
     handles are private until the owner opts in) or does not exist. Ask the
     recipient to share their `borrower_id` directly, or to make their handle
     discoverable.
   - `429` → you are resolving too fast; back off.
2. Use the returned `borrower_id` as the recipient on the gift/payment step.

Needs the `handle:resolve` scope on the borrower token.
