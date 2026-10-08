#!/usr/bin/env node
/**
 * Validates registry SKILL.md folders and generated hosted markdown.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadSuite, validateJoin } from '../evals/runner/cases.mjs';
import { closureFiles, skillHash } from '../evals/runner/hashes.mjs';
import { validateTranscript } from '../evals/runner/schema.mjs';
import { goldenAuditError, transcriptKindError } from '../evals/runner/golden.mjs';
import { validateWaivers } from '../evals/runner/waivers.mjs';
import { loadPending, PENDING_FILE } from '../evals/runner/pending.mjs';
import { livePinError, liveWorkflowErrors } from '../evals/runner/live-workflow-check.mjs';
import {
  HOSTED_BASE,
  HOSTED_SKILL_DIRS,
  listRegistrySkillDirs,
  loadHostedSkills,
  loadSkill,
  ROOT,
  SKILLS_DIR,
} from './lib/skills.mjs';
import { SIGNER_SPEC } from './signer-pin.mjs';
import { PIN_SYNC_DOCS, pinSyncErrors } from './lib/pin-sync.mjs';

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
let failCount = 0;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  failed = true;
  failCount += 1;
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
  // The stdin/inline ban applies to BOTH --input (the prepare response) AND --key (the private
  // key): the key must be an opaque file path, never argv/stdin — so `--key -` is rejected too.
  const x402Files = [pv, join(SKILLS_DIR, 'sohopay-x402/references/signer.md'), join(SKILLS_DIR, 'sohopay-x402/SKILL.md')];
  const REQUIRED_FLAGS = ['--key', '--input', '--write-header'];
  // `<flag> -` | `<flag>=-` | `<flag> "-"` | `<flag> /dev/stdin` | `<flag> {`/`"{` (inline JSON).
  const stdinOrInline = (flag) =>
    new RegExp(`${flag}(\\s+|=)(-(\\s|$|['"])|['"]-['"]|/dev/stdin|['"]?\\{)`);
  let completeInvocation = false;
  for (const f of x402Files) {
    if (!existsSync(f)) continue;
    const logical = readFileSync(f, 'utf8').replace(/\\\r?\n/g, ' ').split('\n');
    for (const line of logical) {
      if (!/\bvoucher sign\b/.test(line)) continue;
      // Reject stdin/inline for EITHER sensitive input, a pipe that feeds voucher sign
      // (through any leading tokens, e.g. `cat key | <signer> voucher sign`), or a here-string.
      if (
        stdinOrInline('--input').test(line) ||
        stdinOrInline('--key').test(line) ||
        /\|\s*(?:\S+\s+)*voucher sign/.test(line) ||
        /<<</.test(line)
      ) {
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

// ── SP5-complete invariants: onboarding routes keygen + PoP to the signer ────
function checkSp5CompleteInvariants() {
  const ONBOARD = join(SKILLS_DIR, 'sohopay-onboard');
  const SIGNER_MD = join(SKILLS_DIR, 'sohopay-x402/references/signer.md');
  const BEHAVIORAL = join(ROOT, 'evals/sohopay-onboard/behavioral-cases.json');
  const REGISTRY = join(ROOT, 'evals/sohopay-onboard/error-codes.json');
  const KEY_PATH_LITERAL = '~/.agents/sohopay-agent-workload/secret.json';

  // Collect every markdown file in a skill dir (SKILL.md + references/*.md).
  const skillFiles = (dir) => {
    const files = [];
    const skillMd = join(dir, 'SKILL.md');
    if (existsSync(skillMd)) files.push(skillMd);
    const refs = join(dir, 'references');
    if (existsSync(refs)) for (const f of readdirSync(refs).filter((n) => n.endsWith('.md'))) files.push(join(refs, f));
    return files;
  };
  const read = (f) => readFileSync(f, 'utf8');

  // INV-onboard-no-crypto — recipe PHRASES forbidden across the whole onboard dir.
  const RECIPE_PHRASES = [
    /generate (an?|a fresh) ed25519/i,
    /ed25519 keypair/i,
    /compute (the )?(jkt|thumbprint)/i,
    /\bRFC\s?7638\b/i,
    /JWK thumbprint/i,
    /SHA-256 of the JWK/i,
    /sign (the )?pop\b/i,          // the recipe verb, not the `pop sign` tool
    /\bcanonicalize\b/i,
    /@noble/i,
    /\bJCS\b/,
    /\bprivate_key\b/,             // underscore form only (not the spaced reassurance prose)
  ];
  for (const f of skillFiles(ONBOARD)) {
    const raw = read(f);
    for (const re of RECIPE_PHRASES) {
      if (re.test(raw)) fail(`INV-onboard-no-crypto: ${f} contains forbidden recipe phrase ${re} (route to the signer)`);
    }
  }

  // INV-onboard-routes — workload-key.md routes key generate + pop sign, file-based.
  const wk = join(ONBOARD, 'references/workload-key.md');
  if (!existsSync(wk)) {
    fail('INV-onboard-routes: sohopay-onboard/references/workload-key.md missing');
  } else {
    const wkRaw = read(wk);
    if (!/\bkey generate\b/.test(wkRaw)) fail('INV-onboard-routes: no `key generate` routing in workload-key.md');
    if (!/\bpop sign\b/.test(wkRaw)) fail('INV-onboard-routes: no `pop sign` routing in workload-key.md');
    if (!/key generate .*--out\b/.test(wkRaw)) fail('INV-onboard-routes: `key generate` must use file-based --out');
    if (!/pop sign .*--key\b/.test(wkRaw)) fail('INV-onboard-routes: `pop sign` must use file-based --key');
    // No stdin/inline key material into either call.
    for (const line of wkRaw.replace(/\\\r?\n/g, ' ').split('\n')) {
      if (/\b(key generate|pop sign)\b/.test(line) && /--key(\s+|=)(-(\s|$|['"])|\/dev\/stdin)/.test(line)) {
        fail(`INV-onboard-routes: key must be a file path, never stdin: ${line.trim()}`);
      }
    }
  }

  // INV-path-single-source — the key-path literal appears in exactly one file (signer.md).
  const pathHolders = [];
  for (const dirName of dirs) {
    for (const f of skillFiles(join(SKILLS_DIR, dirName))) {
      if (read(f).includes(KEY_PATH_LITERAL)) pathHolders.push(f);
    }
  }
  if (pathHolders.length !== 1 || pathHolders[0] !== SIGNER_MD) {
    fail(`INV-path-single-source: the key-path literal must appear only in signer.md; found in: ${pathHolders.join(', ') || '(none)'}`);
  }

  // INV-no-secret-access — `secret.json` never adjacent to read/copy/destroy verbs, and the
  // signer config / roots env never adjacent to a write verb — in INSTRUCTION prose. Prohibition
  // lines ("never read secret.json", "never set SOHOPAY_SIGNER_KEY_ROOTS") are the desired content,
  // not a violation, so skip any line carrying a negation marker. signer.md (the single-source
  // key-path definition) is additionally exempt from the secret-verb check.
  const PROHIBITION = /\b(never|must not|must never|do not|don't|cannot|no longer)\b/i;
  const SECRET_VERB = /(?:\b(cat|less|head|tail|cp|mv|rm|open|read|print|echo|summariz|delete|rename)\w*\b[^\n]{0,20}secret\.json|secret\.json[^\n]{0,20}\b(cat|less|head|tail|cp|mv|rm|open|read|print|echo|summariz|delete|rename)\w*\b)/i;
  const CONFIG_WIDEN = /(?:\b(edit|set|export|write|add|append)\w*\b[^\n]{0,24}(SOHOPAY_SIGNER_KEY_ROOTS|sohopay-signer\/config\.json)|(SOHOPAY_SIGNER_KEY_ROOTS|sohopay-signer\/config\.json)[^\n]{0,24}\b(edit|set|export|write|add|append)\w*\b)/i;
  for (const dirName of dirs) {
    for (const f of skillFiles(join(SKILLS_DIR, dirName))) {
      const raw = read(f);
      for (const line of raw.split('\n')) {
        if (PROHIBITION.test(line)) continue; // prohibition prose is the desired content
        if (f !== SIGNER_MD && SECRET_VERB.test(line)) fail(`INV-no-secret-access: ${f} puts secret.json adjacent to an access/destroy verb: ${line.trim()}`);
        if (CONFIG_WIDEN.test(line)) fail(`INV-no-secret-access: ${f} puts the signer config / roots env adjacent to a write verb: ${line.trim()}`);
      }
    }
  }

  // INV-no-inline-key — no skill passes private_key_base64url (or any key field) in a stdin example.
  for (const dirName of dirs) {
    for (const f of skillFiles(join(SKILLS_DIR, dirName))) {
      if (/private_key_base64url/.test(read(f))) fail(`INV-no-inline-key: ${f} references private_key_base64url (keys enter only via --key <path>)`);
    }
  }

  // INV-negative — the five excluded skills contain no agent-signing phrases and no signer routing.
  const EXCLUDED = ['sohopay-authorize-agent', 'sohopay-repay', 'sohopay-human-direct', 'sohopay-integrate', 'sohopay-setup'];
  const ROUTING_TOKENS = [
    /\bkey generate\b/, /\bpop sign\b/, /\bvoucher sign\b/,
    /sohopay-signer\b/, /@sohopay\/agent-signer\b/, /\bSOHOPAY_SIGNER\b/,
  ];
  for (const dirName of EXCLUDED) {
    for (const f of skillFiles(join(SKILLS_DIR, dirName))) {
      const raw = read(f);
      for (const re of RECIPE_PHRASES) {
        if (re.test(raw)) fail(`INV-negative: excluded skill ${f} contains agent-signing phrase ${re}`);
      }
      for (const re of ROUTING_TOKENS) {
        if (re.test(raw)) fail(`INV-negative: excluded skill ${f} contains signer-routing token ${re}`);
      }
    }
  }

  // INV-pin-sync — the pin in signer.md and the fail-closed install command equal SIGNER_SPEC.
  const signerRaw = existsSync(SIGNER_MD) ? read(SIGNER_MD) : '';
  if (!signerRaw.includes(SIGNER_SPEC)) fail(`INV-pin-sync: signer.md must contain the pin ${SIGNER_SPEC}`);
  if (existsSync(wk) && !read(wk).includes(SIGNER_SPEC)) fail(`INV-pin-sync: the workload-key.md install command must pin ${SIGNER_SPEC}`);
  // m1 (SP6 final review): every documented npx / npm install of the signer, in every signer doc, is the exact pin.
  for (const rel of PIN_SYNC_DOCS) {
    const f = join(ROOT, rel);
    if (existsSync(f)) for (const e of pinSyncErrors(read(f), rel, SIGNER_SPEC)) fail(e);
  }

  // INV-no-placeholder — no <x.y.z>/<version>/@latest placeholder in signer.md or workload-key.md.
  const PLACEHOLDER = /<x\.y\.z>|<version>|<x\.y>|@latest\b/;
  for (const f of [SIGNER_MD, wk]) {
    if (existsSync(f) && PLACEHOLDER.test(read(f))) fail(`INV-no-placeholder: ${f} still has a version placeholder`);
  }

  // INV-codes-registered (onboard surface) — every code token in the onboard docs + behavioral
  // cases is registered, and every registered code appears in that surface (no orphan).
  if (!existsSync(REGISTRY)) {
    fail('INV-codes-registered: evals/sohopay-onboard/error-codes.json missing');
  } else {
    const registered = new Set(JSON.parse(read(REGISTRY)).codes.map((c) => c.code));
    const CODE_RE = /\b(?:SIGNER_[A-Z_]+|KEY_[A-Z_]+|CROSS_BORROWER_KEY|TERMINAL_MISMATCH|MALFORMED_INPUT|INLINE_KEY_REJECTED)\b/g;
    // Shape-matching tokens that are NOT signer error codes — do not require registration.
    const NON_CODES = new Set(['KEY_NOT_REGISTERED', 'TERMINAL_NOT_OWNED', 'X402_AGENT_KEY_NOT_REGISTERED', 'SOHOPAY_SIGNER_KEY_ROOTS']);
    const surfaceFiles = [...skillFiles(ONBOARD)];
    if (existsSync(BEHAVIORAL)) surfaceFiles.push(BEHAVIORAL);
    const used = new Set();
    for (const f of surfaceFiles) {
      for (const m of read(f).matchAll(CODE_RE)) {
        const code = m[0];
        if (NON_CODES.has(code)) continue;
        used.add(code);
        if (!registered.has(code)) fail(`INV-codes-registered: ${f} uses unregistered code ${code}`);
      }
    }
    for (const code of registered) {
      if (!used.has(code)) fail(`INV-codes-registered: registered code ${code} is orphaned (used nowhere in the onboard surface)`);
    }
  }
}
checkSp5CompleteInvariants();

// ── SP6 invariants: behavioral eval runner (evals/runner) ────────────────────
const SP6_SUITES = ['sohopay-onboard', 'sohopay-x402'];

function checkSp6Waivers(knownIds) {
  const f = join(ROOT, 'evals/floor-waivers.json');
  if (!existsSync(f)) { fail('evals/floor-waivers.json missing'); return; }
  let doc;
  try { doc = JSON.parse(readFileSync(f, 'utf8')); } catch { fail('evals/floor-waivers.json is not valid JSON'); return; }
  const errs = validateWaivers(doc, knownIds);
  for (const e of errs) fail(`INV-sp6-floor-waivers: ${e}`);
  if (!errs.length) pass(`INV-sp6-floor-waivers (${doc.waivers.length} waivers)`);
}

/**
 * evals/ must contribute nothing to the published surface. Deterministic static check:
 * generator sources never name evals/, and every artifact they emit (index.json,
 * llms-full.txt, each hosted .md) contains no evals/ path.
 */
function checkSp6PublishIsolation() {
  const before = failCount;
  const sources = ['scripts/generate-hosted.mjs', 'scripts/generate-llms-full.mjs', 'scripts/lib/skills.mjs'];
  for (const rel of sources) {
    const f = join(ROOT, rel);
    if (existsSync(f) && /\bevals\b/.test(readFileSync(f, 'utf8'))) fail(`INV-sp6-publish-isolation: ${rel} references evals/`);
  }
  const outputs = [join(ROOT, 'llms-full.txt'), join(ROOT, '.well-known/agent-skills/index.json')];
  const idx = outputs[1];
  if (existsSync(idx)) {
    try {
      for (const s of JSON.parse(readFileSync(idx, 'utf8')).skills ?? []) outputs.push(join(ROOT, `${s.name}.md`));
    } catch { fail('INV-sp6-publish-isolation: index.json is not valid JSON'); }
  }
  for (const f of outputs) {
    if (existsSync(f) && /(^|[^A-Za-z0-9_-])evals\//.test(readFileSync(f, 'utf8'))) {
      fail(`INV-sp6-publish-isolation: published artifact ${f} references an evals/ path`);
    }
  }
  if (failCount === before) pass('INV-sp6-publish-isolation');
}

/**
 * INV-sp6-goldens-pending: evals/goldens-pending.json is well-formed (known suites + case ids, no duplicates).
 * Returns suite → Set of pending ids; on a malformed file it fails and returns an empty map, so every missing golden
 * fails too (fail closed).
 */
function loadSp6Pending() {
  const ids = new Map();
  for (const name of SP6_SUITES) {
    const dir = join(ROOT, 'evals', name);
    if (!existsSync(join(dir, 'assertions.json'))) continue;
    try { ids.set(name, new Set(loadSuite(dir).assertions.keys())); } catch { /* reported by checkSp6Suite */ }
  }
  try { return loadPending(join(ROOT, 'evals'), ids); } catch (e) { fail(`INV-sp6-goldens-pending: ${e.message}`); return new Map(); }
}

function checkSp6Suite(name, pending = new Set()) {
  const dir = join(ROOT, 'evals', name);
  if (!existsSync(join(dir, 'assertions.json'))) return null; // Phase A: no real suite yet
  const before = failCount;
  let suite;
  try { suite = loadSuite(dir); } catch (e) { fail(`INV-sp6 ${name}: cannot load suite: ${e.message}`); return null; }
  for (const e of validateJoin(suite.cases, suite.assertions)) fail(`INV-sp6 ${name}: ${e}`);

  const skillMd = join(SKILLS_DIR, name, 'SKILL.md');
  const closure = existsSync(skillMd) ? closureFiles(skillMd, SKILLS_DIR) : [];
  if (!closure.includes(resolve(skillMd))) fail(`INV-sp6-skill-hash-closure ${name}: closure missing SKILL.md`);
  const hash = closure.length ? skillHash(skillMd, SKILLS_DIR) : null;

  for (const id of suite.assertions.keys()) {
    const f = join(dir, 'transcripts', `${id}.json`);
    if (!existsSync(f)) {
      if (pending.has(id)) console.log(`PENDING: INV-sp6-transcripts-present ${name}: golden for case "${id}" not yet recorded (evals/${PENDING_FILE})`);
      else fail(`INV-sp6-transcripts-present ${name}: no golden for case "${id}" (record it, or list it in evals/${PENDING_FILE})`);
      continue;
    }
    // The list only shrinks: the regen job removes an id in the same commit that adds its golden.
    if (pending.has(id)) fail(`INV-sp6-goldens-pending ${name}: case "${id}" has a golden but is still listed in evals/${PENDING_FILE} — remove it`);
    try {
      const t = JSON.parse(readFileSync(f, 'utf8'));
      const v = validateTranscript(t);
      const kindErr = transcriptKindError(t, 'golden');
      if (!v.ok) fail(`INV-sp6-transcripts-present ${name}/${id}: ${v.errors.join('; ')}`);
      else if (kindErr) fail(`${kindErr} — ${name}/${id}`);
      else if (!hash || t.meta.skill_hash !== hash) {
        fail(`INV-sp6-transcripts-present ${name}/${id}: stale skill_hash (re-record)`);
      }
      const auditErr = v.ok && !kindErr ? goldenAuditError(t) : null;
      if (auditErr) fail(`${auditErr} — ${name}/${id}`);
    } catch { fail(`INV-sp6-transcripts-present ${name}/${id}: invalid JSON`); }
  }
  // Teeth: every case must carry >=1 adversarial transcript (<caseId>.*.json), same stem convention as run.mjs.
  const advDir = join(dir, 'transcripts', 'adversarial');
  const advFiles = existsSync(advDir) ? readdirSync(advDir).filter((f) => f.endsWith('.json')) : [];
  for (const id of suite.assertions.keys()) {
    if (!advFiles.some((f) => f.startsWith(`${id}.`))) fail(`INV-sp6-transcripts-present ${name}: case "${id}" has no adversarial transcript`);
  }
  // I2: every adversarial is a synthetic near-miss (a live capture filed under adversarial/ is refused).
  for (const f of advFiles) {
    let adv;
    try { adv = JSON.parse(readFileSync(join(advDir, f), 'utf8')); } catch { fail(`INV-sp6-transcript-kind ${name}/adversarial/${f}: invalid JSON`); continue; }
    const kindErr = transcriptKindError(adv, 'adversarial');
    if (kindErr) fail(`${kindErr} — ${name}/adversarial/${f}`);
  }
  if (failCount === before) pass(`INV-sp6 suite ${name}`);
  return suite;
}

function checkSp6Invariants() {
  const knownIds = new Set();
  let anySuite = false;
  const pending = loadSp6Pending();
  for (const name of SP6_SUITES) {
    const suite = checkSp6Suite(name, pending.get(name));
    if (!suite) continue;
    anySuite = true;
    for (const id of suite.assertions.keys()) knownIds.add(id);
  }
  // Only cross-check waiver case ids once real suites exist; the synthetic fixture is never scanned.
  checkSp6Waivers(anySuite ? knownIds : undefined);
  checkSp6PublishIsolation();
  checkSp6LiveWorkflow();
}

/**
 * INV-sp6-live-workflow: the opt-in live workflow keeps its safety properties (no pull_request_target, fork refusal in
 * a secret-free first job, per-PR concurrency, permissions {} + least privilege, environment only on the run job,
 * SHA-pinned actions, sandbox + audit required, label gate, no push to develop/main). Same checker as the runner test.
 * First layer: the workflow's sha256 must equal the committed pin evals/live-workflow.sha256 (CODEOWNERS covers both).
 */
function checkSp6LiveWorkflow() {
  const f = join(ROOT, '.github/workflows/evals-live.yml');
  if (!existsSync(f)) { fail('INV-sp6-live-workflow: .github/workflows/evals-live.yml missing'); return; }
  const raw = readFileSync(f); // m8: the pin covers the raw bytes, not a decoded string
  const pinFile = join(ROOT, 'evals/live-workflow.sha256');
  const pinErr = livePinError(raw, existsSync(pinFile) ? readFileSync(pinFile, 'utf8') : '');
  if (pinErr) fail(pinErr);
  const errs = liveWorkflowErrors(raw.toString('utf8'));
  for (const e of errs) fail(`INV-sp6-live-workflow: ${e}`);
  if (!pinErr && !errs.length) pass('INV-sp6-live-workflow (hash pin + rules)');
}
checkSp6Invariants();

if (failed) process.exit(1);
console.log('All skill validations passed.');
