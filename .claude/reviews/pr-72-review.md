# PR Review: #72 — [FEAT] SOH-340: Implement borrower-onboard handle claim step

**Reviewed**: 2026-10-04
**Author**: onlyshishir (Adnan Md. Wahidur Rahman)
**Branch**: feat/soho-340-borrower-onboard-handle-claim → develop
**Decision**: APPROVE with comments (1 MEDIUM correctness fix recommended before merge)

## Summary
Docs/skill-only change implementing the deferred SOHO-340 handle-claim step now that SOHO-339 (catalog v13 + contract 0.19.0) has landed. The flow, ordering (handle step after the token so no chat question precedes `request_borrower_token`), soft-gate semantics, and tool contract are correct, and the `handle:claim` token scope is actually grantable (verified against the backend). One reference-doc accuracy bug on handle format should be fixed before merge; one product-coverage gap is a reasonable follow-up.

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM
- **`references/handle-claim.md` — wrong handle format rules.** The doc states handles are "1–64 chars" and "letters/digits, 1–64 chars". The backend (`sohopay-backend` `src/modules/handles/handle-format.ts`) enforces **`HANDLE_MIN_LENGTH = 3`, `HANDLE_MAX_LENGTH = 30`**, charset `^[a-z0-9._]+$` (lowercase ASCII alphanumeric plus `.`/`_` separators), must start alphanumeric, no trailing/consecutive separators, ASCII only. The 64 is only the MCP transport cap (`claimableHandleSchema.max(64)` / `RAW_INPUT_MAX_LENGTH`). As written the doc will lead an agent to propose invalid handles (2-char, 40-char, uppercase, hyphenated) and hit `HANDLE_MIN_LENGTH` / `HANDLE_MAX_LENGTH` / `HANDLE_ALPHABET` / `HANDLE_INVALID_FORMAT`. Fix: state 3–30 chars, lowercase `a-z0-9` with `.`/`_`.

- **Claim guidance has no standalone home (follow-up, per-plan).** The dedicated `sohopay-handle` skill covers only `resolve_handle` + `set_discoverability`, not `claim_handle` / `check_handle_availability`. This PR adds claim only to the onboarding flow (SOHO-340 scoped it there), and the onboard skill is oriented to first-time onboarding ("not for a warm 402 pay or delegated sessions"). The new step's "can claim one later" phrasing and the broadened `description` ("claim/check a handle") imply a path that no skill actually serves for an already-onboarded borrower. Recommend a follow-up to add claim/check to `sohopay-handle` (or cross-link) and, in this PR, soften the "claim later" wording.

### LOW
- **PR description inaccuracy (not the skill content).** The PR body says backend token issuance of `handle:claim` is "backend-side (separate)" and relies on "dropped scopes non-fatal." Verified otherwise: `handle:claim` is in `MCP_SCOPES` (0.19.0) and is **granted** by `evaluateRequestedScopes` for an active, non-sanctioned borrower (not wallet/prequal-gated), so the step-4 request issues it rather than dropping it. The feature works end-to-end with the borrower token; only the PR narrative is slightly off.
- **Pre-existing inconsistency (out of scope for #72).** `sohopay-handle` SKILL.md says auto-assigned handles "start non-discoverable (private)", which conflicts with the discoverable-by-default model (sohopay-backend#1295). Not touched by this PR; worth a tracking note.

## Validation Results

| Check | Result |
|---|---|
| Type check | Skipped (no TS in repo) |
| Lint | Skipped (none configured) |
| Tests | Pass — `npm run validate` (skill validator) |
| Build | Pass — `npm run build` (hosted + llms-full + index.json regenerated, no drift) |

## Files Reviewed
- `plugins/sohopay/skills/sohopay-onboard/SKILL.md` — Modified
- `plugins/sohopay/skills/sohopay-onboard/references/handle-claim.md` — Added
- `plugins/sohopay/skills/sohopay-onboard/references/scopes.md` — Modified
- `evals/sohopay-onboard/trigger-queries.json` — Modified
- `docs/superpowers/plans/2026-10-03-onboard-handle-claim.md` — Modified
- `borrower-onboard.md`, `llms-full.txt`, `.well-known/agent-skills/index.json` — Modified (generated)
