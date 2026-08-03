#!/usr/bin/env node
/**
 * Mirror the canonical hosted skill docs into the open-registry package so that
 * `npx skills add sohopay/skills -g` ships them locally. This lets an installed
 * agent read the chained skills from disk (local-first) with no network fetch —
 * the fix for sandboxed harnesses whose fetch tool returns "Cache miss".
 *
 * Generated output — do not hand-edit files under the bundle dir. Run:
 *   npm run sync:bundle
 * Drift is enforced by scripts/validate-skills.mjs.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INDEX = join(ROOT, '.well-known/agent-skills/index.json');
const BUNDLE = join(ROOT, 'plugins/sohopay/skills/sohopay-integrate/docs');

const rawIndex = readFileSync(INDEX, 'utf8');
const index = JSON.parse(rawIndex);

mkdirSync(BUNDLE, { recursive: true });

// Keep the bundle a pure mirror: drop stale files before copying.
for (const f of readdirSync(BUNDLE)) {
  if (f.endsWith('.md') || f === 'index.json') rmSync(join(BUNDLE, f));
}

let count = 0;
for (const skill of index.skills) {
  const name = `${skill.name}.md`;
  // Byte-for-byte copy so the drift check is exact and git stays deterministic.
  writeFileSync(join(BUNDLE, name), readFileSync(join(ROOT, name), 'utf8'), 'utf8');
  count++;
}
writeFileSync(join(BUNDLE, 'index.json'), rawIndex, 'utf8');

console.log(`Synced ${count} skill docs + index.json into ${BUNDLE.replace(`${ROOT}/`, '')}`);
