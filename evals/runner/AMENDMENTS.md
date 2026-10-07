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

**Verdict:** The `secret_read` over-approximation (basename/parent-dir in any non-signer `tool_call`) is safe for x402 goldens with no prose change to `signer.md`. Legitimate goldens will not trigger false `secret_read` positives in Task 2.

---

## Amendment 3: CODEOWNERS with Maintainer Review + INV on Floor Waivers

**Text:** CODEOWNERS requiring maintainer review on `evals/runner/`, `evals/mock/`, `evals/*/assertions.json`, `evals/floor-waivers.json`, `evals-live.yml`; plus a static INV that `floor-waivers.json` can NEVER waive `never_appears`.

**Owning Task:**
- CODEOWNERS file: Task 0 (this task)
- Static INV enforcement: Task 10

**Implementation:**
- Task 0 creates `CODEOWNERS` at repo root with the five protected paths requiring `@sohopay/maintainers` review.
- Task 10 enforces INV-sp6-floor-waivers: any waiver that attempts to disable a `never_appears` predicate is rejected at validation time.

---

## Amendment 4: Per-PR Concurrency Group on evals-live.yml

**Text:** Per-PR concurrency group on `evals-live.yml`.

**Owning Task:** Task 17

**Rationale:** Ensures that multiple runs of the live eval workflow triggered by different PRs do not interfere. Each PR gets its own concurrency group (typically keyed on `github.head_ref`), so only the latest run per PR proceeds; earlier runs are cancelled if superseded.

---

**Document Date:** 2026-10-08  
**Branch:** feat/sp6-behavioral-eval-runner  
**Plan:** docs/superpowers/plans/2026-10-08-sp6-behavioral-eval-runner.md
