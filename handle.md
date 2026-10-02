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
