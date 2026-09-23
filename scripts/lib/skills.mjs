/**
 * Shared catalog for registry skill directories under plugins/sohopay/skills/.
 * Hosted root *.md and index.json are generated from these folders.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '../..');
export const SKILLS_DIR = join(ROOT, 'plugins/sohopay/skills');
export const HOSTED_BASE = 'https://agents.sohopay.xyz';

/** Index / hosted generation order. sohopay-integrate is a registry shim only. */
export const HOSTED_SKILL_DIRS = [
  'sohopay-setup',
  'sohopay-setup-staging',
  'sohopay-mcp-connect',
  'sohopay-mcp-connect-staging',
  'sohopay-onboard',
  'sohopay-human-direct',
  'sohopay-spend',
  'sohopay-x402',
  'sohopay-authorize-agent',
  'sohopay-idempotency',
  'sohopay-agent-session',
];

export const HOSTED_HEADER = `<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1
     SKILLS_HOST (CDN origin): https://agents.sohopay.xyz
     Fetch order: local sticky → {SKILLS_BASE} → GitHub raw last-resort.
     Publish rewrites SKILLS_BASE to Prod and {SKILLS_HOST} to the origin. -->
<!-- Generated from plugins/sohopay/skills — do not hand-edit this file. Run npm run generate:hosted -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main
`;

function unquote(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Fold YAML `description: >` / `|` blocks into a single string. */
export function parseFrontmatterLoose(raw) {
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) {
    throw new Error('SKILL.md missing YAML frontmatter');
  }
  const end = raw.indexOf('\n---', 4);
  if (end === -1) throw new Error('SKILL.md frontmatter not closed');
  const yaml = raw.slice(4, end).replace(/\r/g, '');
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');
  const data = {};
  const lines = yaml.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const rest = m[2];
    if (key === 'metadata') {
      const meta = {};
      i++;
      while (i < lines.length && /^  /.test(lines[i])) {
        const n = lines[i].match(/^  ([a-zA-Z0-9_]+):\s*(.*)$/);
        if (n) meta[n[1]] = unquote(n[2]);
        i++;
      }
      i--;
      data.metadata = meta;
      continue;
    }
    if (rest === '>' || rest === '|') {
      const parts = [];
      i++;
      while (i < lines.length && (lines[i].startsWith('  ') || lines[i].trim() === '')) {
        parts.push(lines[i].replace(/^  /, ''));
        i++;
      }
      i--;
      data[key] = parts.join(' ').replace(/\s+/g, ' ').trim();
    } else {
      data[key] = unquote(rest);
    }
  }
  return { data, body };
}

export function loadSkill(dirName) {
  const dir = join(SKILLS_DIR, dirName);
  const skillPath = join(dir, 'SKILL.md');
  const raw = readFileSync(skillPath, 'utf8');
  const { data, body } = parseFrontmatterLoose(raw);
  const refsDir = join(dir, 'references');
  const references = [];
  if (existsSync(refsDir)) {
    for (const f of readdirSync(refsDir).filter((n) => n.endsWith('.md')).sort()) {
      references.push({
        name: f,
        content: readFileSync(join(refsDir, f), 'utf8'),
      });
    }
  }
  return { dirName, dir, data, body, references, raw };
}

export function loadHostedSkills() {
  return HOSTED_SKILL_DIRS.map(loadSkill);
}

export function listRegistrySkillDirs() {
  return readdirSync(SKILLS_DIR).filter((name) =>
    existsSync(join(SKILLS_DIR, name, 'SKILL.md')),
  );
}
