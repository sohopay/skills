// file_open_audit for the live adapter: process-tree file auditing where the platform allows it WITHOUT root.
//
//   linux  → `strace -f -ttt -qq -y` around the claude process. Only process subtrees SPAWNED WHILE A TOOL CALL IS IN
//            FLIGHT are agent activity (attributed to that call); the CLI's own process and threads (startup,
//            config/skill discovery, in-process tools), anything it spawns outside a tool window, and the hook
//            relays (recognised by their execve argv) are not. Lines of a pid seen before its parent's clone
//            returns are buffered until the parentage (and so the inherited cwd) is known. The signer never runs in
//            this tree (it is hosted out of process), so its sanctioned key opens cannot appear (item 8).
//   darwin → unavailable: fs_usage and dtrace need root (and dtrace SIP off). No events are emitted, never fake ones.
//            The cross-platform key-store lstat audit and the signer host's open log still run everywhere.
import { spawnSync } from "node:child_process";
import { posix } from "node:path";

// *at / fd forms exist on every Linux arch; `?name` = optional (strace or the kernel may not know it).
const COMMON = [
  "openat", "?openat2", "newfstatat", "statx", "faccessat", "?faccessat2", "readlinkat", "unlinkat", "renameat", "renameat2",
  "linkat", "symlinkat", "fchmodat", "?fchmodat2", "fchownat", "mkdirat", "mknodat", "utimensat", "truncate", "ftruncate",
  "fchmod", "fchown", "setxattr", "lsetxattr", "fsetxattr", "removexattr", "lremovexattr", "fremovexattr",
  "execve", "execveat", "chdir", "fchdir", "clone", "?clone3",
];
// Legacy path syscalls that only x86-64 still has (aarch64 never did).
const X64_ONLY = ["open", "creat", "stat", "lstat", "access", "readlink", "unlink", "rename", "link", "symlink", "chmod", "chown", "lchown", "mkdir", "rmdir", "mknod", "utimes", "fork", "vfork"];

/** The traced syscall set for a Node `process.arch`. */
export function syscallSet(arch = process.arch) {
  return arch === "x64" ? [...COMMON, ...X64_ONLY] : [...COMMON];
}

/** argv prefix that wraps the CLI in strace; the probe runs the same `-e` set. */
export function straceArgv(outFile, { arch = process.arch, killOnExit = false } = {}) {
  return ["strace", "-f", "-ttt", "-qq", "-y", "-s", "4096", ...(killOnExit ? ["--kill-on-exit"] : []), "-o", outFile, "-e", `trace=${syscallSet(arch).join(",")}`, "--"];
}

/**
 * Which audit backend this host supports; never throws. On linux a trial run uses the EXACT syscall set of the real
 * run, so a name the kernel / strace rejects makes the audit unavailable up front instead of failing a sample.
 * @returns {{audit: "available"|"unavailable", backend: "strace"|null, reason: string|null, killOnExit: boolean}}
 */
export function probeAudit({ platform = process.platform, arch = process.arch, run = spawnSync } = {}) {
  const no = (reason) => ({ audit: "unavailable", backend: null, reason, killOnExit: false });
  if (process.env.SP6_AUDIT === "off") return no("disabled by SP6_AUDIT=off");
  if (platform === "darwin") return no("macOS process-tree file auditing (fs_usage / dtrace) needs root; not used");
  if (platform !== "linux") return no(`no audit backend for ${platform}`);
  const v = run("strace", ["-V"], { encoding: "utf8" });
  if (v.status !== 0) return no("strace not installed");
  const trial = (k) => run("strace", straceArgv("/dev/null", { arch, killOnExit: k }).slice(1).concat("/bin/true"), { encoding: "utf8" });
  let killOnExit = true;
  let t = trial(true);
  if (t.status !== 0) { killOnExit = false; t = trial(false); }
  if (t.status !== 0) return no(`strace trial with the run's syscall set failed: ${String(t.stderr ?? "").trim().slice(0, 200)}`);
  return { audit: "available", backend: "strace", reason: null, killOnExit };
}

const LINE_RE = /^(\d+)\s+(\d+\.\d+)\s+(\w+)\((.*)\)\s+=\s+(-?\d+|\?)/;
const RESUMED_RE = /^(\d+)\s+(\d+\.\d+)\s+<\.\.\.\s+(\w+)\s+resumed>(.*)\)\s+=\s+(-?\d+|\?)/;
const UNFINISHED_RE = /^(\d+)\s+(\d+\.\d+)\s+(\w+)\((.*)<unfinished \.\.\.>/;
const unesc = (s) => s.replace(/\\(x[0-9a-f]{2}|[0-7]{1,3}|.)/gi, (_, c) => (c[0] === "x" ? String.fromCharCode(parseInt(c.slice(1), 16)) : /^[0-7]+$/.test(c) ? String.fromCharCode(parseInt(c, 8)) : c === "n" ? "\n" : c === "t" ? "\t" : c));
const CLONE_RE = /^(clone|clone3|fork|vfork)$/;
const FD_OPS = new Set(["fchmod", "fchown", "ftruncate", "fsetxattr", "fremovexattr"]);
const FD_ARG_RE = /^\d+<([^>]*)>$/;
const STR_ARG_RE = /^"((?:[^"\\]|\\.)*)"/;

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

function opOf(sys, args) {
  if (/^(open|openat|openat2)$/.test(sys)) return /O_(WRONLY|RDWR|CREAT|TRUNC|APPEND)/.test(args) ? "write" : "open";
  if (sys === "creat" || /^mknod/.test(sys)) return "create";
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
  if (/truncate/.test(sys)) return "truncate";
  if (/utime/.test(sys)) return "utime";
  if (/xattr/.test(sys)) return "setxattr";
  if (/^execve/.test(sys)) return "exec";
  return sys;
}

/** strace text → ordered records {pid, at, sys, args, ret}; an unfinished call is completed by its resumed line. */
function records(text) {
  const pending = new Map();
  const out = [];
  for (const raw of text.split("\n")) {
    const u = UNFINISHED_RE.exec(raw);
    if (u) { pending.set(`${u[1]}:${u[3]}`, { at: Math.round(Number(u[2]) * 1000), args: u[4] }); continue; }
    const r = RESUMED_RE.exec(raw);
    if (r) {
      const key = `${r[1]}:${r[3]}`;
      const p = pending.get(key);
      pending.delete(key);
      out.push({ pid: Number(r[1]), at: p?.at ?? Math.round(Number(r[2]) * 1000), sys: r[3], args: (p?.args ?? "") + r[4], ret: r[5] });
      continue;
    }
    const m = LINE_RE.exec(raw);
    if (m) out.push({ pid: Number(m[1]), at: Math.round(Number(m[2]) * 1000), sys: m[3], args: m[4], ret: m[5] });
  }
  return out;
}

/** Absolute paths a syscall names: fd-annotated targets of fd ops, and strings relative to a preceding dirfd. */
function pathsOf(sys, parts, cwd, op) {
  const out = [];
  if (FD_OPS.has(sys)) { const fd = FD_ARG_RE.exec(parts[0] ?? ""); if (fd) out.push(fd[1]); }
  const refs = [];
  parts.forEach((a, k) => {
    const s = STR_ARG_RE.exec(a);
    if (!s) return;
    const fd = FD_ARG_RE.exec(parts[k - 1] ?? "");
    refs.push({ value: unesc(s[1]), base: fd ? fd[1] : cwd });
  });
  const abs = (r) => (r.value.startsWith("/") ? posix.normalize(r.value) : posix.join(r.base, r.value));
  // execve / *xattr: only the first string is a path (argv, attribute names and values are data); fd ops name none.
  const used = FD_OPS.has(sys) ? [] : /^execve|xattr/.test(sys) ? refs.slice(0, 1) : refs.filter((r) => r.value !== "");
  const paths = used.map(abs);
  // symlink(target, link): a relative TARGET is relative to the link's directory, not the cwd.
  if (op === "symlink" && refs.length >= 2 && !refs[0].value.startsWith("/")) paths[0] = posix.join(posix.dirname(abs(refs[1])), refs[0].value);
  return [...out, ...paths];
}

/**
 * Parse strace output into audit events under `storeRoot`: [{path, op, at, pid, ret, callId}].
 * @param {string} text
 * @param {{storeRoot:string, cwd:string, excludeArgv:RegExp|null, windows:{id:string, start:number, end:number}[]}} o
 *   windows: tool-call windows (Pre → Post hook times); a process the CLI spawns inside one belongs to that call.
 */
export function parseStrace(text, { storeRoot, cwd, excludeArgv, windows = [] }) {
  const recs = records(text);
  const procs = new Map(); // pid → {kind: "cli"|"tool"|"excluded"|"orphan", callId, cwd}
  const buffered = new Map(); // pid → its records seen before its parent's clone returned
  const events = [];
  const under = (p) => p === storeRoot || p.startsWith(storeRoot + "/");
  const windowAt = (t) => windows.find((w) => t >= w.start && t <= w.end) ?? null;
  if (recs.length) procs.set(recs[0].pid, { kind: "cli", callId: null, cwd });

  const handle = (rec, info) => {
    const { pid, sys, args, ret, at } = rec;
    if (CLONE_RE.test(sys)) {
      if (!/^\d+$/.test(ret)) return;
      const child = Number(ret);
      const fresh = { kind: info.kind, callId: info.callId, cwd: info.cwd };
      if (info.kind === "cli" && !/CLONE_THREAD/.test(args)) {
        const w = windowAt(at);
        fresh.kind = w ? "tool" : "excluded";
        fresh.callId = w ? w.id : null;
      }
      procs.set(child, fresh);
      for (const b of buffered.get(child) ?? []) handle(b, fresh);
      buffered.delete(child);
      return;
    }
    const parts = splitArgs(args);
    if (/^execve/.test(sys) && excludeArgv && excludeArgv.test(args)) { info.kind = "excluded"; return; }
    if (sys === "chdir" || sys === "fchdir") {
      if (ret !== "0") return;
      const s = sys === "chdir" ? STR_ARG_RE.exec(parts[0] ?? "") : null;
      const fd = sys === "fchdir" ? FD_ARG_RE.exec(parts[0] ?? "") : null;
      if (s) info.cwd = unesc(s[1]).startsWith("/") ? posix.normalize(unesc(s[1])) : posix.join(info.cwd, unesc(s[1]));
      if (fd) info.cwd = fd[1];
      return;
    }
    if (info.kind !== "tool" && info.kind !== "orphan") return;
    const op = opOf(sys, args);
    for (const p of pathsOf(sys, parts, info.cwd, op)) {
      if (under(p)) events.push({ path: p, op, at, pid, ret: ret === "?" ? null : Number(ret), callId: info.callId ?? null });
    }
  };

  for (const rec of recs) {
    const info = procs.get(rec.pid);
    if (info) { handle(rec, info); continue; }
    if (!buffered.has(rec.pid)) buffered.set(rec.pid, []);
    buffered.get(rec.pid).push(rec);
  }
  // Parentage never seen (a lost line): fail closed — store hits are kept, attributed to no call.
  for (const [pid, own] of buffered) {
    const info = { kind: "orphan", callId: null, cwd };
    procs.set(pid, info);
    for (const r of own) handle(r, info);
  }
  return events;
}
