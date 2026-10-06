#!/usr/bin/env node
/**
 * Validates registry SKILL.md folders and generated hosted markdown.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  HOSTED_BASE,
  HOSTED_SKILL_DIRS,
  listRegistrySkillDirs,
  loadHostedSkills,
  loadSkill,
  ROOT,
  SKILLS_DIR,
} from './lib/skills.mjs';

const ENV_PRESET_STUBS = {
  'setup-staging.md': 'setup.md',
  'mcp-connect-staging.md': 'mcp-connect.md',
};

const FORBIDDEN_PATTERNS = [
  /\blocalhost\b/i,
  /\b127\.0\.0\.1\b/,
  /\b0\.0\.0\.0\b/,
  /sk-[a-zA-Z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA |EC )?PRIVATE KEY-----/,
  /x-soho-service-token:\s*[a-zA-Z0-9._-]{8,}/i,
];

const BYPASS_PATTERNS = [
  /full-access mode/i,
  /dangerously-skip-permissions/i,
  /disable permission/i,
  /bypass permission/i,
];

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

let failed = false;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  failed = true;
}

function pass(msg) {
  console.log(`OK: ${msg}`);
}

function checkForbidden(label, content) {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) fail(`${label} matches forbidden pattern ${pattern}`);
  }
  for (const pattern of BYPASS_PATTERNS) {
    if (pattern.test(content)) fail(`${label} contains permission-bypass language ${pattern}`);
  }
}

function checkCurl(label, content) {
  for (const rawLine of content.split('\n')) {
    const idx = rawLine.search(/\bcurl\s+\S/);
    if (idx === -1) continue;
    const cmd = rawLine.slice(idx).trim();
    if (/\bcurl\s+-sL\b/.test(cmd)) fail(`${label}: uses 'curl -sL' (use 'curl -fsSL'): ${cmd}`);
    const flags = cmd.match(/-[A-Za-z]+/g) ?? [];
    if (!flags.some((f) => f.includes('f'))) fail(`${label}: curl without -f flag (use 'curl -fsSL'): ${cmd}`);
  }
}

function checkHostedLinks(file, content) {
  const localLinks = content.match(/\]\([^)]+\)/g) ?? [];
  for (const link of localLinks) {
    const href = link.slice(2, -1);
    if (href.startsWith('http') || href.startsWith('{SKILLS_BASE}') || href.startsWith('#') || href.includes('github.com/sohopay')) {
      continue;
    }
    fail(`${file} has non-absolute markdown link: ${link}`);
  }
}

function checkNativeLinks(label, content) {
  const localLinks = content.match(/\]\([^)]+\)/g) ?? [];
  for (const link of localLinks) {
    const href = link.slice(2, -1);
    if (
      href.startsWith('http') ||
      href.startsWith('{SKILLS_BASE}') ||
      href.startsWith('{SKILL:') ||
      href.startsWith('#') ||
      href.startsWith('references/') ||
      href.includes('github.com/sohopay')
    ) {
      continue;
    }
    fail(`${label} has disallowed markdown link: ${link}`);
  }
}

const dirs = listRegistrySkillDirs();
if (!dirs.includes('sohopay-integrate')) fail('missing plugins/sohopay/skills/sohopay-integrate/SKILL.md');
else pass('registry skill sohopay-integrate exists');

for (const dirName of dirs) {
  let skill;
  try {
    skill = loadSkill(dirName);
  } catch (err) {
    fail(`${dirName}: ${err.message}`);
    continue;
  }
  const { data, body, raw } = skill;
  if (data.name !== dirName) fail(`${dirName}: frontmatter name "${data.name}" must match directory`);
  if (!NAME_RE.test(data.name ?? '')) fail(`${dirName}: invalid name (lowercase/hyphens only, no consecutive hyphens)`);
  if ((data.name ?? '').length > 64) fail(`${dirName}: name exceeds 64 chars`);
  const desc = data.description ?? '';
  if (desc.length < 1 || desc.length > 1024) fail(`${dirName}: description must be 1–1024 chars (got ${desc.length})`);
  if (!/use when/i.test(desc)) fail(`${dirName}: description must include "Use when"`);
  const lines = body.split('\n').length;
  if (lines > 500) fail(`${dirName}: SKILL.md body has ${lines} lines (max 500)`);
  checkForbidden(dirName, raw);
  checkCurl(dirName, raw);
  checkNativeLinks(dirName, raw);
  const withoutComments = raw.replace(/<!--[\s\S]*?-->/g, '');
  if (/agents\.sohopay\.xyz/.test(withoutComments)) {
    fail(`${dirName} hardcodes agents.sohopay.xyz — use {SKILL:} / {SKILLS_BASE}`);
  }
  if (HOSTED_SKILL_DIRS.includes(dirName) && !data.metadata?.hosted_name) {
    fail(`${dirName} missing metadata.hosted_name`);
  }
  const refs = join(skill.dir, 'references');
  if (existsSync(refs)) {
    for (const f of readdirSync(refs).filter((n) => n.endsWith('.md'))) {
      const refRaw = readFileSync(join(refs, f), 'utf8');
      checkForbidden(`${dirName}/references/${f}`, refRaw);
      checkCurl(`${dirName}/references/${f}`, refRaw);
      checkNativeLinks(`${dirName}/references/${f}`, refRaw);
    }
  }
  pass(`${dirName} frontmatter + content`);
}

for (const expected of HOSTED_SKILL_DIRS) {
  if (!dirs.includes(expected)) fail(`missing hosted skill dir ${expected}`);
}

const hostedSkills = loadHostedSkills();
const indexPath = join(ROOT, '.well-known/agent-skills/index.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
if (!index.skills?.length) fail('index.json has no skills');

const indexNames = new Set((index.skills ?? []).map((s) => s.name));
const hostedNames = hostedSkills.map((s) => s.data.metadata.hosted_name);

if (JSON.stringify(index.skills.map((s) => s.name)) !== JSON.stringify(hostedNames)) {
  fail('index.json skill names/order must match generate:hosted catalog');
}

for (let i = 0; i < hostedSkills.length; i++) {
  const s = hostedSkills[i];
  const hosted = s.data.metadata.hosted_name;
  const entry = index.skills[i];
  if (entry?.description !== s.data.description) {
    fail(`index.json description drift for ${hosted} — run npm run generate:hosted`);
  }
  const expectedUrl = `${HOSTED_BASE}/skills/v1/${hosted}.md`;
  if (entry?.url !== expectedUrl) fail(`index skill ${hosted} url must be ${expectedUrl}`);
  const mdFile = join(ROOT, `${hosted}.md`);
  try {
    statSync(mdFile);
    pass(`index entry ${hosted} maps to ${hosted}.md`);
  } catch {
    fail(`index skill ${hosted} missing file ${hosted}.md — run npm run generate:hosted`);
  }
}

const SKILL_FILES = (index.skills ?? []).map((skill) => `${skill.name}.md`);
for (const file of SKILL_FILES) {
  const content = readFileSync(join(ROOT, file), 'utf8');
  checkForbidden(file, content);
  checkCurl(file, content);
  checkHostedLinks(file, content);
  const withoutComments = content.replace(/<!--[\s\S]*?-->/g, '');
  if (/agents\.sohopay\.xyz/.test(withoutComments)) {
    fail(`${file} hardcodes agents.sohopay.xyz outside the SKILLS_BASE header — use {SKILLS_BASE}`);
  }
  pass(`${file} hosted content checks`);
}

const setup = readFileSync(join(ROOT, 'setup.md'), 'utf8');
for (const match of setup.matchAll(/\{SKILLS_BASE\}\/([a-z0-9-]+)\.md/gi)) {
  const name = match[1];
  if (!indexNames.has(name)) fail(`setup.md references ${name}.md but it is missing from index.json`);
}
if (!/Report the exact failed URL/.test(setup)) fail('setup.md missing the global failure rule');
const stopCount = (setup.match(/STOP — ask the operator and wait/g) ?? []).length;
if (stopCount < 1) {
  fail(`setup.md must STOP before a non-payRequest payment (found ${stopCount})`);
}
if (/Before requesting the OAuth access \/ borrower token/.test(setup)) {
  fail('setup.md must not ask for consent before request_borrower_token');
}
if (!/do \*\*not\*\* wait for a chat reply, before `request_borrower_token`/.test(setup)) {
  fail('setup.md must run request_borrower_token without a chat prompt');
}
const staging = readFileSync(join(ROOT, 'setup-staging.md'), 'utf8');
if (/Before requesting the OAuth access \/ borrower token/.test(staging)) {
  fail('setup-staging.md must not ask for consent before request_borrower_token');
}
if (!/do \*\*not\*\* wait for a chat reply, before `request_borrower_token`/.test(staging)) {
  fail('setup-staging.md must run request_borrower_token without a chat prompt');
}
if (!/Report to the operator/.test(setup)) {
  fail('setup.md missing the final "Report to the operator" step');
}
pass('setup.md safety scaffolding');

for (const [stubFile, canonical] of Object.entries(ENV_PRESET_STUBS)) {
  let stub;
  try {
    stub = readFileSync(join(ROOT, stubFile), 'utf8');
  } catch {
    fail(`missing env-preset stub ${stubFile}`);
    continue;
  }
  const linkRe = new RegExp(`\\{SKILLS_BASE\\}/${canonical.replace(/\.md$/, '')}\\.md`);
  if (!linkRe.test(stub)) fail(`${stubFile} must link to {SKILLS_BASE}/${canonical}`);
  if (!/STAGING/i.test(stub)) fail(`${stubFile} must declare the STAGING environment preset`);
  pass(`${stubFile} env-preset stub`);
}

const staleBundle = join(SKILLS_DIR, 'sohopay-integrate/docs');
if (existsSync(staleBundle)) {
  fail(`stale bundle dir ${staleBundle} — delete it; skills now live as sibling SKILL.md folders`);
} else {
  pass('no sohopay-integrate/docs mirror');
}

for (const dirName of dirs) {
  const evalPath = join(ROOT, 'evals', dirName, 'trigger-queries.json');
  try {
    const queries = JSON.parse(readFileSync(evalPath, 'utf8'));
    if (!Array.isArray(queries) || queries.length < 4) {
      fail(`evals/${dirName}/trigger-queries.json needs at least 4 queries`);
    } else if (!queries.every((q) => typeof q.query === 'string' && typeof q.should_trigger === 'boolean')) {
      fail(`evals/${dirName}/trigger-queries.json entries must have query + should_trigger`);
    } else {
      pass(`evals/${dirName}`);
    }
  } catch {
    fail(`missing evals/${dirName}/trigger-queries.json`);
  }

  const scenariosPath = join(ROOT, 'evals', dirName, 'scenarios.json');
  if (existsSync(scenariosPath)) {
    const CATALOGS = new Set(['v7', 'v8']);
    const STATES = new Set(['fresh', 'onboarded', 'authorized', 'frozen', 'post-payment', 'authz-error']);
    try {
      const scenarios = JSON.parse(readFileSync(scenariosPath, 'utf8'));
      if (!Array.isArray(scenarios) || scenarios.length < 1) {
        fail(`evals/${dirName}/scenarios.json must be a non-empty array`);
      } else if (!scenarios.every((s) =>
        typeof s.id === 'string' &&
        s.given && CATALOGS.has(s.given.catalog) && STATES.has(s.given.state) &&
        s.expect && typeof s.expect.tool === 'string' && typeof s.expect.rationale === 'string')) {
        fail(`evals/${dirName}/scenarios.json entries must have id, given{catalog in v7|v8, state in enum}, expect{tool, rationale}`);
      } else {
        pass(`evals/${dirName}/scenarios.json`);
      }
    } catch {
      fail(`evals/${dirName}/scenarios.json is not valid JSON`);
    }
  }

  const behavioralPath = join(ROOT, 'evals', dirName, 'behavioral-cases.json');
  if (existsSync(behavioralPath)) {
    try {
      const cases = JSON.parse(readFileSync(behavioralPath, 'utf8'));
      if (!Array.isArray(cases) || cases.length < 1) {
        fail(`evals/${dirName}/behavioral-cases.json must be a non-empty array`);
      } else if (!cases.every((c) => typeof c.id === 'string' && typeof c.given === 'string' && typeof c.expect === 'string')) {
        fail(`evals/${dirName}/behavioral-cases.json entries must have id, given, expect (strings)`);
      } else {
        pass(`evals/${dirName}/behavioral-cases.json`);
      }
    } catch {
      fail(`evals/${dirName}/behavioral-cases.json is not valid JSON`);
    }
  }
}

// ── SP5 invariants: the x402 voucher sign step routes to the signer ──────────
function checkSp5Invariants() {
  const pv = join(SKILLS_DIR, 'sohopay-x402/references/prepare-and-voucher.md');
  if (!existsSync(pv)) { fail('sohopay-x402/references/prepare-and-voucher.md missing'); return; }
  const pvRaw = readFileSync(pv, 'utf8');

  // #1 — no hand-crypto recipe in the hot-path file (scoped to this file only).
  const FORBIDDEN_CRYPTO = [/Ed25519/i, /\bcanonicalize\b/i, /@noble/i, /private_key/i, /base64url/i, /\bJCS\b/];
  for (const re of FORBIDDEN_CRYPTO) {
    if (re.test(pvRaw)) fail(`prepare-and-voucher.md contains forbidden crypto token ${re} (route to the signer, do not hand-roll)`);
  }

  // #2 — no skill file links to the removed "Protocol V2 sign recipe" anchor.
  // Also flag the prose phrase (the form that actually occurred), not just the anchor.
  const anchorRe = /#protocol-v2-sign-recipe[\w-]*|Protocol V2 sign recipe/i;
  for (const dirName of dirs) {
    const dir = join(SKILLS_DIR, dirName);
    const files = [join(dir, 'SKILL.md')];
    const refs = join(dir, 'references');
    if (existsSync(refs)) for (const f of readdirSync(refs).filter((n) => n.endsWith('.md'))) files.push(join(refs, f));
    for (const f of files) {
      if (!existsSync(f)) continue;
      if (anchorRe.test(readFileSync(f, 'utf8'))) fail(`${f} references the removed "Protocol V2 sign recipe" (anchor or prose)`);
    }
  }

  // #3 — every `voucher sign` invocation in x402 docs is file-based (no stdin / inline JSON),
  // checked on logical lines (backslash continuations joined); at least one complete call must exist.
  const x402Files = [pv, join(SKILLS_DIR, 'sohopay-x402/references/signer.md'), join(SKILLS_DIR, 'sohopay-x402/SKILL.md')];
  const REQUIRED_FLAGS = ['--key', '--input', '--write-header'];
  let completeInvocation = false;
  for (const f of x402Files) {
    if (!existsSync(f)) continue;
    const logical = readFileSync(f, 'utf8').replace(/\\\r?\n/g, ' ').split('\n');
    for (const line of logical) {
      if (!/\bvoucher sign\b/.test(line)) continue;
      if (/--input(\s+|=)(-(\s|$|['"])|['"]-['"]|\/dev\/stdin|['"]?\{)/.test(line) || /\|\s*\S*voucher sign/.test(line) || /<<</.test(line)) {
        fail(`${f}: voucher sign must be file-based (no stdin, inline JSON, pipe or here-string): ${line.trim()}`);
      }
      if (/voucher sign --envelope/.test(line)) {
        const missing = REQUIRED_FLAGS.filter((flag) => !line.includes(flag));
        for (const flag of missing) fail(`${f}: 'voucher sign --envelope' line missing ${flag}: ${line.trim()}`);
        if (missing.length === 0) completeInvocation = true;
      }
    }
  }
  if (!completeInvocation) fail('SP5: no complete voucher sign --envelope --key --input --write-header invocation found in x402 docs');
}
checkSp5Invariants();

if (failed) process.exit(1);
console.log('All skill validations passed.');
