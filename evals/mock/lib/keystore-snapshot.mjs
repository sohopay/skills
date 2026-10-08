// lstat snapshots of a small directory tree (the agent HOME's ~/.agents key store), used to observe every change to
// it without root: the signer host records the changes IT made (sanctioned key writes, excluded from the audit),
// and the live adapter diffs the tree around each tool call to catch any other write, link or rename — including
// one a background process from an earlier call makes later (the TOCTOU plant).
import { lstatSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";

const MAX_ENTRIES = 10_000;

function kindOf(st) {
  if (st.isSymbolicLink()) return "symlink";
  if (st.isDirectory()) return "dir";
  if (st.isFile()) return "file";
  return "other";
}

/** One entry's observable state as a stable string (type, mode, size, mtime ns, inode, nlink, link target). */
export function entryState(path) {
  let st;
  try { st = lstatSync(path, { bigint: true }); } catch { return null; }
  const kind = kindOf(st);
  let target = "";
  if (kind === "symlink") { try { target = readlinkSync(path); } catch { target = "?"; } }
  return [kind, (st.mode & 0o7777n).toString(8), st.size, st.mtimeNs, st.ino, st.nlink, target].join("|");
}

/** Map(absolute path -> state) for `root` and everything below it (symlinks are recorded, never followed). */
export function snapshotTree(root) {
  const out = new Map();
  const walk = (p) => {
    if (out.size >= MAX_ENTRIES) return;
    const s = entryState(p);
    if (s === null) return;
    out.set(p, s);
    if (!s.startsWith("dir|")) return;
    let names = [];
    try { names = readdirSync(p); } catch { return; }
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
