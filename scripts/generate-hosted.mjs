/**
 * Emit root hosted *.md + .well-known/agent-skills/index.json from registry skill dirs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  HOSTED_BASE,
  HOSTED_HEADER,
  loadHostedSkills,
  ROOT,
} from './lib/skills.mjs';

function skillMap(skills) {
  const byDir = new Map();
  for (const s of skills) byDir.set(s.dirName, s.data.metadata?.hosted_name);
  return byDir;
}

function rewriteBody(body, byDir) {
  let out = body.replace(/\{SKILL:([a-z0-9-]+)\}/g, (_, name) => {
    const hosted = byDir.get(name);
    if (!hosted) {
      throw new Error(`Unknown {SKILL:${name}} — add metadata.hosted_name or drop the token`);
    }
    return `{SKILLS_BASE}/${hosted}.md`;
  });
  out = out.replace(/\]\(references\/([^)]+)\)/g, (_m, file) => {
    const slug = file.replace(/\.md$/, '');
    return `](#hosted-reference-${slug})`;
  });
  return out;
}

function hostedMarkdown(skill, byDir) {
  const title = skill.data.metadata?.title || skill.data.name;
  const parts = [
    HOSTED_HEADER,
    `\n# Skill: ${title}\n`,
    '\n**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.\n',
    rewriteBody(skill.body, byDir),
  ];
  if (skill.references.length) {
    parts.push('\n---\n\n## Hosted references (load only when the skill says to)\n');
    parts.push(
      '\nNative Agent Skills read these from `references/` on demand. This hosted export inlines them so `curl -fsSL` bootstrap still works.\n',
    );
    for (const ref of skill.references) {
      const slug = ref.name.replace(/\.md$/, '');
      parts.push(`\n<a id="hosted-reference-${slug}"></a>\n\n`);
      parts.push(`### Hosted reference: ${ref.name}\n\n`);
      parts.push(rewriteBody(ref.content, byDir));
      parts.push('\n');
    }
  }
  return parts.join('');
}

function buildIndex(skills) {
  return {
    version: '1.0',
    name: 'SohoPay Agent Skills',
    description:
      'Skill index for AI agents integrating with the SohoPay MCP gateway, merchant-as-settler x402, and credit settlement.',
    dev_base: 'https://raw.githubusercontent.com/sohopay/skills/main',
    skills: skills.map((s) => {
      const hosted = s.data.metadata?.hosted_name;
      if (!hosted) throw new Error(`${s.dirName} missing metadata.hosted_name`);
      return {
        name: hosted,
        title: s.data.metadata?.title || s.data.name,
        description: s.data.description,
        url: `${HOSTED_BASE}/skills/v1/${hosted}.md`,
      };
    }),
    fullContext: `${HOSTED_BASE}/skills/v1/llms-full.txt`,
    mcpServer: 'https://mcp.sohopay.xyz',
    mcpServerStaging: 'https://staging.mcp.sohopay.xyz/mcp',
    openApi: 'https://api.sohopay.xyz/api/docs',
  };
}

const skills = loadHostedSkills();
const byDir = skillMap(skills);

for (const skill of skills) {
  const hosted = skill.data.metadata?.hosted_name;
  if (!hosted) throw new Error(`${skill.dirName} missing metadata.hosted_name`);
  const dest = join(ROOT, `${hosted}.md`);
  writeFileSync(dest, hostedMarkdown(skill, byDir), 'utf8');
  console.log(`Wrote ${hosted}.md`);
}

const index = buildIndex(skills);
const indexPath = join(ROOT, '.well-known/agent-skills/index.json');
mkdirSync(dirname(indexPath), { recursive: true });
writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
console.log('Wrote .well-known/agent-skills/index.json');
