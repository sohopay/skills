# Local verification, 2026-11-12

Scope: skills documentation and structural regression guards only. This is not live host, mobile device, payment, OAuth, or signer certification.

## Commands and results

- `npm run build`: passed; a second generation produced no further diff.
- `node --test evals/runner/mobile-host-guidance.test.mjs evals/runner/onboarding-labels.test.mjs`: 19 passed, 0 failed, including five new structural checks. The existing invented-profile-link guard remains intact.
- `SP6_PAUSE_GOLDEN_VALIDATION=1 npm run validate`: passed, using the existing CI setting. This does not verify fresh model behavior.
- `SP6_PAUSE_GOLDEN_VALIDATION=1 npm run eval`: passed replay, using the existing CI setting.
- `npm run validate` and `npm run eval` without that setting: failed. Existing golden skill hashes were already stale at the pristine base, and edited skill content also requires authentic new captures. No goldens were relabeled or rewritten.
- `SP6_RUN_ROOT_BASE=/workspace/shared/mobile-onboarding-implementation/test-runtime node --test evals/runner/*.test.mjs evals/runner/adapters/*.test.mjs`: 2,366 tests, 2,336 passed, 22 failed, 8 skipped. Exit 1. The 22 failures are live-adapter/stub capture paths reporting harness-secret detection (BUNDLE_HTTPS_PROXY), rather than the new mobile structural guards. No secret values were copied into this report, and no secret detector was bypassed.

A pristine `git archive` of the recorded develop base was also tested with a separate writable workspace run root. It reported 2,359 tests, 2,326 passed, 25 failed, 8 skipped. Every final failed test title also failed in this baseline run. Three additional baseline failures involve Git-tracked-file checks that cannot operate in a source archive without `.git`; therefore counts must not be interpreted as three fixed tests. Test-title comparison is evidence of matching failures, not proof that all possible regressions are absent.

The default run root is not writable here. Using the documented `SP6_RUN_ROOT_BASE` resolves that path issue but does not resolve all environment limitations. The local bwrap functional probe cannot open NETLINK_ROUTE; OS sandbox behavior needs a supported CI environment.

## Signer

Read-only reviewed develop SHA: `2f82ec8b5a2f3421ffa06bafcf617ebd4c9cb26c`.

`npm ci --ignore-scripts --cache /tmp/sohopay-signer-npm-cache` failed HTTP 401 downloading private `@sohopay/signer-vectors@0.2.0`. No signer tests or typecheck claimed. No signer source or custody changes made. See SIGNER_DECISION.md and BLOCKERS.md.

## Evidence

Workspace evidence directory: `/workspace/shared/mobile-onboarding-implementation/evidence/`.

Key logs: `skills-final-build.log`, `skills-final-mobile-tests.log`, `skills-final-ci-validate.log`, `skills-final-ci-eval.log`, `skills-final-validate.log`, `skills-final-eval.log`, `skills-final-tests-workspace-root.log`, `skills-baseline-tests-workspace-root.log`, `signer-npm-ci.log`.

No PR created. No merge. No push. No deployment. No production settings, shared flags or financial data changed.
