# SP6 Behavioral Eval Runner — Four Approved Amendments

> **Home:** Task 0 (CODEOWNERS, signer.md audit, floor-waivers, amendment log). Each amendment is threaded to its owning task for implementation.

## Amendment 1: handrolled_crypto Provenance Allowlist

**Text:** `handrolled_crypto` provenance allowlist covers ANY prior `tool_result`, not only signer tool_results (it is now a universal floor check).

**Owning Task:** Task 2

**Rationale:** The floor check must detect cryptographic operations across all tool results in a transcript, not just those from the signer tool, to prevent hand-rolled signing paths in any context.

---

## Amendment 2: Audit signer.md + workload-key.md for Instructed Non-Signer Key Access

**Text:** Audit `workload-key.md` + `signer.md` for any *instructed* non-signer command touching `secret.json` or its parent dir; fix the prose or narrow the `secret_read` over-approximation so legitimate goldens pass.

**Owning Task:** 
- `signer.md` portion: Task 0 (this task)
- `workload-key.md` portion: Task 12 (file arrives with #79)

**Amendment 2 Audit Finding (signer.md):**

Grep results:
```
47:<signer> voucher sign --envelope --key <secret.json path> --input "$dir/prep.json" --write-header "$dir/hdr.txt"
54:  (`~/.agents/sohopay-agent-workload/secret.json`). The agent **MUST NOT** read, print,
75:   delete the temp dir: `rm -rf "$dir"`. Both `prep.json` and `hdr.txt` must never be left
```

**Audit Conclusion:** No instructed non-signer command touches the key file or `~/.agents/sohopay-agent-workload/`. 
- Line 47: The signer's `--key <path>` invocation (sanctioned command; the signer reads the key opaquely).
- Lines 54–56: Prose constraint stating the agent "**MUST NOT** read, print, parse, copy, or summarize" the key (constraint, not an instructed command).
- Line 75: `rm -rf "$dir"` targets the `mktemp -d` temporary directory (created line 42), not the key's parent dir.

**Verdict (Task 0, signer.md only):** no instructed non-signer command touched the key file or its dir. The line numbers above are from Task 0; signer.md changed later (see the outcome below).

**Amendment 2 outcome (Tasks 12–14 and the final review):**

- **T12 audit (workload-key.md + signer.md).** The audit became test-backed and grew into the labeler redesign. The over-approximation stayed fail-closed; it was not narrowed. Instead, legitimate doc forms are sanctioned by a whole-call allowlist of doc-derived templates (`evals/runner/sanction.mjs`, `keyref.mjs`). Every documented form must label clean (the labeler-sanction must-pass tests), and every reviewed bypass must fire.
- **Prose changes**, made so that honest goldens pass without widening the allowlist:
  - `workload-key.md`:
    - keygen and `pop sign` read their JSON stdin from a single-quoted heredoc (`<<'SOHOPAY_EOF'`);
    - the resolver separates "no local signer" (`SIGNER_KEYGEN_REQUIRES_LOCAL`) from "installed but not answering" (`SIGNER_UNRESOLVED`).
  - `signer.md`:
    - the MCP sign sequence is: one Bash `mktemp -d`; the prepare response written to `<dir>/prep.json` with the file-write tool; one `voucher sign --envelope --key <secret.json path> --input <dir>/prep.json --write-header <dir>/hdr.txt`; `curl -H @<dir>/hdr.txt`; then removal of `<dir>`;
    - a literal mktemp dir is trusted across calls only under the mktemp-trust rule;
    - the quoted-heredoc last resort for `--input` was dropped.
  - `prepare-and-voucher.md`:
    - the V2 sign bullets point at that sequence;
    - the npx tier is pinned (`npx --no @sohopay/agent-signer@<pin>`, final review m1), and INV-pin-sync now covers it.
  - All three: every signer invocation passes `--output json` (Task 14 ruling). The labeler reads `created` / `jkt` and the x402 cross-check fields from that JSON and never parses human output.

---

## Amendment 3: CODEOWNERS with Maintainer Review + INV on Floor Waivers

**Text:** CODEOWNERS requiring maintainer review on `evals/runner/`, `evals/mock/`, `evals/*/assertions.json`, `evals/floor-waivers.json`, `evals-live.yml`; plus a static INV that `floor-waivers.json` can NEVER waive `never_appears`.

**Owning Task:**
- CODEOWNERS file: Task 0 (this task)
- Static INV enforcement: Task 10

**Implementation:**
- Task 0 creates `CODEOWNERS` at repo root with the five protected paths requiring `@sohopay/backend-write` review. Later tasks added `evals/live-workflow.sha256`, `scripts/validate-skills.mjs`, `validate.yml` (T17) and `evals/*/transcripts/` (final review I2); the repo-wide catch-all stays first.
- Task 10 enforces INV-sp6-floor-waivers: any waiver that attempts to disable a `never_appears` predicate is rejected at validation time.

---

## Amendment 4: Per-PR Concurrency Group on evals-live.yml

**Text:** Per-PR concurrency group on `evals-live.yml`.

**Owning Task:** Task 17

**Rationale:** Ensures that multiple runs of the live eval workflow triggered by different PRs do not interfere. Each PR gets its own concurrency group, keyed on the PR number (`sp6-live-${{ github.event.pull_request.number || github.ref }}`), so only the latest run per PR proceeds and earlier runs are cancelled. An event that will not run (the label is absent, or a different label was added) gets a unique `-noop-` suffix, so it can never cancel a live run in progress.

---

## Amendment 5: Pending Goldens

**Text:** `evals/goldens-pending.json` lists the cases whose golden has not been recorded yet. The replay gate and `INV-sp6-transcripts-present` report a listed case without a golden as `PENDING` instead of failing.

**Owning Task:** post-Task 17 (PR #80 CI)

**Rationale:** Goldens can only come from a paid live run. Without this, the zero-dependency merge gate stays red until all 17 record in one run, and the one-case `workflow_dispatch` smoke run needs `evals-live.yml` on the default branch first. Guardrails: an unlisted case without a golden still fails; a listed case whose golden exists is graded normally by replay and fails `INV-sp6-goldens-pending` until removed (the list only shrinks); the regen job removes each id in the golden's own commit; a malformed file fails closed; CODEOWNERS covers the file.

---

**Document Date:** 2026-10-08  
**Branch:** feat/sp6-behavioral-eval-runner  
**Plan:** docs/superpowers/plans/2026-10-08-sp6-behavioral-eval-runner.md
