# Agent Bootstrap Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the standalone `sohopay-get-context` skill (from PR #61) into a primary cold-start orchestrator `sohopay-bootstrap`, wire the remaining flow skills to it (per-skill pointer-fit), and add eval coverage (richer trigger fixtures + a validated `scenarios.json` format).

**Architecture:** Rename the skill + eval dir in place, rewrite its `SKILL.md` to orient a connected session around `get_context` and route to the owning skills (pointers, no duplication). Flip every `{SKILL:sohopay-get-context}` pointer and the `HOSTED_SKILL_DIRS` entry, regenerate the hosted artifacts (`npm run build`), and `git rm` the stale `get-context.md`. All hosted `*.md`, `llms-full.txt`, and `index.json` are generated — never hand-edited.

**Tech Stack:** Markdown skills under `plugins/sohopay/skills/`, Node ESM generators/validator (`scripts/*.mjs`), `npm run build` / `npm run validate`. No app code, no unit-test framework — gates are the validator, a stale-pointer grep, and build-determinism.

**Spec:** `docs/superpowers/specs/2026-10-01-agent-bootstrap-skill-design.md`

## Global Constraints

- **Branch** `docs/SOHO-306-agent-bootstrap-skill`, **stacked on** `docs/SOHO-306-get-context-skills` (#61). PR base is that branch; retarget to `main` only after #61 merges. Do not merge (gated on prod v8 advertise — human decision).
- **Generated files are never hand-edited:** root `*.md`, `llms-full.txt`, `.well-known/agent-skills/index.json` come from `npm run build` (`generate:hosted` + `generate:llms-full`). Edit sources under `plugins/sohopay/skills/`, then regenerate.
- **Validator invariants** (`scripts/validate-skills.mjs`): every registry skill dir needs `evals/<dir>/trigger-queries.json` with ≥4 `{query, should_trigger}` entries; frontmatter `name` must equal the directory name; `description` 1–1024 chars and must contain "Use when"; SKILL body ≤500 lines; `index.json` skill names/order/descriptions must match `HOSTED_SKILL_DIRS`; no `localhost`/secret/`agents.sohopay.xyz` (outside the SKILLS_BASE header) patterns.
- **The generator maps `{SKILL:<dir>}` → `{SKILLS_BASE}/<hosted_name>.md`** and writes `<hosted_name>.md` per hosted skill but never deletes the old file — a rename requires `git rm` of the previous `<hosted_name>.md`.
- **v8-conditional everywhere:** no surface ever tells a v7 agent to call `get_context`; the v7 path is always `whoami` (`borrower_id = whoami.borrower_id ?? whoami.principal_id`) + `get_borrower_status`.
- **Wired skills get a pointer only** — no behavior/flow/step change, and the pointer is applied per the pointer-fit table (Task 2), not blindly.
- **No attribution** on commits or the PR (global setting).

## Review Focus

- **v7 correctness** — a v7 agent is never steered to `get_context`; every surface states the `whoami` + `get_borrower_status` fallback. (Tested: Task 1 bootstrap body + Task 2 pointers both carry the v7 clause; Task 3 scenarios include `v7-fresh`.)
- **Rename completeness** — no dangling `sohopay-get-context` / `get-context.md` anywhere incl. generated artifacts + index. (Tested: Task 1 stale-pointer grep gate → zero.)
- **Bootstrap↔onboard/setup trigger boundary** — bootstrap stays scoped to post-connect orientation and does not cannibalize setup/onboard triggers. (Tested: Task 3 cross-skill negative fixtures.)
- **Per-skill pointer-fit** — x402's fast-path "no extra fetch" is not broken; authorize-agent is not given a circular pointer; agent-session's STOP gate is preserved. (Tested: Task 2 per-skill rulings + validate stays green with no flow change.)
- **Generation determinism** — committed generated files exactly equal a fresh `npm run build`. (Tested: each task's build-determinism check `git diff --exit-code`.)

---

### Task 1: Rename `sohopay-get-context` → `sohopay-bootstrap` and rewrite it as the orchestrator

**Files:**
- Rename: `plugins/sohopay/skills/sohopay-get-context/` → `plugins/sohopay/skills/sohopay-bootstrap/` (git mv)
- Rename: `evals/sohopay-get-context/` → `evals/sohopay-bootstrap/` (git mv)
- Rewrite: `plugins/sohopay/skills/sohopay-bootstrap/SKILL.md`
- Modify: `scripts/lib/skills.mjs` (HOSTED_SKILL_DIRS entry)
- Modify: `plugins/sohopay/skills/sohopay-onboard/SKILL.md` (pointer flip, line 18)
- Modify: `plugins/sohopay/skills/sohopay-human-direct/SKILL.md` (pointer flip, line 16)
- Regenerate: `bootstrap.md` (+ `borrower-onboard.md`, `human-direct-flow.md`, `llms-full.txt`, `.well-known/agent-skills/index.json`); Delete: `get-context.md`

**Interfaces:**
- Produces: the skill dir `sohopay-bootstrap` with `metadata.hosted_name: bootstrap`; the pointer token `{SKILL:sohopay-bootstrap}` (consumed by Task 2 and the two flips here); the hosted file `bootstrap.md`.

- [ ] **Step 1: Write the failing check (stale-pointer grep + validate)**

Run (these are the task's "tests" — a grep gate and the validator):
```bash
cd /Users/adnan/development/soho-pay/skills-wt-soho306-bootstrap
git grep -nI 'sohopay-get-context\|get-context\.md' -- . ':!docs/superpowers/*'
```
Expected now: **matches** in `scripts/lib/skills.mjs`, `sohopay-onboard/SKILL.md`, `sohopay-human-direct/SKILL.md`, `borrower-onboard.md`, `human-direct-flow.md`, `get-context.md`, and the skill dir path — i.e. the rename is not done (RED).

- [ ] **Step 2: Rename the dirs**

```bash
git mv plugins/sohopay/skills/sohopay-get-context plugins/sohopay/skills/sohopay-bootstrap
git mv evals/sohopay-get-context evals/sohopay-bootstrap
```

- [ ] **Step 3: Rewrite `plugins/sohopay/skills/sohopay-bootstrap/SKILL.md`**

Replace the whole file with:
```markdown
---
name: sohopay-bootstrap
description: >
  Orient at the start of a connected SohoPay session: read identity, credit, authorization and one next step with get_context, then route to the right flow. Use when you have an authenticated session and need borrower_id, want to know whether this borrower can pay, or must decide which SohoPay flow comes next — after onboarding, credit activation, authorization, a payment, a repayment, or an authorization error. Requires catalog v8+; on v7 use whoami + get_borrower_status. Not for connecting or onboarding themselves, nor for every trivial read.
license: Apache-2.0
metadata:
  hosted_name: bootstrap
  title: SohoPay Agent Bootstrap
  version: "1.0"
---

**Availability:** requires a server advertising tool-catalog **v8+**. On v7 servers use `whoami` (resolve `borrower_id = whoami.borrower_id ?? whoami.principal_id`) + `get_borrower_status`.

**Boundary.** This skill orients an already-connected, authenticated session — *what is my state and which flow next*. It does **not** connect or onboard: getting connected is `{SKILL:sohopay-mcp-connect}` / `{SKILL:sohopay-setup}`; borrower onboarding steps are `{SKILL:sohopay-onboard}`.

### Cold-start sequence
1. Connect / authenticate → `{SKILL:sohopay-mcp-connect}` (setup presets: `{SKILL:sohopay-setup}`).
2. Identity + onboarding state → `{SKILL:sohopay-onboard}`.
3. **Orient in one call → `get_context`** (v8+): returns `borrower_id`, credit headroom, authorization, and one `next_actions` step. On v7: `whoami` + `get_borrower_status`.
4. Route on `next_actions` / `can_pay`:
   - operate (human-direct default) → `{SKILL:sohopay-human-direct}`
   - spend / sign, non-x402 → `{SKILL:sohopay-spend}`
   - pay an HTTP 402 merchant → `{SKILL:sohopay-x402}`
   - repay outstanding credit → `{SKILL:sohopay-repay}`
   - authorize an agent grant → `{SKILL:sohopay-authorize-agent}`
   - delegated session → `{SKILL:sohopay-agent-session}`

### get_context essentials
`get_context` is one backend-backed call returning `borrower_id` **directly**, plus credit, authorization, and one `next_actions` step. It replaces the `whoami` → `get_borrower_status` dance on v8+.

**When to call:** at session start, and after onboarding, credit activation, authorization, a material payment, a repayment, or an authorization error. Not before every trivial read.

**Invariant — descriptive only.** `prepare_x402_payment` revalidates and is authoritative. Never skip a payment attempt, or assume success, because `can_pay` was true.

**Identity.** Use the `borrower_id` `get_context` returns. Do **not** substitute `principal_id` for `borrower_id`.

| Tool | Use when |
|------|----------|
| `whoami` | JWT claims only; v7 servers or a thin identity check |
| `get_context` | v8+ — **prefer**: identity + credit + authorization + next step |
| `get_session_context` | Delegated-session detail — only if the host lists it |
| `authorization-context` | Grant limits behind a specific denial |
```

- [ ] **Step 4: Flip the registration entry in `scripts/lib/skills.mjs`**

In `HOSTED_SKILL_DIRS`, change the last entry `'sohopay-get-context',` → `'sohopay-bootstrap',` (keep its position — last).

- [ ] **Step 5: Flip the two source pointers**

`plugins/sohopay/skills/sohopay-onboard/SKILL.md` line 18 — change the trailing `{SKILL:sohopay-get-context}` to `{SKILL:sohopay-bootstrap}`.
`plugins/sohopay/skills/sohopay-human-direct/SKILL.md` line 16 — change `{SKILL:sohopay-get-context}` to `{SKILL:sohopay-bootstrap}`.
(Leave every `get_context` *tool* mention untouched — only the `{SKILL:…}` skill pointers flip.)

- [ ] **Step 6: Regenerate and remove the stale hosted file**

```bash
npm run build
git rm get-context.md
```

- [ ] **Step 7: Run the checks — expect GREEN**

```bash
git grep -nI 'sohopay-get-context\|get-context\.md' -- . ':!docs/superpowers/*'   # expect: no output
npm run validate                                                                  # expect: All skill validations passed.
npm run build && git diff --exit-code -- '*.md' llms-full.txt .well-known/         # expect: clean (determinism)
```
Expected: grep prints nothing; validator ends `All skill validations passed.`; `git diff --exit-code` exits 0.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs(bootstrap): rename get-context skill to sohopay-bootstrap orchestrator (SOHO-306)"
```

---

### Task 2: Wire the five flow skills to bootstrap (per pointer-fit)

Apply the context pointer per the ruling table — it is **not** uniform; each decision follows from the skill's actor and hot-path constraints (spec §Design 2, per-skill pointer-fit).

| Skill | Decision | Why |
|---|---|---|
| `sohopay-spend` | **Apply** standard pointer | agent spend/sign flow; needs borrower_id + can_pay + authorization first |
| `sohopay-x402` | **Reword** → add to existing "Before:" as a precondition, NOT a blocking "First: fetch" | the skill mandates "Do not fetch extra skills mid-pay if already loaded"; a blocking fetch would contradict the fast path |
| `sohopay-repay` | **Apply**, reworded to identity + outstanding balance | borrower repay; get_context surfaces outstanding debt |
| `sohopay-authorize-agent` | **Omit** | it is a step bootstrap routes *to*, invoked mid-onboarding before the agent holds `borrower:token`/an ACTIVE grant — a "call get_context first" pointer is circular and assumes scope the actor may lack |
| `sohopay-agent-session` | **Apply**, sequenced *before* the existing STOP gate | delegated-session creation needs borrower_id + authorization; must not displace the STOP-and-ask |

**Files:**
- Modify: `plugins/sohopay/skills/sohopay-spend/SKILL.md`
- Modify: `plugins/sohopay/skills/sohopay-x402/SKILL.md`
- Modify: `plugins/sohopay/skills/sohopay-repay/SKILL.md`
- Modify: `plugins/sohopay/skills/sohopay-agent-session/SKILL.md`
- (authorize-agent intentionally untouched — record the omission reason in the commit body)
- Regenerate: the four skills' hosted `*.md` + `llms-full.txt` + `index.json`

**Interfaces:**
- Consumes: `{SKILL:sohopay-bootstrap}` (Task 1).

- [ ] **Step 1: Failing check**

```bash
git grep -nI 'SKILL:sohopay-bootstrap' -- plugins/sohopay/skills/sohopay-spend plugins/sohopay/skills/sohopay-x402 plugins/sohopay/skills/sohopay-repay plugins/sohopay/skills/sohopay-agent-session
```
Expected now: no output (pointers not yet added) — RED.

- [ ] **Step 2: spend — insert after the "`idempotency_key` on writes … Default operate:" line**

Add this line immediately after that line:
```markdown
**First — orient:** establish context with `{SKILL:sohopay-bootstrap}` (v8+: `get_context` → `borrower_id`, credit, authorization, next step; v7: `whoami` + `get_borrower_status`).
```

- [ ] **Step 3: x402 — fold into the existing "**Before:**" paragraph (no blocking fetch)**

Append to the end of the `**Before:** onboarding is complete …` sentence:
```markdown
 Context should already be established via `{SKILL:sohopay-bootstrap}` (v8+ `get_context`; v7 `whoami` + `get_borrower_status`) — do not fetch it mid-pay if this file is already loaded.
```

- [ ] **Step 4: repay — insert after the "**Before:** MCP connected; borrower onboarded." line**

```markdown
**First — orient:** confirm identity and outstanding balance with `{SKILL:sohopay-bootstrap}` (v8+: `get_context` returns `borrower_id` + outstanding debt; v7: `whoami` + `get_borrower_status`).
```

- [ ] **Step 5: agent-session — insert BEFORE the STOP block (after the `Mcp-Session-Id` note, before "Before `create_agent_session`:")**

```markdown
**First — orient:** establish context with `{SKILL:sohopay-bootstrap}` (v8+: `get_context` → `borrower_id`, authorization; v7: `whoami` + `get_borrower_status`), then proceed to the STOP gate below.
```

- [ ] **Step 6: Regenerate**

```bash
npm run build
```

- [ ] **Step 7: Checks — expect GREEN**

```bash
git grep -nI 'SKILL:sohopay-bootstrap' -- plugins/sohopay/skills/sohopay-spend plugins/sohopay/skills/sohopay-x402 plugins/sohopay/skills/sohopay-repay plugins/sohopay/skills/sohopay-agent-session   # expect: 4 matches, one per file
git grep -nI 'SKILL:sohopay-bootstrap\|get_context' -- plugins/sohopay/skills/sohopay-authorize-agent/SKILL.md                                                                                       # expect: no output (omitted)
npm run validate                                                                                                                                                                                     # expect: All skill validations passed.
npm run build && git diff --exit-code -- '*.md' llms-full.txt .well-known/                                                                                                                           # expect: clean
```
Expected: exactly four pointer matches (spend/x402/repay/agent-session), zero in authorize-agent, validator green, determinism clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs(bootstrap): wire spend/x402/repay/agent-session to bootstrap; omit authorize-agent (circular, borrower-grant step)"
```

---

### Task 3: Evals — enrich trigger fixtures, add validated `scenarios.json`

**Files:**
- Rewrite: `evals/sohopay-bootstrap/trigger-queries.json`
- Create: `evals/sohopay-bootstrap/scenarios.json`
- Modify: `scripts/validate-skills.mjs` (add optional scenarios.json schema check)
- Modify: `evals/README.md` (document the scenarios format)

**Interfaces:**
- Consumes: the eval dir `evals/sohopay-bootstrap/` (Task 1).
- Produces: the `scenarios.json` schema check in the validator (so a malformed file fails `npm run validate`).

- [ ] **Step 1: Enrich `evals/sohopay-bootstrap/trigger-queries.json`**

Replace the file with (positives for the bootstrap surface; money near-miss negatives; **skill-vs-skill startup negatives** that pin the boundary):
```json
[
  {"query": "I'm starting a SohoPay workflow — what do I check first", "should_trigger": true},
  {"query": "who am I and can I pay right now", "should_trigger": true},
  {"query": "how do I get my borrower_id without whoami principal_id", "should_trigger": true},
  {"query": "I just onboarded — can this borrower pay now", "should_trigger": true},
  {"query": "get_context returned next_actions — what does can_pay mean", "should_trigger": true},
  {"query": "I hit AGENT_AUTHORIZATION_REQUIRED, re-check my context", "should_trigger": true},
  {"query": "check my credit and authorization before starting", "should_trigger": true},
  {"query": "how do I connect to the SohoPay MCP server", "should_trigger": false},
  {"query": "walk me through onboarding a new borrower", "should_trigger": false},
  {"query": "configure my SohoPay API keys and environment", "should_trigger": false},
  {"query": "Pay this 402 merchant URL.", "should_trigger": false},
  {"query": "create_agent_session for my bot", "should_trigger": false},
  {"query": "Send USDC from my wallet.", "should_trigger": false},
  {"query": "Create a Stripe checkout session.", "should_trigger": false}
]
```

- [ ] **Step 2: Create `evals/sohopay-bootstrap/scenarios.json`**

```json
[
  { "id": "v8-fresh", "given": { "catalog": "v8", "state": "fresh" },
    "expect": { "tool": "get_context", "rationale": "one call returns borrower_id + credit + authorization + next step" } },
  { "id": "v7-fresh", "given": { "catalog": "v7", "state": "fresh" },
    "expect": { "tool": "whoami+get_borrower_status", "rationale": "get_context not advertised on v7" } },
  { "id": "v8-onboarded", "given": { "catalog": "v8", "state": "onboarded" },
    "expect": { "tool": "get_context", "rationale": "confirm can_pay + next_actions after onboarding" } },
  { "id": "v8-frozen", "given": { "catalog": "v8", "state": "frozen" },
    "expect": { "tool": "get_context", "rationale": "reports frozen state + next_action; does not deny" } },
  { "id": "v8-authz-error", "given": { "catalog": "v8", "state": "authz-error" },
    "expect": { "tool": "get_context", "rationale": "re-establish context, then authorization-context for the specific grant limit" } }
]
```

- [ ] **Step 3: Add the scenarios schema check to `scripts/validate-skills.mjs`**

Inside the final `for (const dirName of dirs) { … }` eval loop, immediately after the `trigger-queries.json` try/catch block, add:
```javascript
  const scenariosPath = join(ROOT, 'evals', dirName, 'scenarios.json');
  if (existsSync(scenariosPath)) {
    const CATALOGS = new Set(['v7', 'v8']);
    const STATES = new Set(['fresh', 'onboarded', 'authorized', 'frozen', 'post-payment', 'authz-error']);
    try {
      const scenarios = JSON.parse(readFileSync(scenariosPath, 'utf8'));
      if (!Array.isArray(scenarios) || scenarios.length < 1) {
        fail(`evals/${dirName}/scenarios.json must be a non-empty array`);
      } else if (!scenarios.every((s) =>
        typeof s.id === 'string' &&
        s.given && CATALOGS.has(s.given.catalog) && STATES.has(s.given.state) &&
        s.expect && typeof s.expect.tool === 'string' && typeof s.expect.rationale === 'string')) {
        fail(`evals/${dirName}/scenarios.json entries must have id, given{catalog in v7|v8, state in enum}, expect{tool, rationale}`);
      } else {
        pass(`evals/${dirName}/scenarios.json`);
      }
    } catch {
      fail(`evals/${dirName}/scenarios.json is not valid JSON`);
    }
  }
```
(`existsSync`, `readFileSync`, `join`, `ROOT`, `fail`, `pass` are already imported/defined in the file.)

- [ ] **Step 4: Prove the check fails on a malformed file (RED)**

Temporarily set the first scenario's `given.catalog` to `"v9"`:
```bash
node -e "const f='evals/sohopay-bootstrap/scenarios.json';const a=JSON.parse(require('fs').readFileSync(f));a[0].given.catalog='v9';require('fs').writeFileSync(f,JSON.stringify(a,null,2))"
npm run validate
```
Expected: FAIL line `evals/sohopay-bootstrap/scenarios.json entries must have id, given{catalog in v7|v8, …}` and non-zero exit (RED).

- [ ] **Step 5: Restore and re-run (GREEN)**

Rewrite the correct Step-2 content back into `evals/sohopay-bootstrap/scenarios.json` (or `git checkout -- evals/sohopay-bootstrap/scenarios.json` if it was already committed), then:
```bash
npm run validate
```
Expected: `evals/sohopay-bootstrap/scenarios.json` OK line and `All skill validations passed.` (GREEN).

- [ ] **Step 6: Document the format in `evals/README.md`**

Append a section:
```markdown
## Behavioral scenarios (`scenarios.json`)

Optional per-skill `scenarios.json`: an array of
`{ id, given: { catalog: "v7"|"v8", state: "fresh"|"onboarded"|"authorized"|"frozen"|"post-payment"|"authz-error" }, expect: { tool, rationale } }`
capturing the tool choice the skill should produce for a given server catalog + borrower state.

**Documentation-of-intent, not CI-run** — there is no live-agent harness. `npm run validate` checks only the file's shape (fields present, `catalog`/`state` in their enums), so it cannot silently rot or go malformed; it never executes the expectations.
```

- [ ] **Step 7: Final checks — GREEN**

```bash
npm run validate                                                            # expect: scenarios OK + All skill validations passed.
npm run build && git diff --exit-code -- '*.md' llms-full.txt .well-known/  # expect: clean (evals/validator do not change generated output)
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "test(bootstrap): enrich trigger fixtures (incl. cross-skill negatives) + add validated scenarios.json"
```

---

## Notes for the executor
- The whole branch is stacked on #61; `git merge-base` for the final review is the #61 tip `031538a` (not `main`).
- No unit tests exist — the completion gate for every task is: `npm run validate` green, the task's grep gate satisfied, and `git diff --exit-code` on generated files clean after a rebuild.
- Do not touch `CLAUDE.md` — its `get_context` mentions are tool prose with no skill pointer and need no change.
- Do not merge or retarget the PR; that is gated on prod v8 advertise (human decision).
