/**
 * INV-pin-sync helper: every documented `npx` / `npm i|install` invocation of the signer package in the signer docs
 * must carry exactly the pinned spec (scripts/signer-pin.mjs). An unpinned, floating (`@latest`, `@^x`) or stale
 * invocation would route a model to a signer the labeler's exact-semver templates do not sanction. A bare mention of
 * the package name (no npx / npm before it) is not an invocation.
 */
export const PIN_SYNC_DOCS = [
  'plugins/sohopay/skills/sohopay-x402/references/signer.md',
  'plugins/sohopay/skills/sohopay-x402/references/prepare-and-voucher.md',
  'plugins/sohopay/skills/sohopay-onboard/references/workload-key.md',
];

const INVOCATION_RE = /\b(?:npx|npm\s+(?:i|install))\b[^\n`]*?(@sohopay\/agent-signer)(@[^\s`'")\]]*)?/g;

/** Findings for one doc's text (empty = in sync). */
export function pinSyncErrors(text, rel, spec) {
  const errs = [];
  for (const m of text.matchAll(INVOCATION_RE)) {
    const got = `${m[1]}${m[2] ?? ''}`;
    if (got !== spec) {
      const line = text.slice(0, m.index).split('\n').length;
      errs.push(`INV-pin-sync: ${rel}:${line} invokes ${got}, not the pin ${spec}`);
    }
  }
  return errs;
}
