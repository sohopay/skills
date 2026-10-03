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
`{SKILLS_BASE}/borrower-onboard.md` or any time after):

- `check_handle_availability` — input `{ handle }`. Returns
  `{ handle, available, reason? }` (`handle` normalized; `reason` explains an
  unavailable or invalid one). Read-only and throttled — check a few
  candidates, not a brute-force sweep.
- `claim_handle` — input `{ handle }` (+ `idempotency_key`,
  `{SKILLS_BASE}/idempotency.md`). Returns `{ handle, discoverable, claimed_at }`
  — a first claim, discoverable by default. A claim is public and hard to undo,
  so confirm the exact handle with the borrower before calling. Optional: a
  borrower is always addressed by `borrower_id` and can transact without a
  handle; a handle only adds discoverability. `register_borrower` returns
  `handle: null` + `suggested_handles` + `next_action: "claim_handle"` when the
  borrower has none — claim a suggestion directly, or a custom handle after
  `check_handle_availability`.
  - **Format:** 3–30 chars, lowercase ASCII `a-z0-9` with `.`/`_` as internal
    separators (start alphanumeric, no trailing or consecutive separators). A
    leading `@`, case, and whitespace normalize server-side.
  - Errors recover, never block: `HANDLE_UNAVAILABLE` (taken) → try another;
    `HANDLE_ALREADY_CLAIMED` → the borrower already has one, show it;
    `HANDLE_INVALID_FORMAT` / `HANDLE_ALPHABET` / `HANDLE_MIN_LENGTH` /
    `HANDLE_MAX_LENGTH` → fix the format; `HANDLE_RESERVED_BLOCKLIST` → pick
    another; availability `429` / rate-limit → back off, claim a suggestion.

Scopes on the borrower token: `handle:resolve` for `resolve_handle`,
`handle:update` for `set_discoverability` (a lookup scope never implies the
privacy change), `handle:claim` for `claim_handle` + `check_handle_availability`.
