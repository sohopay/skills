import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdtempSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { closureFiles, skillHash } from "./hashes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "__fixtures__/skilltree");

test("closure spans references and {SKILL:other}", () => {
  const files = closureFiles(join(root, "SKILL.md"), root).map((f) => f.replace(root + "/", ""));
  assert.deepEqual(files.sort(), ["SKILL.md", "other/SKILL.md", "references/a.md", "references/b.md"].sort());
});
test("hash changes when a closure file changes", () => {
  const tmp = mkdtempSync(join(tmpdir(), "sp6h-")); cpSync(root, tmp, { recursive: true });
  const h1 = skillHash(join(tmp, "SKILL.md"), tmp);
  writeFileSync(join(tmp, "references/b.md"), "changed");
  assert.notEqual(h1, skillHash(join(tmp, "SKILL.md"), tmp));
});
