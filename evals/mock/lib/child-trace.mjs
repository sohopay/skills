// Linux: what the sandboxed signer child opened, from `strace -f -y -ttt` output. Only events after the child's node
// execve count (bwrap's own setup is not the signer). Kernel-resolved paths are used where strace prints them
// (`= N</path>` for opens, `N</path>` for fd arguments); other path syscalls are taken as the absolute strings.
// io_uring use is reported (its I/O would be unobservable).
const LINE_RE = /^(\d+)\s+(\d+\.\d+)\s+(\w+)\((.*)\)\s+=\s+(-?\d+|\?)(?:<([^>]*)>)?/;
const WRITE_FLAGS = /O_(WRONLY|RDWR|CREAT|TRUNC|APPEND)/;
const PATH_SYS = /^(newfstatat|statx|faccessat2?|readlinkat|unlinkat|renameat2?|linkat|symlinkat|fchmodat2?|fchownat|mkdirat|mknodat|utimensat|truncate|stat|lstat|access|unlink|rename|link|symlink|chmod|chown|mkdir|rmdir)$/;
const FD_SYS = /^(fchmod|fchown|ftruncate|fsetxattr|fremovexattr)$/;

function opOf(sys, args) {
  if (/^(open|openat|openat2|creat)$/.test(sys)) return WRITE_FLAGS.test(args) || sys === "creat" ? "write" : "open";
  if (/stat|readlink/.test(sys)) return "stat";
  if (/access/.test(sys)) return "access";
  return sys.replace(/at2?$/, "").replace(/^f(?=chmod|chown|truncate)/, "").replace(/^(f|l)?(set|remove)xattr$/, "setxattr");
}

/** @returns {{opens: {path:string, op:string, at:number}[], ioUring: boolean}} */
export function parseChildTrace(text, nodePath) {
  const opens = [];
  let started = false;
  let ioUring = false;
  for (const raw of text.split("\n")) {
    const m = LINE_RE.exec(raw);
    if (!m) continue;
    const [, , t, sys, args, ret, kpath] = m;
    if (!started) { if (sys === "execve" && args.startsWith(JSON.stringify(nodePath)) && ret === "0") started = true; continue; }
    if (/^io_uring_(setup|enter)$/.test(sys)) { ioUring = true; continue; }
    const at = Math.round(Number(t) * 1000);
    if (/^(open|openat|openat2|creat)$/.test(sys)) {
      const p = kpath ?? (/"(\/[^"]*)"/.exec(args)?.[1] ?? null);
      if (p) opens.push({ path: p, op: opOf(sys, args), at });
    } else if (FD_SYS.test(sys)) {
      const fd = /^\d+<([^>]*)>/.exec(args);
      if (fd) opens.push({ path: fd[1], op: opOf(sys, args), at });
    } else if (PATH_SYS.test(sys)) {
      for (const s of args.matchAll(/(?:\d+<([^>]*)>, )?"(\/?[^"]*)"/g)) {
        const p = s[2].startsWith("/") ? s[2] : s[1] ? `${s[1]}/${s[2]}` : null;
        if (p) opens.push({ path: p, op: opOf(sys, args), at });
      }
    }
  }
  return { opens, ioUring };
}
