// file_open_audit for the live adapter: process-tree file auditing where the platform allows it WITHOUT root.
//
//   linux  → `strace -f -ttt -qq -y` around the claude process. Agent activity is (a) every process subtree the CLI
//            spawns while a tool call is in flight (attributed to that call) and (b) the CLI's OWN file activity inside
//            the window of an in-process file tool (Read / Write / Edit / Grep / Glob / …). CLI activity outside every
//            tool window is not, nor are hook processes — excluded ONLY by the pids the hooks report over the
//            authenticated relay, never by argv text (an agent can put any text in an argv). Paths are the kernel's:
//            an open's `= N</path>` annotation, fd annotations, and links the trace itself created are resolved.
//            Lines of a pid seen before its parent's clone returns are buffered until the parentage is known. The
//            signer never runs in this tree (it is hosted out of process), so its sanctioned key opens cannot appear.
//   darwin → unavailable: fs_usage and dtrace need root (and dtrace SIP off). No events are emitted, never fake ones.
//            The cross-platform key-store lstat audit and the signer host's open log still run everywhere.
import { spawnSync } from "node:child_process";
import { posix } from "node:path";
import { HardError } from "../schema.mjs";

// *at / fd forms exist on every Linux arch; `?name` = optional (strace or the kernel may not know it).
const COMMON = [
  "openat", "?openat2", "newfstatat", "statx", "faccessat", "?faccessat2", "readlinkat", "unlinkat", "renameat", "renameat2",
  "linkat", "symlinkat", "fchmodat", "?fchmodat2", "fchownat", "mkdirat", "mknodat", "utimensat", "truncate", "ftruncate",
  "fchmod", "fchown", "setxattr", "lsetxattr", "fsetxattr", "removexattr", "lremovexattr", "fremovexattr",
  "execve", "execveat", "chdir", "fchdir", "clone", "?clone3",
  // R2-9: io_uring I/O carries no paths strace can see — its use in an agent subtree is itself an adapter error.
  "?io_uring_setup", "?io_uring_enter",
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

const LINE_RE = /^(\d+)\s+(\d+\.\d+)\s+(\w+)\((.*)\)\s+=\s+(-?\d+|\?)(?:<([^>]*)>)?/;
const RESUMED_RE = /^(\d+)\s+(\d+\.\d+)\s+<\.\.\.\s+(\w+)\s+resumed>(.*)\)\s+=\s+(-?\d+|\?)(?:<([^>]*)>)?/;
const UNFINISHED_RE = /^(\d+)\s+(\d+\.\d+)\s+(\w+)\((.*)<unfinished \.\.\.>/;
const unesc = (s) => s.replace(/\\(x[0-9a-f]{2}|[0-7]{1,3}|.)/gi, (_, c) => (c[0] === "x" ? String.fromCharCode(parseInt(c.slice(1), 16)) : /^[0-7]+$/.test(c) ? String.fromCharCode(parseInt(c, 8)) : c === "n" ? "\n" : c === "t" ? "\t" : c));
const CLONE_RE = /^(clone|clone3|fork|vfork)$/;
const FD_OPS = new Set(["fchmod", "fchown", "ftruncate", "fsetxattr", "fremovexattr"]);
// Syscalls that act on a link itself (do not follow the final component), unless AT_SYMLINK_FOLLOW says otherwise.
const NOFOLLOW_FINAL = /^(unlink|unlinkat|rename|renameat|renameat2|link|linkat|symlink|symlinkat|lstat|readlink|readlinkat|mkdir|mkdirat|rmdir|mknod|mknodat|lsetxattr|lremovexattr|lchown)$/;
// File tools Claude Code runs IN-PROCESS: their file activity is the CLI's own.
const IN_PROCESS_TOOLS = new Set(["Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "NotebookRead", "Grep", "Glob", "LS"]);
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

/** strace text → ordered records {pid, at, sys, args, ret, kpath}; kpath = the kernel's `= N</path>` annotation. */
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
      out.push({ pid: Number(r[1]), at: p?.at ?? Math.round(Number(r[2]) * 1000), sys: r[3], args: (p?.args ?? "") + r[4], ret: r[5], kpath: r[6] ?? null });
      continue;
    }
    const m = LINE_RE.exec(raw);
    if (m) out.push({ pid: Number(m[1]), at: Math.round(Number(m[2]) * 1000), sys: m[3], args: m[4], ret: m[5], kpath: m[6] ?? null });
  }
  return out;
}

/** Resolve a path through the links the trace itself created (parents always; the final component if `final`). */
function follower(links) {
  const follow = (p, final, depth = 0) => {
    if (depth > 40) return p;
    const segs = p.split("/").filter(Boolean);
    let cur = "";
    for (let k = 0; k < segs.length; k++) {
      cur = `${cur}/${segs[k]}`;
      const last = k === segs.length - 1;
      if ((!last || final) && links.has(cur)) return follow(posix.join(links.get(cur), ...segs.slice(k + 1)), final, depth + 1);
    }
    return cur || "/";
  };
  return follow;
}

/** Absolute paths a syscall names: the kernel's open path, fd-annotated targets, strings relative to a dirfd. */
function pathsOf(rec, parts, cwd, op, follow) {
  const { sys, args, kpath } = rec;
  if (/^(open|openat|openat2|creat)$/.test(sys) && kpath) return [kpath];
  if (FD_OPS.has(sys)) { const fd = FD_ARG_RE.exec(parts[0] ?? ""); return fd ? [fd[1]] : []; }
  const refs = [];
  parts.forEach((a, k) => {
    const s = STR_ARG_RE.exec(a);
    if (!s) return;
    const fd = FD_ARG_RE.exec(parts[k - 1] ?? "");
    refs.push({ value: unesc(s[1]), base: fd ? fd[1] : cwd });
  });
  const abs = (r) => (r.value.startsWith("/") ? posix.normalize(r.value) : posix.join(r.base, r.value));
  const finalFollows = !NOFOLLOW_FINAL.test(sys) && !/AT_SYMLINK_NOFOLLOW/.test(args);
  if (op === "symlink" && refs.length >= 2) {
    // symlink(target, link): the TARGET (relative to the link's dir) is resolved through known links; so is the link's dir.
    const link = follow(abs(refs[1]), false);
    const target = refs[0].value.startsWith("/") ? posix.normalize(refs[0].value) : posix.join(posix.dirname(link), refs[0].value);
    return [follow(target, true), link];
  }
  // execve / *xattr: only the first string is a path (argv, attribute names and values are data).
  const used = /^execve|xattr/.test(sys) ? refs.slice(0, 1) : refs.filter((r) => r.value !== "");
  return used.map((r) => follow(abs(r), finalFollows));
}

/**
 * Parse strace output into audit events under `storeRoot`: [{path, op, at, pid, ret, callId}].
 * @param {string} text
 * @param {{storeRoot:string, cwd:string, excludePids?:Map<number,number>, windows:{id:string, name?:string, start:number, end:number}[]}} o
 *   windows: tool-call windows (Pre → Post hook times). excludePids: hook pid → when the relay received its report;
 *   a pid is excluded only as a DIRECT child of the CLI cloned within that hook's span (R2-8).
 */
export function parseStrace(text, { storeRoot, cwd, excludePids = new Map(), windows = [] }) {
  const HOOK_SPAN_MS = 60_000;
  const isHookClone = (child, at) => excludePids.has(child) && at <= excludePids.get(child) + 1000 && excludePids.get(child) - at <= HOOK_SPAN_MS;
  const recs = records(text);
  const procs = new Map(); // pid → {kind: "cli"|"tool"|"excluded"|"orphan", callId, cwd}
  const buffered = new Map(); // pid → its records seen before its parent's clone returned
  const links = new Map(); // link path → resolved target, for links created in the trace
  const follow = follower(links);
  const events = [];
  const under = (p) => p === storeRoot || p.startsWith(storeRoot + "/");
  const windowAt = (t, pred = () => true) => windows.find((w) => t >= w.start && t <= w.end && pred(w)) ?? null;
  const discovery = (op, p) => (op === "stat" || op === "access") && (p === storeRoot || p === `${storeRoot}/skills` || p.startsWith(`${storeRoot}/skills/`));
  if (recs.length) procs.set(recs[0].pid, { kind: "cli", callId: null, cwd });

  const handle = (rec, info) => {
    const { pid, sys, args, ret, at } = rec;
    if (CLONE_RE.test(sys)) {
      if (!/^\d+$/.test(ret)) return;
      const child = Number(ret);
      const fresh = { kind: info.kind, callId: info.callId, cwd: info.cwd };
      if (info.kind === "cli" && !/CLONE_THREAD/.test(args) && isHookClone(child, at)) fresh.kind = "excluded";
      else if (info.kind === "cli" && !/CLONE_THREAD/.test(args)) {
        const w = windowAt(at);
        fresh.kind = w ? "tool" : "excluded";
        fresh.callId = w ? w.id : null;
      }
      procs.set(child, fresh);
      for (const b of buffered.get(child) ?? []) handle(b, fresh);
      buffered.delete(child);
      return;
    }
    if (info.kind === "excluded") return;
    if (/^io_uring_(setup|enter)$/.test(sys) && info.kind !== "cli") throw new HardError(`strace: io_uring used by agent process ${pid} — its file I/O is unobservable`);
    const parts = splitArgs(args);
    if (sys === "chdir" || sys === "fchdir") {
      if (ret !== "0") return;
      const s = sys === "chdir" ? STR_ARG_RE.exec(parts[0] ?? "") : null;
      const fd = sys === "fchdir" ? FD_ARG_RE.exec(parts[0] ?? "") : null;
      if (s) info.cwd = follow(unesc(s[1]).startsWith("/") ? posix.normalize(unesc(s[1])) : posix.join(info.cwd, unesc(s[1])), true);
      if (fd) info.cwd = fd[1];
      return;
    }
    const op = opOf(sys, args);
    const paths = pathsOf(rec, parts, info.cwd, op, follow);
    if (op === "symlink" && ret === "0" && paths.length === 2) links.set(paths[1], paths[0]);
    if ((op === "unlink" || op === "rename") && ret === "0") for (const p of paths) links.delete(p);
    let callId = info.callId ?? null;
    if (info.kind === "cli") {
      const w = windowAt(at, (x) => IN_PROCESS_TOOLS.has(x.name));
      if (!w) return; // the CLI's own activity outside every in-process tool window is not the agent's
      callId = w.id;
    }
    for (const p of paths) {
      if (!under(p)) continue;
      if (info.kind === "cli" && discovery(op, p)) continue; // the CLI's skills discovery, not the tool's
      events.push({ path: p, op, at, pid, ret: ret === "?" ? null : Number(ret), callId });
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
