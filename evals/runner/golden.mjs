// INV-sp6-golden-audit (T15 fix N8): goldens are recorded on Linux CI under --require-audit, so a committed golden
// (adapter claude-code) must say its capture was backed by a process-tree file audit. A golden recorded without one
// (macOS, no strace) would replay as a plain pass while its file-access ground truth was never observed.

/** null when the transcript is acceptable as a golden w.r.t. audit status, else the INV failure message. */
export function goldenAuditError(t) {
  if (t?.meta?.adapter !== "claude-code") return null;
  if (t.meta.audit === "available") return null;
  return `INV-sp6-golden-audit: golden recorded with meta.audit=${JSON.stringify(t.meta.audit ?? null)} (must be "available": record goldens on Linux CI with --require-audit)`;
}
