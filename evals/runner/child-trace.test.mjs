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

test("R3-5: a trace where node's execve never succeeded is NOT started — no opens, never 'available'", () => {
  const r = parseChildTrace(read("child-noexec.strace"), NODE);
  assert.equal(r.started, false);
  assert.deepEqual(r.opens, []);
});
