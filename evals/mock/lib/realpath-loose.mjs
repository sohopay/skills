// realpath that also follows a dangling symlink to where it points and resolves a missing leaf through its parent.
// Shared by the live adapter's per-argument resolution and the signer host's policy. Uses realpathSync.native, which
// returns the ON-DISK case (and Unicode form) on case-insensitive APFS, so policy comparisons cannot be evaded by case.
import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** @param {string} p an absolute path */
export function resolveLoose(p, depth = 0) {
  try { return realpathSync.native(p); } catch { /* missing or dangling */ }
  if (depth > 40) return p;
  try {
    if (lstatSync(p).isSymbolicLink()) return resolveLoose(resolve(dirname(p), readlinkSync(p)), depth + 1);
  } catch { /* does not exist */ }
  const parent = dirname(p);
  if (parent === p) return p;
  return join(resolveLoose(parent, depth + 1), p.slice(parent.length + (parent.endsWith("/") ? 0 : 1)));
}
