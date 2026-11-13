# Skills/signing verification blockers

These apply to this repository portion only; consolidate with the backend implementation blockers.

| Severity | Exact action and result | Impact | Owner / next step |
|---|---|---|---|
| High | `npm ci --ignore-scripts --cache /tmp/sohopay-signer-npm-cache` in signer: HTTP 401 for private `@sohopay/signer-vectors@0.2.0` on GitHub Packages | Signer typecheck/vector/CLI suite not run; no mobile compatibility certification | Package owner supplies an approved authenticated test environment, not a token in chat. Re-run `npm run check`. |
| High | `npm run validate` and `npm run eval` fail on pristine skills base with stale skill hashes in existing goldens | Unpaused merge gate is not green; updated content requires genuine live captures | Maintainer regenerate live goldens using authorized test credentials; do not hand-edit or relabel transcripts. Existing CI uses SP6_PAUSE_GOLDEN_VALIDATION=1 and passes validation/replay locally. |
| Medium | Default full unit command cannot create `/home/agent/.cache/sp6-live` and local bwrap functional probe returns NETLINK_ROUTE Operation not permitted | Full suite cannot be represented as a clean device/sandbox pass | Use supported writable SP6_RUN_ROOT_BASE for local tests; record remaining failures/skips and re-run OS sandbox tests in supported CI. Do not weaken sandbox enforcement. |
| High | No actual iOS/Android ChatGPT/Claude instance or approved SohoPay integration available for this test | Mobile OAuth, callback continuity, status and signing readiness unverified | QA host/device matrix and separately authorized staging test plan required. |
| High | Existing signer relies on Node runtime/filesystem and no reviewed mobile secure storage/signing bridge exists in this change | No mobile PAYMENT_READY claim allowed | Security/backend owners decide per-intent or paired-runtime architecture before implementation; managed signing needs explicit custody approval. |

No PR created. No merge. No push. No deployment. No production settings, shared flags or financial data changed.
