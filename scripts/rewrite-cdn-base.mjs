#!/usr/bin/env node
/**
 * Publish-time rewrite: git source keeps SKILLS_BASE on GitHub raw so CI
 * validate-skills.mjs can forbid hardcoded CDN hosts. After copy into the
 * deploy staging dir, rewrite so hosted objects keep agents on CloudFront.
 *
 *   SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main
 *     → SKILLS_BASE = https://agents.sohopay.xyz/skills/v1
 *   {SKILLS_HOST} → https://agents.sohopay.xyz
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const GH_BASE = "https://raw.githubusercontent.com/sohopay/skills/main";
const CDN_BASE = "https://agents.sohopay.xyz/skills/v1";
const CDN_HOST = "https://agents.sohopay.xyz";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: rewrite-cdn-base.mjs <staging-dir>");
  process.exit(1);
}

let rewritten = 0;
for (const name of readdirSync(dir)) {
  if (!name.endsWith(".md") && name !== "llms-full.txt") continue;
  const path = join(dir, name);
  const before = readFileSync(path, "utf8");
  const after = before
    .replaceAll(`SKILLS_BASE = ${GH_BASE}`, `SKILLS_BASE = ${CDN_BASE}`)
    .replaceAll("{SKILLS_HOST}", CDN_HOST);
  if (after !== before) {
    writeFileSync(path, after);
    rewritten += 1;
  }
}

console.log(`Rewrote SKILLS_BASE / {SKILLS_HOST} in ${rewritten} file(s) under ${dir}`);
