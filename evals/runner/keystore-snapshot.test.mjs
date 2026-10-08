// keystore-snapshot must NOT silently drop: the live adapter diffs this tree to catch any write/link/rename to the
// key store, so a silently-truncated snapshot (entry cap) or a silently-dropped unreadable subtree is a fail-open
// (a change in the dropped region is missed). The cap and non-ENOENT readdir/lstat errors must surface, not drop.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotTree, diffSnapshots } from "../mock/lib/keystore-snapshot.mjs";

const ROOTS = [];
after(() => { for (const r of ROOTS) { try { chmodSync(r, 0o755); } catch {} rmSync(r, { recursive: true, force: true }); } });
const mkroot = () => { const r = mkdtempSync(join(tmpdir(), "ks-")); ROOTS.push(r); return r; };

test("snapshots a small tree and diffs a new file as a create", () => {
  const root = mkroot();
  writeFileSync(join(root, "a"), "1");
  const s1 = snapshotTree(root);
  writeFileSync(join(root, "b"), "2");
  assert.ok(diffSnapshots(s1, snapshotTree(root)).some((c) => c.path.endsWith("/b") && c.change === "create"));
});

test("a missing root yields an empty snapshot (store not yet created), not a throw", () => {
  assert.equal(snapshotTree(join(mkroot(), "nope")).size, 0);
});

test("exceeding the entry cap throws instead of silently truncating (fail-closed)", () => {
  const root = mkroot();
  for (let i = 0; i < 5; i++) writeFileSync(join(root, `f${i}`), "x");
  assert.throws(() => snapshotTree(root, { maxEntries: 3 }), /exceed|cap|truncat/i);
});

test("an unreadable directory surfaces (throws) rather than silently dropping the subtree", () => {
  if (process.getuid && process.getuid() === 0) return; // root bypasses permission bits
  const root = mkroot();
  const sub = join(root, "locked");
  mkdirSync(sub);
  writeFileSync(join(sub, "secret"), "x");
  chmodSync(sub, 0o000);
  let threw = false;
  try { snapshotTree(root); } catch { threw = true; }
  chmodSync(sub, 0o755);
  assert.ok(threw, "readdir EACCES on a subdir must surface, not drop it");
});
