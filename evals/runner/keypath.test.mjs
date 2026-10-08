// TOCTOU: loadKeyFile must operate on the file it OPENS (O_RDONLY|O_NOFOLLOW + fstat + read-from-fd), not stat-then-
// read by path. Otherwise a symlink swapped in at the key path after validateKeyPath's checks is followed, and the
// signer loads a different file's contents. The permission check must be on the opened fd, not a re-stat of the path.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, symlinkSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadKeyFile } from "../mock/lib/keypath.mjs";

const ROOTS = [];
after(() => { for (const r of ROOTS) rmSync(r, { recursive: true, force: true }); });
const mkroot = () => { const r = mkdtempSync(join(tmpdir(), "kp-")); ROOTS.push(r); return r; };

test("loads a 0600 secret.json", () => {
  const root = mkroot();
  const p = join(root, "secret.json");
  writeFileSync(p, JSON.stringify({ borrower_id: "b" }), { mode: 0o600 });
  chmodSync(p, 0o600);
  assert.equal(loadKeyFile(p).borrower_id, "b");
});

test("refuses a symlink at the key path (TOCTOU: never follow it to another file)", () => {
  const root = mkroot();
  const real = join(root, "elsewhere.json");
  writeFileSync(real, JSON.stringify({ borrower_id: "victim" }), { mode: 0o600 });
  chmodSync(real, 0o600);
  const link = join(root, "secret.json");
  symlinkSync(real, link);
  assert.throws(() => loadKeyFile(link), (e) => e.code === "INSECURE_KEY_PERMISSIONS");
});

test("refuses a group/world-accessible file (fstat on the opened fd)", () => {
  const root = mkroot();
  const p = join(root, "secret.json");
  writeFileSync(p, JSON.stringify({ borrower_id: "b" }));
  chmodSync(p, 0o644);
  assert.throws(() => loadKeyFile(p), (e) => e.code === "INSECURE_KEY_PERMISSIONS");
});

test("non-JSON contents is STORED_KEY_CORRUPT", () => {
  const root = mkroot();
  const p = join(root, "secret.json");
  writeFileSync(p, "not json", { mode: 0o600 });
  chmodSync(p, 0o600);
  assert.throws(() => loadKeyFile(p), (e) => e.code === "STORED_KEY_CORRUPT");
});
