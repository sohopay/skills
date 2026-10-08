// lstat snapshots of a small directory tree (the agent HOME's ~/.agents key store), used to observe every change to
// it without root: the signer host records the changes IT made (sanctioned key writes, excluded from the audit),
// and the live adapter diffs the tree around each tool call to catch any other write, link or rename — including
// one a background process from an earlier call makes later (the TOCTOU plant).
import { lstatSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";

export const MAX_ENTRIES = 10_000;

function kindOf(st) {
  if (st.isSymbolicLink()) return "symlink";
  if (st.isDirectory()) return "dir";
  if (st.isFile()) return "file";
  return "other";
}

/** One entry's observable state as a stable string (type, mode, size, mtime ns, inode, nlink, link target). */
export function entryState(path) {
  let st;
  // ENOENT = the path vanished (a benign race, e.g. a file deleted between readdir and lstat) → treated as absent by
  // the diff. Any OTHER error (EACCES, EIO, …) must SURFACE: swallowing it would silently drop a store entry we could
  // not observe, and a write/link under it would then go undetected (fail-open).
  try { st = lstatSync(path, { bigint: true }); } catch (e) { if (e && e.code === "ENOENT") return null; throw e; }
  const kind = kindOf(st);
  let target = "";
  if (kind === "symlink") { try { target = readlinkSync(path); } catch { target = "?"; } }
  return [kind, (st.mode & 0o7777n).toString(8), st.size, st.mtimeNs, st.ino, st.nlink, target].join("|");
}

/**
 * Map(absolute path -> state) for `root` and everything below it (symlinks are recorded, never followed).
 * Fail-closed: exceeding `maxEntries` THROWS rather than silently truncating (a store large enough to blow the cap is
 * itself anomalous, and a change beyond the cap would be invisible), and a non-ENOENT readdir error SURFACES rather
 * than dropping the subtree. The caller (cc-relay) already turns a snapshot exception into a fail-closed capture error.
 */
export function snapshotTree(root, { maxEntries = MAX_ENTRIES } = {}) {
  const out = new Map();
  const walk = (p) => {
    if (out.size >= maxEntries) throw new Error(`keystore snapshot exceeded ${maxEntries} entries under ${root}: refusing to silently truncate (a change beyond the cap would be missed)`);
    const s = entryState(p);
    if (s === null) return; // vanished (ENOENT) — benign
    out.set(p, s);
    if (!s.startsWith("dir|")) return;
    let names;
    try { names = readdirSync(p); }
    catch (e) { if (e && e.code === "ENOENT") return; throw e; } // dir vanished = benign; EACCES/EIO/… surfaces
    for (const n of names.sort()) walk(join(p, n));
  };
  walk(root);
  return out;
}

/** Changes between two snapshots: [{path, before, after, change}] with change ∈ create | delete | modify. */
export function diffSnapshots(a, b) {
  const changes = [];
  for (const [p, s] of b) {
    if (!a.has(p)) changes.push({ path: p, before: null, after: s, change: "create" });
    else if (a.get(p) !== s) changes.push({ path: p, before: a.get(p), after: s, change: "modify" });
  }
  for (const [p, s] of a) if (!b.has(p)) changes.push({ path: p, before: s, after: null, change: "delete" });
  return changes.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}
