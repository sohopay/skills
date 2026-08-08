#!/usr/bin/env node
/**
 * Validates hosted skill markdown and index.json before deploy.
 * Fails on: localhost URLs, secret-like patterns, broken internal links,
 * invalid index, non-failing curl usage, permission-bypass language,
 * hardcoded hosted URLs outside the SKILLS_BASE header, chained docs missing
 * from the index, and a setup.md missing its safety scaffolding.
 */
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HOSTED_BASE = 'https://agents.sohopay.xyz';

const FORBIDDEN_PATTERNS = [
  /\blocalhost\b/i,
  /\b127\.0\.0\.1\b/,
  /\b0\.0\.0\.0\b/,
  /sk-[a-zA-Z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA |EC )?PRIVATE KEY-----/,
  /x-soho-service-token:\s*[a-zA-Z0-9._-]{8,}/i,
];

// Language that would push an agent to escalate or bypass permission prompts.
const BYPASS_PATTERNS = [
  /full-access mode/i,
  /dangerously-skip-permissions/i,
  /disable permission/i,
  /bypass permission/i,
];

let failed = false;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  failed = true;
}

function pass(msg) {
  console.log(`OK: ${msg}`);
}

const indexPath = join(ROOT, '.well-known/agent-skills/index.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8'));

if (!index.skills?.length) {
  fail('index.json has no skills');
}

const SKILL_FILES = (index.skills ?? []).map((skill) => `${skill.name}.md`);

for (const file of SKILL_FILES) {
  const path = join(ROOT, file);
  const content = readFileSync(path, 'utf8');

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) {
      fail(`${file} matches forbidden pattern ${pattern}`);
    }
  }

  // Markdown links must be absolute (http...) unless they point at our GitHub
  // repo or use the {SKILLS_BASE} placeholder that agents substitute.
  const localLinks = content.match(/\]\([^h][^)]*\)/g) ?? [];
  for (const link of localLinks) {
    if (!link.includes('github.com/sohopay') && !link.includes('{SKILLS_BASE}')) {
      fail(`${file} has non-absolute markdown link: ${link}`);
    }
  }

  // Every remote fetch must fail loudly: curl needs -f, and never plain -sL.
  for (const rawLine of content.split('\n')) {
    const idx = rawLine.search(/\bcurl\s+\S/);
    if (idx === -1) continue;
    const cmd = rawLine.slice(idx).trim();
    if (/\bcurl\s+-sL\b/.test(cmd)) {
      fail(`${file}: uses 'curl -sL' (use 'curl -fsSL'): ${cmd}`);
    }
    const flags = cmd.match(/-[A-Za-z]+/g) ?? [];
    if (!flags.some((f) => f.includes('f'))) {
      fail(`${file}: curl without -f flag (use 'curl -fsSL'): ${cmd}`);
    }
  }

  // No permission-escalation language.
  for (const pattern of BYPASS_PATTERNS) {
    if (pattern.test(content)) {
      fail(`${file} contains permission-bypass language ${pattern}`);
    }
  }

  // Hosted host must only appear inside the SKILLS_BASE header comment; docs
  // reference other skills via {SKILLS_BASE}, not a hardcoded hostname.
  const withoutComments = content.replace(/<!--[\s\S]*?-->/g, '');
  if (/agents\.sohopay\.xyz/.test(withoutComments)) {
    fail(`${file} hardcodes agents.sohopay.xyz outside the SKILLS_BASE header — use {SKILLS_BASE}`);
  }

  pass(`${file} content checks`);
}

for (const skill of index.skills ?? []) {
  const expectedUrl = `${HOSTED_BASE}/skills/v1/${skill.name}.md`;
  if (skill.url !== expectedUrl) {
    fail(`index skill ${skill.name} url must be ${expectedUrl}`);
  }
  const mdFile = join(ROOT, `${skill.name}.md`);
  try {
    statSync(mdFile);
    pass(`index entry ${skill.name} maps to ${skill.name}.md`);
  } catch {
    fail(`index skill ${skill.name} missing file ${skill.name}.md`);
  }
}

// Every doc chained from setup*.md must exist in the index.
const indexNames = new Set((index.skills ?? []).map((s) => s.name));
for (const setupName of ['setup', 'setup-staging']) {
  const setup = readFileSync(join(ROOT, `${setupName}.md`), 'utf8');
  for (const match of setup.matchAll(/\{SKILLS_BASE\}\/([a-z0-9-]+)\.md/gi)) {
    const name = match[1];
    if (!indexNames.has(name)) {
      fail(`${setupName}.md references ${name}.md but it is missing from index.json`);
    }
  }

  // setup*.md must carry its safety scaffolding.
  if (!/Report the exact failed URL/.test(setup)) {
    fail(`${setupName}.md missing the global failure rule`);
  }
  const stopCount = (setup.match(/STOP — ask the operator and wait/g) ?? []).length;
  if (stopCount < 3) {
    fail(`${setupName}.md must contain at least 3 STOP points (found ${stopCount})`);
  }
  if (!/Report to the operator/.test(setup)) {
    fail(`${setupName}.md missing the final "Report to the operator" step`);
  }
  pass(`${setupName}.md safety scaffolding`);
}

const pluginSkill = join(ROOT, 'plugins/sohopay/skills/sohopay-integrate/SKILL.md');
try {
  statSync(pluginSkill);
  pass('registry skill sohopay-integrate exists');
} catch {
  fail('missing plugins/sohopay/skills/sohopay-integrate/SKILL.md');
}

// Local-first bundle: the registry package must ship byte-identical copies of the
// hosted docs so an installed agent can read them offline. Fail on drift.
const BUNDLE = join(ROOT, 'plugins/sohopay/skills/sohopay-integrate/docs');
function checkBundled(name, sourcePath) {
  try {
    if (readFileSync(join(BUNDLE, name), 'utf8') !== readFileSync(sourcePath, 'utf8')) {
      fail(`bundle drift: ${name} differs from source — run 'npm run sync:bundle'`);
    } else {
      pass(`bundle ${name} in sync`);
    }
  } catch {
    fail(`bundle missing ${name} — run 'npm run sync:bundle'`);
  }
}
for (const skill of index.skills ?? []) {
  checkBundled(`${skill.name}.md`, join(ROOT, `${skill.name}.md`));
}
checkBundled('index.json', indexPath);

if (failed) {
  process.exit(1);
}

console.log('All skill validations passed.');
