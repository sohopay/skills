# Description trigger fixtures

JSON arrays of `{ "query", "should_trigger" }` for optimizing `SKILL.md` `description` fields per https://agentskills.io/skill-creation/optimizing-descriptions.

Not run in CI: the trigger fixtures are not wired to the live harness below. When editing a description:

1. Split queries ~60/40 train/validation.
2. Run each query against an agent with the skill installed; a pass is trigger-rate ≥ 0.5 iff `should_trigger`.
3. Broaden or narrow the description from **train** failures only; pick the iteration with the best validation pass rate.
4. Keep descriptions ≤ 1024 characters and include “Use when”.

Near-miss negatives (shared wallet / payments keywords that must **not** fire SohoPay money skills): “Send USDC from my wallet”, spreadsheet/Excel edits, Stripe checkout.

## Behavioral scenarios (`scenarios.json`)

Optional per-skill `scenarios.json`: an array of
`{ id, given: { catalog: "v7"|"v8", state: "fresh"|"onboarded"|"authorized"|"frozen"|"post-payment"|"authz-error" }, expect: { tool, rationale } }`
capturing the tool choice the skill should produce for a given server catalog + borrower state.

**Documentation-of-intent, not CI-run** — the SP6 harness below runs only the onboard / x402 behavioral cases, not these scenarios. `npm run validate` checks only the file's shape (fields present, `catalog`/`state` in their enums), so it cannot silently rot or go malformed; it never executes the expectations.

## SP6 behavioral eval runner (`evals/runner/`)

The `sohopay-onboard` and `sohopay-x402` suites (`behavioral-cases.json` + `assertions.json`, 17 cases) are executable. Design: `docs/superpowers/specs/2026-10-07-sp6-behavioral-eval-runner-design.md`.

- **Replay (the merge gate; deterministic, no network, credentials or model):** `npm run eval` (`run.mjs --adapter replay --suite all`). Each case's golden (`transcripts/<id>.json`, a live `claude-code` capture) must pass, and each synthetic adversarial (`transcripts/adversarial/<id>.<variant>.json`) must fail. `validate.yml` runs it after `node --test evals/runner/*.test.mjs evals/runner/adapters/*.test.mjs`, then runs `npm run validate` (the `INV-sp6-*` invariants).
  - **Pending goldens:** a case listed in `evals/goldens-pending.json` that has no golden yet is reported `PENDING` instead of failing; its adversarials still run. An unlisted case without a golden still fails, a listed case that has a golden fails `INV-sp6-goldens-pending`, and the live workflow's regen job removes each id in the same commit as its golden. The file is CODEOWNERS-reviewed.
- **Live (opt-in, spends API budget):** `npm run eval:live`, which is `run.mjs --adapter claude-code --live`. It drives the pinned Claude Code CLI headless against a localhost mock world (mock MCP backend, sandboxed mock signer, canary secrets) and grades k samples per case.
  - `--live` is the only switch that lets the adapter start a real `claude`. Without it, only a marked test stub may run.
  - Other flags: `--suite`, `--case`, `--samples K`, and `--require-audit`. `--require-audit` refuses any sample that has no process-tree file audit. macOS has none, so goldens are recorded on Linux.
- **CI live run:** `.github/workflows/evals-live.yml`, triggered only by the `run-live-evals` label or a dispatch.
  - It opens `sp6-live-regression` issues for safety failures.
  - From a full k=5 run whose samples all passed, it commits goldens onto the PR head branch. Each committed golden is audited, secrets-scanned and replays green.
  - A maintainer then re-runs Validate skills.
