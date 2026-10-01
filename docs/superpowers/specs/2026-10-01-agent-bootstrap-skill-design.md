# Agent Bootstrap Skill — Design (SOHO-306, skills repo)

**Date:** 2026-10-01
**Repo:** `sohopay/skills`
**Status:** Design approved in brainstorming; awaiting spec review → writing-plans.
**Branch:** `docs/SOHO-306-agent-bootstrap-skill`, **stacked on** `docs/SOHO-306-get-context-skills` (PR #61). #61 merges first; this retargets to `main` afterward.

---

## Intent (as discovered with the human partner)

**Outcome:** a single, primary cold-start skill — `sohopay-bootstrap` — that teaches an agent how to begin any SohoPay workflow, with `get_context` as its core step, and that every money/flow skill points back to. It replaces the standalone `sohopay-get-context` skill introduced by #61 (that skill *folds into* bootstrap). Plus: wire the remaining flow skills to the bootstrap step, and strengthen the eval coverage.

**Who it's for:** agents (and the humans reading hosted skills) starting a SohoPay session — resolving `borrower_id`, checking credit/authorization, and routing to the right operating skill.

**Success criteria:**
- An agent landing cold has one skill that sequences the start and tells it to call `get_context` (v8+) or fall back to `whoami` + `get_borrower_status` (v7).
- No standalone `sohopay-get-context` skill remains; `sohopay-bootstrap` is the single entry and every pointer resolves to it.
- The five flow skills not touched by #61 carry a uniform, v8-conditional "establish context first" pointer.
- Eval coverage exists in two forms: richer trigger fixtures (runnable by the README's method) and a documented behavioral-scenario format (intent, not yet CI-run).
- `npm run validate` and a deterministic `npm run build` pass; zero stale `sohopay-get-context` / `get-context.md` references remain.

**Separated assumptions (not stated by the partner, chosen by me — correct if wrong):**
- Skill name `sohopay-bootstrap` (hosted_name `bootstrap`, generated `bootstrap.md`).
- The bootstrap skill is an **orchestrator that owns only the get_context step**; all other steps are one-line pointers to existing skills, never restatements.
- The five wired skills are `sohopay-spend`, `sohopay-x402`, `sohopay-repay`, `sohopay-authorize-agent`, `sohopay-agent-session` (onboard + human-direct already carry the pointer from #61 and only need the rename flip).

---

## Decisions locked in brainstorming

| # | Question | Decision |
|---|----------|----------|
| 1 | Shape | Architectural: new primary skill + cross-skill wiring + evals |
| 2 | Bootstrap vs get-context | **Bootstrap replaces/absorbs** get-context (get-context folds in) |
| 3 | Relationship to #61 | **Stack on #61** (new branch off its branch; #61 merges first) |
| 4 | Eval workstream | **Both** — richer trigger fixtures AND a new documented behavioral-scenario format |

**Accepted tradeoff (decision 3):** stacking means #61 adds `sohopay-get-context` and this PR immediately renames/reshapes it — add-then-restructure churn visible across two PRs. Harmless (neither reaches prod before both merge), but the combined history looks like it changed its mind. The alternative (fold into #61) was declined. **Reconfirmed after design review** (the "stack buys nothing if #61 is unreviewed" finding): stay stacked — #61 is reviewed/handled as its own PR.

---

## Scope

### In scope
1. Rename `plugins/sohopay/skills/sohopay-get-context` → `sohopay-bootstrap` (`git mv`, preserving the eval dir move too) and rewrite its `SKILL.md`.
2. Rewrite #61's pointers to the old skill (`{SKILL:sohopay-get-context}` in onboard + human-direct; the generated `get-context.md`) to `sohopay-bootstrap` / `bootstrap.md`.
3. Add a uniform v8-conditional "establish context first" pointer to the five flow skills.
4. Flip the `HOSTED_SKILL_DIRS` registration entry.
5. Evals: move the eval dir; enrich `trigger-queries.json`; add `scenarios.json` + an `evals/README.md` section defining it.
6. Regenerate all hosted artifacts (`bootstrap.md`, the rewired skill docs, `llms-full.txt`, `.well-known/agent-skills/index.json`); `git rm` `get-context.md`.

### Out of scope
- A live-agent eval **runner** / CI harness (the repo has none; `scenarios.json` is documentation-of-intent only).
- Any change to the `get_context` tool, backend, or `@sohopay/mcp-contract` (that's SOHO-306 PR #126, already shipped).
- Behavior/flow changes to the wired skills (pointer insertion only).
- Retargeting/merging either PR (gated on prod v8 advertise; human decision).

---

## Design

### 1. `sohopay-bootstrap` skill (`plugins/sohopay/skills/sohopay-bootstrap/SKILL.md`)

Frontmatter: `name: sohopay-bootstrap`, `license: Apache-2.0`, `metadata.hosted_name: bootstrap`, `title: SohoPay Agent Bootstrap`, `version: "1.0"`. Description preserves the get-context trigger surface (identity / can_pay / "starting a SohoPay workflow") plus cold-start framing; ≤1024 chars; includes "Use when".

Body, in order:
1. **Availability banner** (verbatim from #61's get-context): requires catalog **v8+**; on v7 use `whoami` (`borrower_id = whoami.borrower_id ?? whoami.principal_id`) + `get_borrower_status`.
2. **Cold-start sequence** (new orchestration spine; pointers, not restatements):
   - Connect/auth → `{SKILL:sohopay-mcp-connect}`
   - Identity + onboarding state → `{SKILL:sohopay-onboard}`
   - **One call → `get_context`** (identity + credit + authorization + one `next_actions` step)
   - Branch on `next_actions` / `can_pay` → `{SKILL:sohopay-human-direct}`, `{SKILL:sohopay-spend}`, `{SKILL:sohopay-x402}`, `{SKILL:sohopay-repay}`, `{SKILL:sohopay-authorize-agent}`, `{SKILL:sohopay-agent-session}`
3. **Absorbed get_context essentials** (carried from #61): when-to-call; the **descriptive-only** invariant (`prepare_x402_payment` is authoritative; never skip a pay attempt because `can_pay` was true); identity rule (use `borrower_id`, don't substitute `principal_id`); the whoami / get_context / get_session_context / authorization-context decision table.

**Principle:** owns only the get_context step; every other step is a one-line `{SKILL:…}` pointer. No duplication of onboard/spend/x402 mechanics.

**Boundary vs `sohopay-onboard` / `sohopay-setup` (explicit, to avoid two "start here" skills colliding).** `sohopay-bootstrap` answers *"I have a connected, authenticated session — what's my state and which flow next?"*; it does **not** carry connection or onboarding mechanics. `sohopay-setup` / `sohopay-mcp-connect` own getting connected; `sohopay-onboard` owns the borrower onboarding steps. Bootstrap's description is scoped to **post-connect orientation** (identity/credit/authorization/next-step via `get_context`), not to "how do I set up / onboard" — so a setup or onboarding query fires those skills, not bootstrap. The skill body states this boundary in one line and points to setup/onboard for their parts.

### 2. Cross-skill wiring

Target `SKILL.md`s: `sohopay-spend`, `sohopay-x402`, `sohopay-repay`, `sohopay-authorize-agent`, `sohopay-agent-session`. Insert one identical pointer block near the top (after frontmatter and any existing STOP/preamble), worded as a convention:

> **First:** establish context — `{SKILL:sohopay-bootstrap}` (v8+: `get_context` returns `borrower_id`, credit, authorization, next step in one call). On v7 servers resolve identity via `whoami` + `get_borrower_status`.

Rules:
- **Pointer only** — no get_context mechanics restated (single source of truth in bootstrap).
- **v8-conditional** on every insertion (same discipline as #61).
- **No behavior/flow change** to target skills — entry pointer only; existing steps, field tables, STOP gates untouched.
- **Placement never contradicts an existing mandatory first step.** Where a skill already has a hard first action (e.g. `sohopay-agent-session`'s "STOP — ask the operator" before `create_agent_session`), the context pointer is sequenced *before* it as establish-context-then-STOP, not placed so the two compete. The plan pins exact placement per file.
- **Idempotent with #61:** onboard + human-direct already point at the old skill; their pointers flip to `sohopay-bootstrap` here, so all seven end up uniform.
- **Per-skill pointer-fit check (new, per design review).** The pointer is **not** applied blindly. `get_context` assumes an agent principal holding `borrower:token`; before inserting the block the plan verifies the fit for each target. `sohopay-authorize-agent` is a borrower-EOA-signing flow (the actor may be the borrower, not an agent) and parts of `sohopay-repay` may run under a different actor — for any skill where "call get_context first" is semantically wrong for its actor, the pointer is reworded (e.g. "establish identity for the acting principal") or omitted, with the reason recorded in the plan. The uniform wording is the default, not a mandate.

### 3. Evals (`evals/sohopay-bootstrap/`, moved from `evals/sohopay-get-context/`)

**(a) Richer trigger fixtures — `trigger-queries.json`** (existing flat `{query, should_trigger}` format; enough entries for a ~60/40 train/validation split):
- Positives: cold-start, identity-without-principal_id, post-event (onboarded/paid/repaid) "can I pay now", authz-error recovery, `can_pay`/`next_actions` meaning.
- Near-miss negatives (from the README's list): "Send USDC from my wallet", Stripe checkout, spreadsheet/Excel edits, plus the existing `create_agent_session` / raw-402-pay negatives.
- **Skill-vs-skill startup negatives (new, per design review):** queries that belong to a *neighbouring* startup skill and must **not** fire bootstrap — e.g. "how do I connect to the SohoPay MCP server" (→ setup/mcp-connect), "walk me through onboarding a new borrower" (→ onboard), "configure my API keys" (→ setup). These pin the §Design-1 boundary so bootstrap does not cannibalize setup/onboard triggers.

**(b) Behavioral-scenario format — `scenarios.json`** (new; documentation-of-intent, no runner):
```json
[
  { "id": "v8-fresh", "given": { "catalog": "v8", "state": "fresh" },
    "expect": { "tool": "get_context", "rationale": "one call returns borrower_id + credit + authorization + next step" } },
  { "id": "v7-fresh", "given": { "catalog": "v7", "state": "fresh" },
    "expect": { "tool": "whoami+get_borrower_status", "rationale": "get_context not advertised on v7" } },
  { "id": "v8-frozen", "given": { "catalog": "v8", "state": "frozen" },
    "expect": { "tool": "get_context", "rationale": "reports frozen state + next_action; does not deny" } },
  { "id": "v8-authz-error", "given": { "catalog": "v8", "state": "authz-error" },
    "expect": { "tool": "get_context", "rationale": "re-establish context; then authorization-context for the specific grant limit" } }
]
```
Schema: `{ id, given: { catalog: "v7"|"v8", state: "fresh"|"onboarded"|"authorized"|"frozen"|"post-payment"|"authz-error" }, expect: { tool, rationale } }`.

Extend `evals/README.md` with a section defining this schema and stating explicitly it is **documentation-of-intent, not CI-run**, until a live-agent harness exists (mirroring the README's existing honesty about trigger fixtures).

**Schema self-check (new, per design review).** Even without a behavioral runner, `scenarios.json` must not be unguarded dead documentation: `npm run validate` gains a lightweight shape check — every entry has `id`/`given`/`expect`, `given.catalog` ∈ {`v7`,`v8`}, and `given.state` ∈ the enum — so the file cannot silently rot or go malformed. This validates structure only; it does not execute the expectations.

### 4. Generation & registration
- `HOSTED_SKILL_DIRS` in `scripts/lib/skills.mjs`: entry `sohopay-get-context` → `sohopay-bootstrap` (preserve list position).
- `npm run build` regenerates `bootstrap.md` (+ rewired skill docs, `llms-full.txt`, `.well-known/agent-skills/index.json`); `git rm` `get-context.md`.

---

## Error handling & edge cases
- **v7 server:** every surface (bootstrap body, the five pointers, scenarios) states the `whoami` + `get_borrower_status` fallback. Guidance must never tell a v7 agent to call `get_context`.
- **Frozen/suspended borrower:** bootstrap + scenarios say `get_context` *reports* the state and yields a next action — it does not deny. (Matches the tool's `denyIfFrozenOrSuspended: false`.)
- **Stale pointer after rename:** the stale-pointer grep gate (below) fails the build until every `sohopay-get-context` / `get-context.md` reference is rewritten.
- **Validator rejects the new eval file:** if `npm run validate` hard-rejects `scenarios.json`, allowlist it in the validator rather than deforming the file to the trigger-query schema.

---

## Testing (no unit-test suite in this repo — gates are validation + grep + eval review)
- `npm run validate` → green (skill structure, registration, eval presence).
- **Stale-pointer grep gate (RED→GREEN for the rename):** zero matches for `sohopay-get-context` or `get-context.md` across SKILL bodies, generated artifacts, and the index — fails before pointer rewrites, passes after.
- **Build-determinism:** `npm run build` then `git diff --exit-code` on generated files → no drift.
- **scenarios.json guardrail + schema self-check:** `npm run validate` still green with the new eval file present, AND the added shape check (fields present, `catalog`/`state` in their enums) passes — a malformed `scenarios.json` must fail validate.
- Trigger fixtures reviewed by the README's optimize-descriptions method (hand-run; no CI).

---

## PR
- Stacked — base `docs/SOHO-306-get-context-skills`.
- Title: `[DOCS] SOHO-306: agent bootstrap skill (absorb get_context) + cross-skill wiring + evals`.
- Body: the rename/absorb, the wiring convention, the two eval styles, the stale-pointer gate; notes it is stacked on #61 and must retarget to `main` after #61 merges.
- No attribution (global setting).
- Merge gated on prod v8 advertise (same gate as #61) — human decision, not part of execution.

---

## Review Focus (for the plan's reviewer)
- v7 correctness: no surface steers a v7 agent to `get_context`.
- Rename completeness: no dangling `sohopay-get-context`/`get-context.md` anywhere, including generated artifacts and the hosted index.
- Non-duplication: the five pointers and bootstrap body do not restate get_context mechanics in more than one place.
- Wiring vs existing first-steps: the context pointer never contradicts a skill's existing mandatory first action (esp. agent-session's STOP gate).
- **Bootstrap↔onboard/setup boundary:** bootstrap's description stays scoped to post-connect orientation and does not cannibalize setup/onboard triggers — the skill-vs-skill negative fixtures must encode this.
- **Per-skill pointer-fit:** for each of the five wired skills, "call get_context first" is semantically right for that skill's actor, or reworded/omitted with a recorded reason.
- **scenarios.json self-check:** a malformed scenarios file fails `npm run validate`.
- Generation determinism: committed generated files exactly match a fresh `npm run build`.
