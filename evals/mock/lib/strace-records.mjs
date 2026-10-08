// strace text → ordered syscall records, shared by the agent-tree audit (runner/adapters/cc-audit.mjs) and the signer
// child trace (child-trace.mjs). Under `strace -f` a multithreaded process (node) has its syscalls split into
// `<unfinished ...>` and `<... X resumed>` halves; they are joined per (pid, syscall), keeping the time the call
// STARTED, the arguments of both halves and the kernel path the resumed half reports.

/**
 * R2-9: strace makes io_uring_setup fail with ENOSYS in the whole traced tree (agent tree and signer child), so no
 * process there can open a ring whose I/O strace cannot see. Node's libuv sets up an io_uring (its epoll_ctl batching
 * ring) in every process whatever UV_USE_IO_URING says; on ENOSYS it falls back to plain epoll and threadpool file I/O
 * (openat — visible). A ring that nevertheless exists stays an error (ioUringRing).
 */
export const IO_URING_INJECT = "inject=?io_uring_setup:error=ENOSYS";

/**
 * Does this io_uring record leave a ring the process can use? io_uring_enter always counts (it only ever acts on a
 * ring); io_uring_setup counts unless it returned an error (the injected ENOSYS, or a kernel / seccomp refusal). An
 * unknown result (`?`) counts (fail closed).
 */
export function ioUringRing(sys, ret) {
  if (sys === "io_uring_enter") return true;
  if (sys !== "io_uring_setup") return false;
  return !/^-\d+$/.test(String(ret));
}

const LINE_RE =/^(\d+)\s+(\d+\.\d+)\s+(\w+)\((.*)\)\s+=\s+(-?\d+|\?)(?:<([^>]*)>)?/;
const RESUMED_RE = /^(\d+)\s+(\d+\.\d+)\s+<\.\.\.\s+(\w+)\s+resumed>(.*)\)\s+=\s+(-?\d+|\?)(?:<([^>]*)>)?/;
const UNFINISHED_RE = /^(\d+)\s+(\d+\.\d+)\s+(\w+)\((.*)<unfinished \.\.\.>/;

/** @returns {{pid:number, at:number, sys:string, args:string, ret:string, kpath:string|null}[]} kpath = `= N</path>` */
export function straceRecords(text) {
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
