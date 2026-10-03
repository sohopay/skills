## Handle claim (optional, soft gate)

A **@handle** is the public address other agents resolve to send gifts. It is **optional**: a borrower is always addressed by `borrowerId` and can pay, be authorized, and repay without one. A handle only makes the borrower discoverable and resolvable by others. **Never block onboarding on it** — if the borrower declines or a claim fails, finish onboarding and mention they can claim one later.

Tools ship with MCP catalog **v13** ([sohopay-mcp-server#142](https://github.com/sohopay/sohopay-mcp-server/pull/142)); scope `handle:claim` in `@sohopay/mcp-contract` ≥ `0.19.0`; backend [sohopay-backend#1296](https://github.com/sohopay/sohopay-backend/pull/1296). Add `handle:claim` to the `request_borrower_token` scope list (step 4); a dropped scope is not fatal — retry after gates, and skip the handle step if it stays absent.

**Ordering (critical):** run the handle step **after** `request_borrower_token` and the workload key, never before them. The borrower-token rule forbids any chat question before the token, and the confirmation below is a chat question. Keep it out of the critical chain (steps 1–7).

### Flow

1. `register_borrower` (step 1) returns `handle` (`null` or an existing handle), `suggested_handles` (ready-to-claim candidates), and `next_action`.
2. If `handle` is already set — show it, skip claiming.
3. If `next_action == "claim_handle"` — present `suggested_handles` and let the borrower pick one or propose a custom handle.
4. Custom handle → `check_handle_availability` first. If unavailable, offer the `suggested_handles` or another candidate. A `suggested_handles` entry can be claimed directly without checking.
5. **Confirmation STOP** — show the exact handle that will be claimed and wait for an explicit yes. A claim is public and hard to undo, so this is the one allowed chat question in the otherwise no-question turn.
6. `claim_handle` with the confirmed handle and an `idempotency_key` — `{SKILL:sohopay-idempotency}`.

### Tools

| Tool | Route | Input | Returns | Kind |
|------|-------|-------|---------|------|
| `check_handle_availability` | `POST /api/v1/handles/availability` | `{ handle }` | `{ handle, available, reason? }` | read (scoped `handle:claim`, throttled) |
| `claim_handle` | `POST /api/v1/handles/me/claim` | `{ handle }` (+ `idempotency_key`) | `{ handle, discoverable, claimed_at }` | write (scoped `handle:claim`) |

**Handle format:** 3–30 characters, lowercase ASCII `a-z0-9` with `.` or `_` as internal separators (must start with a letter/digit, no trailing separator, no two separators in a row). A leading `@` and case/whitespace are normalized server-side; the MCP input only caps raw length at 64, so rely on these rules, not that cap. `check_handle_availability` is throttled — check a few candidates, not a brute-force sweep. Reuse a `claim_handle` idempotency key only to retry the **same** handle.

### Errors (recover, never block)

| Code | Meaning | Do |
|------|---------|----|
| `HANDLE_UNAVAILABLE` | Taken by someone else | Offer `suggested_handles` or another candidate |
| `HANDLE_ALREADY_CLAIMED` | This borrower already has a handle | Show it, skip claiming |
| `HANDLE_INVALID_FORMAT` / `HANDLE_ALPHABET` / `HANDLE_MIN_LENGTH` / `HANDLE_MAX_LENGTH` | Bad format (charset / length) | Ask for a valid one (3–30 chars, lowercase `a-z0-9`, `.`/`_` allowed between) |
| `HANDLE_RESERVED_BLOCKLIST` | Reserved / blocked word | Pick a different handle |
| `HANDLE_AVAILABILITY_RATE_LIMITED` | Too many availability checks | Back off; claim a `suggested_handles` entry directly |

On any other non-2xx, follow the skill's global failure rule: STOP and report the exact failed route — except a handle failure never blocks onboarding; finish the remaining steps and tell the borrower they can claim a handle later.
