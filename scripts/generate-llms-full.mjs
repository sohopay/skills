#!/usr/bin/env node
/** Concatenate hosted skill bodies into llms-full.txt for bulk agent context fetch. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const index = JSON.parse(
  readFileSync(join(ROOT, '.well-known/agent-skills/index.json'), 'utf8'),
);

const parts = [`# ${index.name}\n`, `${index.description}\n`];

for (const skill of index.skills) {
  const file = join(ROOT, `${skill.name}.md`);
  const body = readFileSync(file, 'utf8');
  parts.push(`\n\n---\n\n# ${skill.title}\n\n`, body);
}

writeFileSync(join(ROOT, 'llms-full.txt'), parts.join(''), 'utf8');
console.log(`Wrote llms-full.txt (${parts.join('').length} bytes)`);
