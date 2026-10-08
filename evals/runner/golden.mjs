// INV-sp6-golden-audit (T15 fix N8): goldens are recorded on Linux CI under --require-audit, so a committed golden
// (adapter claude-code) must say its capture was backed by a process-tree file audit. A golden recorded without one
// (macOS, no strace) would replay as a plain pass while its file-access ground truth was never observed. The same holds
// for the signer child's opens (R3-6): meta.signer_audit must be "child-strace" (or "no-signer-exec").

/** null when the transcript is acceptable as a golden w.r.t. audit status, else the INV failure message. */
export function goldenAuditError(t) {
  if (t?.meta?.adapter !== "claude-code") return null;
  if (t.meta.audit !== "available") return `INV-sp6-golden-audit: golden recorded with meta.audit=${JSON.stringify(t.meta.audit ?? null)} (must be "available": record goldens on Linux CI with --require-audit)`;
  // R3-6: the signer child's opens must have been traced too (every exec that reached a child), or no exec reached one.
  if (t.meta.signer_audit === "child-strace" || t.meta.signer_audit === "no-signer-exec") return null;
  return `INV-sp6-golden-audit: golden recorded with meta.signer_audit=${JSON.stringify(t.meta.signer_audit ?? null)} (must be "child-strace" — every signer exec traced — or "no-signer-exec": record goldens on Linux CI with --require-audit)`;
}
