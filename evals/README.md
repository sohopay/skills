# Description trigger fixtures

JSON arrays of `{ "query", "should_trigger" }` for optimizing `SKILL.md` `description` fields per https://agentskills.io/skill-creation/optimizing-descriptions.

Not run in CI (no live agent harness). When editing a description:

1. Split queries ~60/40 train/validation.
2. Run each query against an agent with the skill installed; a pass is trigger-rate ≥ 0.5 iff `should_trigger`.
3. Broaden or narrow the description from **train** failures only; pick the iteration with the best validation pass rate.
4. Keep descriptions ≤ 1024 characters and include “Use when”.

Near-miss negatives (shared wallet / payments keywords that must **not** fire SohoPay money skills): “Send USDC from my wallet”, spreadsheet/Excel edits, Stripe checkout.
