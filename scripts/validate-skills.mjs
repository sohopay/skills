#!/usr/bin/env node
/**
 * Validates hosted skill markdown and index.json before deploy.
 * Fails on localhost URLs, secret-like patterns, broken internal links, invalid index.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HOSTED_BASE = 'https://agents.sohopay.xyz';

const SKILL_FILES = [
  'setup.md',
  'mcp-connect.md',
  'borrower-onboard.md',
  'agent-session.md',
  'spend-and-pay.md',
  'x402-credit-pay.md',
  'idempotency.md',
];

const FORBIDDEN_PATTERNS = [
  /\blocalhost\b/i,
  /\b127\.0\.0\.1\b/,
  /\b0\.0\.0\.0\b/,
  /sk-[a-zA-Z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA |EC )?PRIVATE KEY-----/,
  /x-soho-service-token:\s*[a-zA-Z0-9._-]{8,}/i,
];

let failed = false;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  failed = true;
}

function pass(msg) {
  console.log(`OK: ${msg}`);
}

for (const file of SKILL_FILES) {
  const path = join(ROOT, file);
  const content = readFileSync(path, 'utf8');
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) {
      fail(`${file} matches forbidden pattern ${pattern}`);
    }
  }
  const localLinks = content.match(/\]\([^h][^)]*\)/g) ?? [];
  for (const link of localLinks) {
    if (!link.includes('github.com/sohopay')) {
      fail(`${file} has non-absolute markdown link: ${link}`);
    }
  }
  pass(`${file} content checks`);
}

const indexPath = join(ROOT, '.well-known/agent-skills/index.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8'));

if (!index.skills?.length) {
  fail('index.json has no skills');
}

for (const skill of index.skills) {
  if (!skill.url?.startsWith(HOSTED_BASE)) {
    fail(`index skill ${skill.name} url must start with ${HOSTED_BASE}`);
  }
  const mdFile = join(ROOT, `${skill.name}.md`);
  try {
    statSync(mdFile);
    pass(`index entry ${skill.name} maps to ${skill.name}.md`);
  } catch {
    fail(`index skill ${skill.name} missing file ${skill.name}.md`);
  }
}

const pluginSkill = join(ROOT, 'plugins/sohopay/skills/sohopay-integrate/SKILL.md');
try {
  statSync(pluginSkill);
  pass('registry skill sohopay-integrate exists');
} catch {
  fail('missing plugins/sohopay/skills/sohopay-integrate/SKILL.md');
}

if (failed) {
  process.exit(1);
}

console.log('All skill validations passed.');
