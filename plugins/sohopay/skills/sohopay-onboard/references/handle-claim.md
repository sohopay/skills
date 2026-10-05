## Handle claim (required gate)

A **@handle** is the public address other agents resolve to send gifts. It is a **required** part of onboarding: the borrower is not onboarded until they hold one. A borrower is still *addressed* by `borrowerId` for payments and repayment — the handle's job is to make them discoverable and resolvable by others — but onboarding does not complete without a claimed handle. Report the step as outstanding rather than quietly dropping it; the borrower can still change one any time via `{SKILL:sohopay-handle}`.

Tools ship with MCP catalog **v13** ([sohopay-mcp-server#142](https://github.com/sohopay/sohopay-mcp-server/pull/142)); scope `handle:claim` in `@sohopay/mcp-contract` ≥ `0.19.0`; backend [sohopay-backend#1296](https://github.com/sohopay/sohopay-backend/pull/1296). Add `handle:claim` to the `request_borrower_token` scope list (step 4). A dropped scope is not fatal on its own — re-request after gates and confirm `handle:claim` is in `scopes` before claiming; if it never arrives, this gate cannot be satisfied and onboarding stays incomplete (see **When the claim cannot succeed**).

**Ordering (critical):** run the handle step **after** `request_borrower_token` and the workload key, never before them. The borrower-token rule forbids any chat question before the token, and the confirmation below is a chat question. Keep it out of the critical chain (steps 1–7).

### Flow

1. `register_borrower` (step 1) returns `handle` (`null` or an existing handle), `suggested_handles` (ready-to-claim candidates), and `next_action`.
2. If `handle` is already set — show it, skip claiming. This gate is satisfied.
3. If `next_action == "claim_handle"` — present `suggested_handles` and ask the borrower to pick one or propose a custom handle. Do not pick for them and do not claim one silently; the agent's job here is to ask, not to decide.
4. Custom handle → `check_handle_availability` first. If unavailable, offer the `suggested_handles` or another candidate. A `suggested_handles` entry can be claimed directly without checking.
5. **Confirmation STOP** — show the exact handle that will be claimed and wait for an explicit yes. A claim is public and hard to undo, so this is the one allowed chat question in the otherwise no-question turn. Never read an implied assent ("go ahead", "whatever you pick") as consent for a specific handle — re-ask with the concrete string.
6. `claim_handle` with the confirmed handle and an `idempotency_key` — `{SKILL:sohopay-idempotency}`.

### When the claim cannot succeed

Recoverable failures keep the gate open and the turn going — offer another candidate each time:

- `HANDLE_UNAVAILABLE` / `HANDLE_RESERVED_BLOCKLIST` → next candidate.
- `HANDLE_INVALID_FORMAT` / `HANDLE_ALPHABET` / `HANDLE_MIN_LENGTH` / `HANDLE_MAX_LENGTH` → fix the format and re-confirm; a corrected string is a new handle, so it needs its own yes.
- `429` / rate-limit → back off, then claim a `suggested_handles` entry (no availability check needed).
- `HANDLE_ALREADY_CLAIMED` → the borrower already has one; show it. Gate satisfied, not a failure.

Once candidates are exhausted — the borrower has declined to choose, every candidate is taken, or `handle:claim` is absent from `scopes` after re-requesting — **STOP and report**. Say plainly that the borrower is **not onboarded** and that the handle is the one unmet gate, name the last error code, and state what would clear it (a free handle the borrower picks, or a token carrying `handle:claim`). Do **not** mark onboarding complete, do **not** loop asking again, and do **not** invent a handle or claim one to make the step pass.

### Tool mechanics, format rules, and errors

The `claim_handle` / `check_handle_availability` contract — routes, input/return shapes, the 3–30-char lowercase `a-z0-9` + `.`/`_` format rules, and the error codes — is owned by `{SKILL:sohopay-handle}`. This onboarding step only orchestrates **when** to run them; that skill is also where a borrower changes a handle any time after onboarding.

On any non-2xx, follow the skill's global failure rule (STOP and report the exact failed route). A handle failure is the one error that also leaves onboarding incomplete: report the unmet gate rather than declaring the borrower ready.
