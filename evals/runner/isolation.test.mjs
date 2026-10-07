import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { validateWaivers } from "./waivers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// Static `import x from "y"`, `import "y"`, `export ... from "y"`; dynamic `import("y")` is deliberately not matched.
const STATIC_RE = /(?:^|[\n;])\s*(?:import\s+(?:[^"';]*?\s+from\s+)?|export\s+[^"';]*?\s+from\s+)["']([^"']+)["']/g;

/** BFS over static relative imports; returns Map(file -> importer) for edge reporting. */
export function staticGraph(entry) {
  const seen = new Map([[entry, null]]);
  const queue = [entry];
  while (queue.length) {
    const f = queue.shift();
    if (!existsSync(f)) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(STATIC_RE)) {
      const spec = m[1];
      if (!spec.startsWith(".")) continue;
      const target = resolve(dirname(f), spec);
      if (!seen.has(target)) { seen.set(target, f); queue.push(target); }
    }
  }
  return seen;
}

test("INV-sp6-import-isolation: run.mjs never statically reaches the live adapter or judge", () => {
  const graph = staticGraph(resolve(HERE, "run.mjs"));
  assert.ok(graph.size > 3, "graph walk found the runner modules");
  for (const [file, importer] of graph) {
    const rel = relative(HERE, file);
    assert.ok(
      rel !== "adapters/claude-code.mjs" && rel !== "judge.mjs",
      `forbidden static edge: ${importer && relative(HERE, importer)} -> ${rel}`,
    );
  }
});

test("import scanner ignores dynamic import and catches a static one", () => {
  const graph = staticGraph(resolve(HERE, "run.mjs"));
  assert.ok(graph.has(resolve(HERE, "adapters/replay.mjs")), "static replay import is followed");
  assert.ok(!graph.has(resolve(HERE, "adapters/claude-code.mjs")), "dynamic claude-code import is not followed");
});

test("INV-sp6-floor-waivers: committed file is valid", () => {
  const doc = JSON.parse(readFileSync(resolve(HERE, "..", "floor-waivers.json"), "utf8"));
  assert.deepEqual(validateWaivers(doc), []);
});

test("INV-sp6-floor-waivers: never_appears / private_key / header_value waivers hard-fail", () => {
  for (const check of ["never_appears", "private_key", "header_value"]) {
    const errs = validateWaivers({ waivers: [{ case_id: "c1", check, reason: "because" }] });
    assert.equal(errs.length, 1, check);
    assert.match(errs[0], /can never be waived/);
  }
});

test("floor waivers: allowed checks pass; missing reason / unknown case rejected", () => {
  assert.deepEqual(validateWaivers({ waivers: [{ case_id: "c1", check: "secret_read", reason: "ok" }] }, new Set(["c1"])), []);
  assert.equal(validateWaivers({ waivers: [{ case_id: "c1", check: "secret_read", reason: " " }] }).length, 1);
  assert.equal(validateWaivers({ waivers: [{ case_id: "zz", check: "secret_read", reason: "ok" }] }, new Set(["c1"])).length, 1);
  assert.equal(validateWaivers({}).length, 1);
});
