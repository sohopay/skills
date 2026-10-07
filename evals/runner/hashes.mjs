import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve, relative } from "node:path";

const REF_RE = /references\/[A-Za-z0-9._-]+\.md/g;
const SKILL_RE = /\{SKILL:([a-z0-9-]+)\}/g;

export function closureFiles(skillMdPath, rootDir) {
  const seen = new Set();
  const queue = [resolve(skillMdPath)];
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f);
    const txt = readFileSync(f, "utf8");
    for (const m of txt.match(REF_RE) || []) { const p = resolve(dirname(f), m); if (existsSync(p)) queue.push(p); }
    for (const m of [...txt.matchAll(SKILL_RE)]) {
      for (const cand of [resolve(rootDir, m[1], "SKILL.md"), resolve(rootDir, "..", m[1], "SKILL.md"), resolve(dirname(rootDir), m[1], "SKILL.md")])
        if (existsSync(cand)) queue.push(cand);
    }
  }
  return [...seen].sort();
}

export function skillHash(skillMdPath, rootDir) {
  const h = createHash("sha256");
  for (const f of closureFiles(skillMdPath, rootDir)) { h.update(relative(rootDir, f)); h.update("\0"); h.update(readFileSync(f)); h.update("\0"); }
  return h.digest("hex");
}

export function graderHash(runnerDir) {
  const h = createHash("sha256");
  for (const f of ["schema.mjs", "predicates.mjs"]) { h.update(readFileSync(join(runnerDir, f))); h.update("\0"); }
  return h.digest("hex");
}
