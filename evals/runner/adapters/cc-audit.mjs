// file_open_audit for the live adapter: process-tree file auditing where the platform allows it WITHOUT root.
//
//   linux  → `strace -f -ttt` around the claude process tree (ptrace of one's own children; no root). Parsed
//            here into {path, op, at} for every syscall that names a path under the agent's ~/.agents store, plus
//            the TARGET of every symlink / link / rename (item 9). Hook processes are excluded by their execve
//            argv; the signer never runs in this tree (it is hosted out of process), so its sanctioned key reads
//            and writes cannot appear (item 8).
//   darwin → unavailable: fs_usage and dtrace need root (and dtrace SIP off). No events are emitted — never fake
//            ones; meta.audit records "unavailable" and why. The cross-platform key-store lstat audit (file_op
//            events, cc-assemble.mjs) still runs everywhere.
import { spawnSync } from "node:child_process";
import { posix } from "node:path";

const STRACE_SYSCALLS = [
  "open", "openat", "openat2", "creat", "stat", "lstat", "newfstatat", "statx", "access", "faccessat", "faccessat2",
  "readlink", "readlinkat", "unlink", "unlinkat", "rename", "renameat", "renameat2", "link", "linkat", "symlink", "symlinkat",
  "chmod", "fchmodat", "chown", "lchown", "fchownat", "mkdir", "mkdirat", "rmdir", "truncate", "utimensat", "utimes",
  "setxattr", "lsetxattr", "removexattr", "lremovexattr", "execve", "chdir", "clone", "clone3", "fork", "vfork",
];

/** Which audit backend this host supports; never throws. */
export function probeAudit(platform = process.platform, run = spawnSync) {
  if (process.env.SP6_AUDIT === "off") return { audit: "disabled", reason: "SP6_AUDIT=off" };
  if (platform === "linux") {
    const v = run("strace", ["-V"], { encoding: "utf8" });
    if (v.status !== 0) return { audit: "unavailable", reason: "strace not installed" };
    const t = run("strace", ["-f", "-o", "/dev/null", "/bin/true"], { encoding: "utf8" });
    if (t.status !== 0) return { audit: "unavailable", reason: `strace cannot trace children (ptrace denied): ${String(t.stderr).trim().slice(0, 200)}` };
    return { audit: "strace", reason: null };
  }
  if (platform === "darwin") return { audit: "unavailable", reason: "macOS process-tree file auditing (fs_usage / dtrace) needs root; not used" };
  return { audit: "unavailable", reason: `no audit backend for ${platform}` };
}

/** argv prefix that wraps the CLI in strace (linux only). */
export function straceArgv(outFile) {
  return ["strace", "-f", "-ttt", "-qq", "-y", "-s", "4096", "-o", outFile, "-e", `trace=${STRACE_SYSCALLS.join(",")}`, "--"];
}

const LINE_RE = /^(\d+)\s+(\d+\.\d+)\s+(\w+)\((.*)\)\s+=\s+(-?\d+|\?)/;
const RESUMED_RE = /^(\d+)\s+(\d+\.\d+)\s+<\.\.\.\s+(\w+)\s+resumed>(.*)\)\s+=\s+(-?\d+|\?)/;
/** Split a syscall's argument text at top-level commas (strings, [], {} kept whole). */
function splitArgs(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === "\\" ? 2 : 1;
      cur += s.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === "[" || c === "{" || c === "(") depth++;
    else if (c === "]" || c === "}" || c === ")") depth--;
    if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}
const unesc = (s) => s.replace(/\\(x[0-9a-f]{2}|[0-7]{1,3}|.)/gi, (_, c) => (c[0] === "x" ? String.fromCharCode(parseInt(c.slice(1), 16)) : /^[0-7]+$/.test(c) ? String.fromCharCode(parseInt(c, 8)) : c === "n" ? "\n" : c === "t" ? "\t" : c));

function opOf(sys, args) {
  if (/^(open|openat|openat2)$/.test(sys)) return /O_(WRONLY|RDWR|CREAT|TRUNC|APPEND)/.test(args) ? "write" : "open";
  if (sys === "creat") return "write";
  if (/stat|^readlink/.test(sys)) return "stat";
  if (/access/.test(sys)) return "access";
  if (/^unlink/.test(sys)) return "unlink";
  if (/^rename/.test(sys)) return "rename";
  if (/^symlink/.test(sys)) return "symlink";
  if (/^link/.test(sys)) return "link";
  if (/chmod/.test(sys)) return "chmod";
  if (/chown/.test(sys)) return "chown";
  if (/^mkdir/.test(sys)) return "mkdir";
  if (sys === "rmdir") return "rmdir";
  if (sys === "truncate") return "truncate";
  if (/utime/.test(sys)) return "utime";
  if (/xattr/.test(sys)) return "setxattr";
  if (sys === "execve") return "exec";
  return sys;
}

/**
 * Parse strace -f -ttt -y output into audit events under `storeRoot` (the agent's ~/.agents). Relative paths are
 * resolved against `-y` dirfd annotations or the pid's tracked cwd (inherited at clone, moved by chdir).
 * @param {string} text  strace output
 * @param {{storeRoot:string, cwd:string, excludeArgv:RegExp}} o  excludeArgv: execve argv of processes to drop
 *   (with their descendants) — the hook relays.
 */
export function parseStrace(text, { storeRoot, cwd, excludeArgv }) {
  const cwdOf = new Map();
  const excluded = new Set();
  const pending = new Map();
  const events = [];
  const under = (p) => p === storeRoot || p.startsWith(storeRoot + "/");
  for (const raw of text.split("\n")) {
    let m = LINE_RE.exec(raw);
    let resumed = false;
    if (!m && (m = RESUMED_RE.exec(raw))) resumed = true;
    if (!m) {
      const u = /^(\d+)\s+(\d+\.\d+)\s+(\w+)\((.*)<unfinished \.\.\.>/.exec(raw);
      if (u) pending.set(`${u[1]}:${u[3]}`, u[4]);
      continue;
    }
    const [, pidS, tS, sys, rest, ret] = m;
    const pid = Number(pidS);
    const args = resumed ? (pending.get(`${pid}:${sys}`) ?? "") + rest : rest;
    const here = cwdOf.get(pid) ?? cwd;
    if (/^(clone|clone3|fork|vfork)$/.test(sys) && /^\d+$/.test(ret)) {
      const child = Number(ret);
      cwdOf.set(child, here);
      if (excluded.has(pid)) excluded.add(child);
      continue;
    }
    if (excluded.has(pid)) continue;
    if (sys === "execve" && excludeArgv && excludeArgv.test(args)) { excluded.add(pid); continue; }
    // Positional args: a path string is relative to the dirfd argument right before it (`-y` prints N</dir>),
    // else to the pid's cwd. A symlink TARGET (first string of symlink/symlinkat) is relative to the link's dir.
    const parts = splitArgs(args);
    const refs = [];
    parts.forEach((a, k) => {
      const s = /^"((?:[^"\\]|\\.)*)"/.exec(a);
      if (!s) return;
      const prev = parts[k - 1] ?? "";
      const fd = /^\d+<([^>]*)>$/.exec(prev);
      refs.push({ value: unesc(s[1]), base: fd ? fd[1] : here });
    });
    const abs = (r) => (r.value.startsWith("/") ? posix.normalize(r.value) : posix.join(r.base, r.value));
    if (sys === "chdir") { if (ret === "0" && refs[0]) cwdOf.set(pid, abs(refs[0])); continue; }
    const op = opOf(sys, args);
    const at = Math.round(Number(tS) * 1000);
    const paths = refs.filter((r) => r.value !== "").map(abs);
    if (op === "symlink" && refs.length >= 2 && !refs[0].value.startsWith("/")) paths[0] = posix.join(posix.dirname(abs(refs[1])), refs[0].value);
    for (const p of paths) if (under(p)) events.push({ path: p, op, at, pid, ret: ret === "?" ? null : Number(ret) });
  }
  return events;
}
