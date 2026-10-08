// T15 fix round 4, R3-5: the Linux signer-child trace parser (mock/lib/child-trace.mjs) joins strace's
// `<unfinished ...>` / `<... X resumed>` pairs — node runs threads under `strace -f`, so its syscalls interleave — and
// counts the trace as STARTED only once it has seen the child node's own successful execve. A trace in which node never
// started (bwrap failed, the execve was refused) yields started=false, so the call is not marked audited.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChildTrace } from "../mock/lib/child-trace.mjs";
import { IO_URING_INJECT } from "../mock/lib/strace-records.mjs";
import { childStraceArgv } from "../mock/signer-host.mjs";
import { straceArgv } from "./adapters/cc-audit.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "adapters", "__fixtures__", "strace");
const NODE = "/usr/bin/node";
const read = (n) => readFileSync(join(FIX, n), "utf8");

test("R3-5: an execve split across <unfinished ...> / <... execve resumed> still starts the trace; bwrap's own opens before it are not the signer's", () => {
  const { started, opens } = parseChildTrace(read("child-unfinished.strace"), NODE);
  assert.equal(started, true);
  assert.ok(!opens.some((o) => o.at < 1760000100031), "nothing before node's execve resumed counts (bwrap setup)");
});

test("R3-5: interleaved unfinished / resumed syscalls of node's threads are joined, with the kernel path from the resumed half", () => {
  const { opens, ioUring } = parseChildTrace(read("child-unfinished.strace"), NODE);
  const got = opens.map((o) => [o.op, o.path]);
  assert.deepEqual(got, [
    ["open", "/usr/lib/x86_64-linux-gnu/libstdc++.so.6"],
    ["open", "/home/agent/.agents/sohopay-agent-workload/secret.json"],
    ["open", "/home/agent/.agents/stray.json"],
    ["stat", "/home/agent/.agents/other"],
    ["write", "/home/agent/hdr.txt"],
  ]);
  assert.equal(opens[1].at, 1760000100100, "a joined syscall keeps the time it STARTED");
  assert.equal(ioUring, true, "an unfinished io_uring_setup is still seen");
});

test("R2-9: the signer child's strace fails io_uring_setup (ENOSYS); a failed setup is no ring, a ring that exists or any io_uring_enter is still reported", () => {
  assert.deepEqual(childStraceArgv("/w/child.strace").slice(-3), ["-e", IO_URING_INJECT, "--"]);
  assert.ok(childStraceArgv("/w/child.strace").some((a) => a.startsWith("trace=") && a.includes("?io_uring_setup") && a.includes("?io_uring_enter")));
  const start = `7 1760000100.000000 execve("${NODE}", ["${NODE}", "child.mjs"], 0x1 /* 2 vars */) = 0\n`;
  const setup = "io_uring_setup(256, {flags=0x10000 /* IORING_SETUP_??? */, sq_thread_cpu=0, sq_thread_idle=0})";
  assert.equal(parseChildTrace(`${start}7 1760000100.100000 ${setup} = -1 ENOSYS (Function not implemented) (INJECTED)\n`, NODE).ioUring, false);
  assert.equal(parseChildTrace(`${start}7 1760000100.100000 ${setup} = 4<anon_inode:[io_uring]>\n`, NODE).ioUring, true);
  assert.equal(parseChildTrace(`${start}7 1760000100.100000 io_uring_enter(4, 1, 0, 0, NULL, 0) = -1 EBADF (Bad file descriptor)\n`, NODE).ioUring, true);
});

// Syscalls an architecture may lack (legacy path calls only x86-64 still has; renameat / newfstatat that newer
// asm-generic ports dropped; newer calls an older kernel or strace may not know). An unknown name in `-e trace=` aborts
// strace, so each must carry `?` in every set that is not x64-only.
const ARCH_OPTIONAL = ["open", "creat", "stat", "lstat", "access", "readlink", "unlink", "rename", "link", "symlink", "chmod", "chown", "lchown", "mkdir", "rmdir", "mknod", "utimes", "fork", "vfork", "renameat", "newfstatat", "openat2", "faccessat2", "fchmodat2", "clone3", "io_uring_setup", "io_uring_enter", "chown32", "lchown32", "fchown32", "truncate64", "ftruncate64", "stat64", "lstat64", "fstat64", "fstatat64", "fcntl64"];
const traceSet = (argv) => argv.find((a) => a.startsWith("trace=")).slice("trace=".length).split(",");

test("aarch64: every arch-optional syscall in the signer-child and agent (non-x64) trace sets is marked `?`", () => {
  for (const [name, set] of [["signer child", traceSet(childStraceArgv("/w/c.strace"))], ["agent arm64", traceSet(straceArgv("/r/a.strace", { arch: "arm64" }))]]) {
    for (const s of set) assert.ok(!ARCH_OPTIONAL.includes(s), `${name}: ${s} must be ?${s}`);
    assert.ok(set.includes("openat") && set.includes("?io_uring_setup"), `${name}: core calls traced`);
  }
  const child = traceSet(childStraceArgv("/w/c.strace"));
  for (const s of ["?open", "?creat", "?renameat", "?newfstatat"]) assert.ok(child.includes(s), `signer child traces ${s}`);
  assert.ok(traceSet(straceArgv("/r/a.strace", { arch: "x64" })).includes("open"), "x64-only legacy calls stay required on x64");
});

test("R3-5: a trace where node's execve never succeeded is NOT started — no opens, never 'available'", () => {
  const r = parseChildTrace(read("child-noexec.strace"), NODE);
  assert.equal(r.started, false);
  assert.deepEqual(r.opens, []);
});

// Review C1: the signer child is held to the agent tree's rule — a CLONE_UNTRACED (or undecodable) clone after node
// started is reported (the host turns it into an adapter error). Its trace set carries clone / clone3 to see it.
test("C1: a CLONE_UNTRACED clone in the signer child is reported; an ordinary thread / process clone is not", () => {
  const set = traceSet(childStraceArgv("/w/c.strace"));
  assert.ok(set.includes("clone") && set.includes("?clone3"), "the child trace sees clones");
  const start = `7 1760000100.000000 execve("${NODE}", ["${NODE}", "child.mjs"], 0x1 /* 2 vars */) = 0\n`;
  const bwrapOwn = `6 1760000099.000000 clone(child_stack=NULL, flags=CLONE_NEWNS|CLONE_NEWUSER|SIGCHLD) = 7\n`;
  assert.equal(parseChildTrace(`${bwrapOwn}${start}7 1760000100.100000 clone(child_stack=NULL, flags=CLONE_UNTRACED|SIGCHLD) = 9\n`, NODE).untraced, true);
  assert.equal(parseChildTrace(`${start}7 1760000100.100000 clone3({flags=0x800000, exit_signal=SIGCHLD}, 88) = 9\n`, NODE).untraced, true);
  assert.equal(parseChildTrace(`${start}7 1760000100.100000 clone3(0xffffd0a1c3e8, 88) = 9\n`, NODE).untraced, true, "undecodable flags fail closed");
  const thread = "clone3({flags=CLONE_VM|CLONE_FS|CLONE_FILES|CLONE_SIGHAND|CLONE_THREAD|CLONE_SYSVSEM|CLONE_SETTLS|CLONE_PARENT_SETTID|CLONE_CHILD_CLEARTID, child_tid=0xffff, parent_tid=0xffff, exit_signal=0, stack=0xffff, stack_size=0x7ff100, tls=0xffff} => {parent_tid=[8]}, 88) = 8";
  assert.equal(parseChildTrace(`${bwrapOwn}${start}7 1760000100.100000 ${thread}\n`, NODE).untraced, false);
});

// Review m1: strace -y prints the cwd as `AT_FDCWD</path>`; a relative path syscall is resolved against it, so a relative
// stat / unlink inside the key store is a store event. m4: compat names parse as their 64-bit op.
test("m1/m4: relative path syscalls resolve against AT_FDCWD</path>; compat calls parse as their 64-bit ops", () => {
  const set = traceSet(childStraceArgv("/w/c.strace"));
  for (const c of ["chown32", "lchown32", "fchown32", "truncate64", "ftruncate64", "stat64", "lstat64", "fstat64", "fstatat64", "fcntl64"]) assert.ok(set.includes(`?${c}`), `child traces ?${c}`);
  const start = `7 1760000100.000000 execve("${NODE}", ["${NODE}", "child.mjs"], 0x1 /* 2 vars */) = 0\n`;
  const lines = [
    `7 1760000100.100000 newfstatat(AT_FDCWD</tmp/h/.agents>, "secret.json", {st_mode=S_IFREG|0600, st_size=1}, 0) = 0`,
    `7 1760000100.110000 unlinkat(AT_FDCWD</tmp/h/.agents>, "victim.json", 0) = 0`,
    `7 1760000100.120000 chown32("/tmp/h/.agents/secret.json", 0, 0) = 0`,
    `7 1760000100.130000 fchown32(3</tmp/h/.agents/secret.json>, 0, 0) = 0`,
    `7 1760000100.140000 truncate64("/tmp/h/.agents/secret.json", 0) = 0`,
  ].join("\n");
  assert.deepEqual(parseChildTrace(`${start}${lines}\n`, NODE).opens.map((o) => [o.op, o.path]), [
    ["stat", "/tmp/h/.agents/secret.json"],
    ["unlink", "/tmp/h/.agents/victim.json"],
    ["chown", "/tmp/h/.agents/secret.json"],
    ["chown", "/tmp/h/.agents/secret.json"],
    ["truncate", "/tmp/h/.agents/secret.json"],
  ]);
});
