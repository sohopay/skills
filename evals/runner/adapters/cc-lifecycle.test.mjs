// Final review m8: an interrupted run must not leak its world. Signals and uncaught exceptions tear registered worlds
// down synchronously; a startup sweep removes what a harder kill left (dead owner pid AND older than STALE_MS), and only
// paths of the adapter's own shapes.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STALE_MS, sweepStale } from "./cc-lifecycle.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOTS = [];
after(() => { for (const r of ROOTS) rmSync(r, { recursive: true, force: true }); });
const scratch = (p) => { const d = realpathSync(mkdtempSync(join(tmpdir(), p))); ROOTS.push(d); return d; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (fn, ms = 20_000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 50)); } };

/** A run base + tmp root holding one world owned by `pid`, recorded `ageMs` ago. */
function staleWorld({ pid, ageMs }) {
  const base = scratch("sp6-base-");
  const tmpRoot = scratch("sp6-tmp-");
  const prefix = mkdtempSync(join(tmpRoot, "agent-home-"));
  writeFileSync(join(prefix, "secret.json"), "FAKE-SP6-CANARY-PRIV-x");
  const runRoot = mkdtempSync(join(base, "sp6-run-"));
  mkdirSync(join(base, "relays"));
  const relay = join(base, "relays", "036e3624-8eda-4cb8-99db-1c8db1089562.json");
  writeFileSync(relay, "{}");
  mkdirSync(join(base, "owners"));
  const now = Date.now();
  writeFileSync(join(base, "owners", "w.json"), JSON.stringify({ pid, createdAt: now - ageMs, paths: [prefix, runRoot, relay] }));
  return { base, tmpRoot, prefix, runRoot, relay, now };
}

test("sweepStale: a dead owner's world older than STALE_MS is removed (prefix, run root, relay, record)", () => {
  const w = staleWorld({ pid: 999_999_1, ageMs: STALE_MS + 1 });
  const removed = sweepStale(w.base, { tmpRoot: w.tmpRoot, now: w.now, isAlive: () => false });
  for (const p of [w.prefix, w.runRoot, w.relay, join(w.base, "owners", "w.json")]) {
    assert.ok(!existsSync(p), p);
    assert.ok(removed.includes(p), p);
  }
});

test("sweepStale: a live owner, or a record younger than STALE_MS, is left alone", () => {
  for (const [isAlive, ageMs] of [[() => true, STALE_MS * 10], [() => false, STALE_MS - 60_000]]) {
    const w = staleWorld({ pid: 4242, ageMs });
    assert.deepEqual(sweepStale(w.base, { tmpRoot: w.tmpRoot, now: w.now, isAlive }), []);
    for (const p of [w.prefix, w.runRoot, w.relay]) assert.ok(existsSync(p), p);
  }
});

test("sweepStale: an unreferenced relay file is removed only once older than STALE_MS; a referenced one never while its owner lives", () => {
  const w = staleWorld({ pid: 4242, ageMs: 0 });
  const orphan = join(w.base, "relays", "11111111-1111-4111-8111-111111111111.json");
  const young = join(w.base, "relays", "22222222-2222-4222-8222-222222222222.json");
  writeFileSync(orphan, "{}");
  writeFileSync(young, "{}");
  const old = (w.now - STALE_MS - 1000) / 1000;
  utimesSync(orphan, old, old);
  utimesSync(w.relay, old, old);
  const removed = sweepStale(w.base, { tmpRoot: w.tmpRoot, now: w.now, isAlive: () => true });
  assert.deepEqual(removed, [orphan]);
  assert.ok(existsSync(young) && existsSync(w.relay));
});

test("sweepStale: a corrupt record never deletes anything outside the adapter's own shapes", () => {
  const w = staleWorld({ pid: 1, ageMs: STALE_MS + 1 });
  const outsider = scratch("not-sp6-");
  writeFileSync(join(w.base, "owners", "w.json"), JSON.stringify({ pid: 999_999_1, createdAt: 0, paths: [outsider, "/", w.tmpRoot, "relative/path"] }));
  sweepStale(w.base, { tmpRoot: w.tmpRoot, now: w.now, isAlive: () => false });
  assert.ok(existsSync(outsider) && existsSync(w.tmpRoot));
  assert.ok(existsSync(w.prefix), "an agent-home dir is only swept when a record names it");
});

/** Spawn the lifecycle child; resolves to its registered paths once it is ready. */
async function child(mode) {
  const base = scratch("sp6-base-");
  const tmpRoot = scratch("sp6-tmp-");
  const c = spawn(process.execPath, [join(HERE, "__fixtures__", "lifecycle-child.mjs"), base, tmpRoot, mode], { stdio: ["ignore", "pipe", "pipe"] });
  let buf = "";
  c.stdout.on("data", (d) => { buf += d; });
  await waitFor(() => buf.includes("\n"));
  const exit = new Promise((r) => c.once("exit", (code, signal) => r({ code, signal })));
  return { c, base, info: JSON.parse(buf.split("\n")[0]), exit };
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  test(`${sig}: registered worlds are torn down (paths, relay, owner record, process group) and the process still dies of ${sig}`, async () => {
    const { c, base, info, exit } = await child("wait");
    assert.ok(existsSync(info.prefix) && alive(info.sleeper));
    c.kill(sig);
    const { signal } = await exit;
    assert.equal(signal, sig);
    for (const p of [info.prefix, info.runRoot, info.relay]) assert.ok(!existsSync(p), p);
    assert.deepEqual(readdirSync(join(base, "owners")), []);
    await waitFor(() => !alive(info.sleeper), 5000);
  });
}

test("an uncaught exception tears registered worlds down too (exit handler)", async () => {
  const { info, exit } = await child("throw");
  const { code } = await exit;
  assert.notEqual(code, 0);
  for (const p of [info.prefix, info.runRoot, info.relay]) assert.ok(!existsSync(p), p);
  await waitFor(() => !alive(info.sleeper), 5000);
});

test("[E2E] a real adapter sample interrupted mid-run (SIGINT) leaves no agent-home world, relay file or owner record", async () => {
  const stubDir = scratch("cc-stub-int-");
  const base = scratch("sp6-run-base-");
  writeFileSync(join(stubDir, "claude"), `#!/bin/sh\n# SP6-TEST-STUB-CLAUDE\nexec '${process.execPath}' '${join(HERE, "__fixtures__", "stub-claude.mjs")}' '${join(HERE, "__fixtures__", "stub-scripts", "interrupt.mjs")}' '${stubDir}' -- "$@"\n`);
  chmodSync(join(stubDir, "claude"), 0o755);
  const skills = join(HERE, "..", "..", "..", "plugins", "sohopay", "skills");
  const c = spawn(process.execPath, [join(HERE, "__fixtures__", "interrupt-run.mjs"), join(stubDir, "claude"), skills], {
    stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, SP6_RUN_ROOT_BASE: base },
  });
  let err = "";
  c.stderr.on("data", (d) => { err += d; });
  const exit = new Promise((r) => c.once("exit", (code, signal) => r({ code, signal })));
  const where = join(stubDir, "where.json");
  await waitFor(() => existsSync(where), 30_000).catch((e) => { c.kill("SIGKILL"); throw new Error(`${e.message}: ${err}`); });
  const prefix = dirname(JSON.parse(readFileSync(where, "utf8")).home);
  assert.ok(existsSync(prefix));
  assert.ok(readdirSync(join(base, "relays")).length >= 1, "the relay registry exists mid-run");
  c.kill("SIGINT");
  const { signal } = await exit;
  assert.equal(signal, "SIGINT");
  assert.ok(!existsSync(prefix), "the agent's world is removed");
  assert.deepEqual(readdirSync(join(base, "relays")), [], "no relay registry left");
  assert.deepEqual(readdirSync(join(base, "owners")), [], "no owner record left");
  assert.deepEqual(readdirSync(base).filter((n) => n.startsWith("sp6-run-")), [], "no run root left");
}, { timeout: 90_000 });
