/**
 * INV-pin-sync helper: every documented package-runner / install invocation of the signer package must carry exactly
 * the pinned spec (scripts/signer-pin.mjs). An unpinned, floating (`@latest`, `@^x`) or stale invocation would route a
 * model to a signer the labeler's exact-semver templates do not sanction. A bare mention of the package name (no
 * runner/install verb before it) is not an invocation.
 *
 * Coverage (finding 4): the verb set spans every mainstream package runner / installer — `npx`, `npm i|install|exec`,
 * `pnpm dlx|add|install|i`, `yarn dlx|add`, `bunx`, `bun x|add|install|i` — and backslash-continued (multi-line)
 * invocations are joined before matching. PIN_SYNC_DOCS is no longer a hand-maintained triplet: it is every skill
 * source markdown under the plugins tree plus the generated hosted top-level markdown, so a stale invocation in any
 * of them fails the gate.
 */
import { readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Recursively collect every *.md under dir, as paths relative to ROOT (POSIX separators). */
function markdownUnder(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...markdownUnder(full));
    else if (e.isFile() && e.name.endsWith('.md')) out.push(relative(ROOT, full).split(sep).join('/'));
  }
  return out;
}

/** Top-level generated hosted `*.md` (siblings of this repo root), as ROOT-relative POSIX paths. */
function hostedMarkdown() {
  const out = [];
  let entries;
  try {
    entries = readdirSync(ROOT, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.md')) out.push(e.name);
  }
  return out;
}

/**
 * Every doc the pin gate scans: all plugin skill sources plus the generated hosted markdown.
 * A sorted, de-duplicated list of ROOT-relative POSIX paths.
 */
export const PIN_SYNC_DOCS = [...new Set([...markdownUnder(join(ROOT, 'plugins')), ...hostedMarkdown()])].sort();

const RUNNER =
  '(?:npx|npm\\s+(?:i|install|exec)|pnpm\\s+(?:dlx|add|install|i)|yarn\\s+(?:dlx|add)|bunx|bun\\s+(?:x|add|install|i))';
// Runner/install verb, then (across backslash-continued newlines, but no bare newline or backtick) the signer package
// with an optional version. `(?:\\\r?\n|[^\n`])*?` lets a multi-line `\`-continued command match as one invocation.
const INVOCATION_RE = new RegExp(
  `\\b${RUNNER}\\b(?:\\\\\\r?\\n|[^\\n\`])*?(@sohopay\\/agent-signer)(@[^\\s\`'")\\]]*)?`,
  'g',
);

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
