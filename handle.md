<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1
     SKILLS_HOST (CDN origin): https://agents.sohopay.xyz
     Fetch order: local sticky → {SKILLS_BASE} → GitHub raw last-resort.
     Publish rewrites SKILLS_BASE to Prod and {SKILLS_HOST} to the origin. -->
<!-- Generated from plugins/sohopay/skills — do not hand-edit this file. Run npm run generate:hosted -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Handles

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

Handles are a borrower's public address. `register_borrower` returns the
borrower's own `handle` — not an input to `resolve_handle`, which takes someone
else's @handle. To send value to someone by their @handle, resolve it to a
`borrower_id` first — use the returned `borrower_id`, never the raw handle.

1. `resolve_handle` — input `{ handle }` (a raw `@handle`; the gateway
   normalizes `@alice` / `alice` / ` Alice `). Returns `{ borrower_id,
   display_name, avatar_hash, resolved_at, expires_at }`. **Bind to
   `borrower_id`**, not the handle, and re-resolve after `expires_at`.
   - `404 NOT_RESOLVABLE` → the handle's owner has opted out of discoverability,
     or the handle does not exist. Ask the recipient to share their
     `borrower_id` directly, or to make their handle discoverable.
   - `429` → you are resolving too fast; back off.
2. Use the returned `borrower_id` as the recipient when you send value.

Separately — your own handle (an independent action, not a step in the flow
above):

- `set_discoverability` — input `{ discoverable: boolean }`. Returns
  `{ discoverable }`, the value now in effect. Turns discoverability on or off
  for the ACTING borrower's OWN handle only; it cannot change anyone else's.
  Idempotent: setting the same value again succeeds as a no-op.
  - Handles are discoverable by default (set at onboarding), so others can
    resolve them. Call `set_discoverability { discoverable: false }` to opt the
    borrower's handle out — others then get `404 NOT_RESOLVABLE` from
    `resolve_handle`; `{ discoverable: true }` opts it back in.
  - Only do this when the borrower wants it; it changes their privacy.

Scopes on the borrower token: `handle:resolve` for `resolve_handle`,
`handle:update` for `set_discoverability` (a lookup scope never implies the
privacy change).
