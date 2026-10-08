// Lexical "could this text reference the workload key store?" over-approximation (INV-1).
// No fs I/O. Fires on the path SHAPE regardless of prefix (~, $HOME, abs, relative) and case
// (macOS FS is case-insensitive), on quote/backslash-split spellings, and on globs that could match.
import { posix } from "node:path";

const KEY_BASENAME = "secret.json";
/** secret.json, the key dir name, a token ending in `.agents`, or a glob directly under `.agents/`. */
const KEY_SHAPE_RE = /secret\.json|sohopay-agent-workload|\.agents\/?\*?(?=["'\s;|&)]|$)|\.agents\/[^\s\/]*\*/i;
// The key store chain, outermost first: ~/.agents → sohopay-agent-workload → secret.json.
const STORE = [".agents", "sohopay-agent-workload", KEY_BASENAME];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Remove the quoting a shell would remove: backslash-newline joins, quotes, backslashes, `$'…'` markers. */
function dequote(s) {
  return s.replace(/\\\n/g, "").replace(/\$(?=['"])/g, "").replace(/["'\\]/g, "");
}

/** One glob path segment → anchored case-insensitive regex (bracket expressions approximated as any char). */
function segmentRe(seg) {
  let re = "";
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else if (c === "[") { const j = seg.indexOf("]", i + 1); if (j < 0) re += "\\["; else { re += "."; i = j; } }
    else if (c === "{") {
      const j = seg.indexOf("}", i + 1);
      if (j > 0 && seg.slice(i + 1, j).includes(",")) { re += `(?:${seg.slice(i + 1, j).split(",").map(esc).join("|")})`; i = j; }
      else re += "\\{";
    } else re += esc(c);
  }
  return new RegExp(`^${re}$`, "i");
}

/** Could this (glob) token expand to the key, its dir, or `.agents`? Literal tokens are left to the shape check. */
function globMayHitKey(tok) {
  const s = dequote(tok);
  if (!/[*?[]|\{[^}]*,/.test(s)) return false;
  const abs = /^(?:\/|~|\$HOME|\$\{HOME\})/.test(s);
  const segs = s.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, "").split("/").filter((x) => x && x !== ".");
  if (segs.length === 0) return false;
  if (segs.includes("**")) return true; // recursive glob: may reach anything below its root
  for (let n = 1; n <= STORE.length; n++) {
    const cand = STORE.slice(0, n);
    // Absolute patterns must reach `.agents` themselves; relative ones may start anywhere inside the chain (unknown cwd).
    const m = abs ? n : Math.min(segs.length, n);
    if (segs.length < m) continue;
    const tail = segs.slice(segs.length - m);
    if (tail.every((p, j) => segmentRe(p).test(cand[n - m + j]))) return true;
  }
  return false;
}

/**
 * Build the per-transcript key-reference predicate. `extraForms` are literal spellings of the key path
 * (e.g. recorded resolved paths); `keyDir` is the key's parent dir.
 */
export function makeKeyMatcher(keyDir, keyDirTail) {
  return (s, extraForms = []) => {
    const l = s.toLowerCase();
    const flat = dequote(s);
    if (KEY_SHAPE_RE.test(s) || KEY_SHAPE_RE.test(flat)) return true;
    if (extraForms.some((f) => l.includes(f.toLowerCase()))) return true;
    if (l.includes(keyDir.toLowerCase()) || (keyDirTail && l.includes(keyDirTail.toLowerCase()))) return true;
    return s.split(/[\s;|&()<>`=]+/).some(globMayHitKey);
  };
}

/** A recorded resolved path that IS the key store: the key, anything under its dir, the dir, or `.agents`. */
export function hitsKeyStore(p, keyPath) {
  const n = posix.normalize(p).toLowerCase().replace(/\/+$/, "");
  if (/(?:^|\/)\.agents(?:\/sohopay-agent-workload(?:\/.*)?)?$/.test(n)) return true;
  if (keyPath.startsWith("~/")) return n.endsWith("/" + keyPath.slice(2).toLowerCase());
  const k = posix.normalize(keyPath).toLowerCase();
  const kd = posix.dirname(k);
  return n === k || n === kd || n.startsWith(kd + "/");
}

/**
 * Does the absolute path `p` reach the key store of the absolute `keyPath`: the key, its dir, anything below it, or any
 * ancestor of the dir (a recursive op from there reaches the key)? Case-insensitive, like hitsKeyStore. The live
 * adapter's worst-of resolution choice uses this (final review m4: one shared matcher, no private copy).
 */
export function reachesKeyStore(p, keyPath) {
  if (hitsKeyStore(p, keyPath)) return true;
  const n = posix.normalize(p).toLowerCase().replace(/\/+$/, "");
  return posix.dirname(posix.normalize(keyPath).toLowerCase()).startsWith(`${n}/`);
}
