// INV-sp6-golden-audit (T15 fix N8): goldens are recorded on Linux CI under --require-audit, so a committed golden
// (adapter claude-code) must say its capture was backed by a process-tree file audit. A golden recorded without one
// (macOS, no strace) would replay as a plain pass while its file-access ground truth was never observed. The same holds
// for the signer child's opens (R3-6): meta.signer_audit must be "child-strace" (or "no-signer-exec").

// Final review I2: a transcript's kind is bound to the adapter that produced it. A golden is a live claude-code capture
// (skill_hash-gated, audit-checked); an adversarial is a hand-authored synthetic near-miss. A synthetic file committed
// at the golden path would replay green, never go stale and skip INV-sp6-golden-audit, so it is a hard failure.
const KIND_ADAPTER = { golden: "claude-code", adversarial: "synthetic" };

/** null when `t`'s meta.adapter is the one its kind requires (golden ⇒ claude-code, adversarial ⇒ synthetic). */
export function transcriptKindError(t, kind) {
  if (!Object.hasOwn(KIND_ADAPTER, kind)) return `INV-sp6-transcript-kind: unknown transcript kind ${JSON.stringify(kind)}`;
  const adapter = t?.meta?.adapter;
  if (adapter === KIND_ADAPTER[kind]) return null;
  return kind === "golden"
    ? `INV-sp6-transcript-kind: a golden must be a claude-code capture, got meta.adapter=${JSON.stringify(adapter ?? null)} (synthetic transcripts belong in transcripts/adversarial/)`
    : `INV-sp6-transcript-kind: an adversarial must be synthetic, got meta.adapter=${JSON.stringify(adapter ?? null)} (live captures are goldens)`;
}

/** null when the transcript is acceptable as a golden w.r.t. adapter and audit status, else the INV failure message. */
export function goldenAuditError(t) {
  const kindErr = transcriptKindError(t, "golden");
  if (kindErr) return kindErr;
  if (t.meta.audit !== "available") return `INV-sp6-golden-audit: golden recorded with meta.audit=${JSON.stringify(t.meta.audit ?? null)} (must be "available": record goldens on Linux CI with --require-audit)`;
  // R3-6: the signer child's opens must have been traced too (every exec that reached a child), or no exec reached one.
  if (t.meta.signer_audit === "child-strace" || t.meta.signer_audit === "no-signer-exec") return null;
  return `INV-sp6-golden-audit: golden recorded with meta.signer_audit=${JSON.stringify(t.meta.signer_audit ?? null)} (must be "child-strace" — every signer exec traced — or "no-signer-exec": record goldens on Linux CI with --require-audit)`;
}
