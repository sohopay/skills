import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { closureFiles, skillHash } from "./hashes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "__fixtures__/skilltree");

test("closure spans references and {SKILL:other}", () => {
  const files = closureFiles(join(root, "SKILL.md"), root).map((f) => f.replace(root + "/", ""));
  assert.deepEqual(files.sort(), ["SKILL.md", "other/SKILL.md", "references/a.md", "references/b.md"].sort());
});
test("hash changes when a closure file changes", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "sp6h-")); cpSync(root, tmp, { recursive: true });
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const h1 = skillHash(join(tmp, "SKILL.md"), tmp);
  writeFileSync(join(tmp, "references/b.md"), "changed");
  assert.notEqual(h1, skillHash(join(tmp, "SKILL.md"), tmp));
});
test("transitive references — b.md reachable only via a.md", () => {
  const files = closureFiles(join(root, "SKILL.md"), root).map((f) => f.replace(root + "/", ""));
  assert.ok(files.includes("references/b.md"), "b.md should be found transitively through a.md");
});
test("sibling-layout — skillb found via {SKILL:skillb}", () => {
  const siblingRoot = join(here, "__fixtures__/siblingtree");
  const skillaDir = join(siblingRoot, "skilla");
  const files = closureFiles(join(skillaDir, "SKILL.md"), skillaDir).map((f) => f.replace(skillaDir + "/", ""));
  assert.ok(files.includes("../skillb/SKILL.md") || files.some(f => f.endsWith("skillb/SKILL.md")), "skillb should be found via sibling resolver");
});
