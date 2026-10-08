// T15 fix rounds 2–3, N2 + I8 + R2-1..R2-5: the signer host runs the signer core in a CHILD process under the same OS
// sandbox filesystem policy the agent's Bash gets (macOS sandbox-exec, Linux bwrap), so path races hit the kernel,
// exactly as for a real signer inside the agent's sandbox. The JS pre-check is only a fast refusal with the real error
// shape. Duplicated path flags are refused; the child's argv is rebuilt from the parsed values. Every /exec — malformed,
// unparseable and bad-token requests included — is logged. Missing sandbox → refusal + sandboxFailed (adapter error).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildRun, seedHome } from "../mock/run-config.mjs";
import { createBackend } from "../mock/backend.mjs";
import { publicFromPrivate, storedKeyFile } from "../mock/lib/keymodel.mjs";
import { loadScenario } from "../mock/scenarios/index.mjs";
import { createSignerHost, execForwarded, newLogs, recordTrace, sandboxSupport } from "../mock/signer-host.mjs";
import { childTraceSupport, FAKE_SANDBOX, seatbeltProfile } from "../mock/lib/signer-sandbox.mjs";
import { confinement, signerPolicy } from "./adapters/cc-world.mjs";

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "sp6-host-")));
after(() => rmSync(ROOT, { recursive: true, force: true }));
// R3-1: host-plumbing tests run the child under the TEST-ONLY fake sandbox (injected below; unconfined), so they pass on
// a host with no OS sandbox (the zero-dependency merge gate). Tests that assert KERNEL enforcement use the real one and
// skip, visibly, when it is absent — unless SP6_REQUIRE_SANDBOX=1 (the live workflow), where they are required.
const REAL = sandboxSupport();
const REQUIRE = process.env.SP6_REQUIRE_SANDBOX === "1";
const KERNEL_SKIP = !REAL.kind && !REQUIRE && `no OS sandbox here (${REAL.reason}); SP6_REQUIRE_SANDBOX=1 makes this required`;
const PLATFORM_KIND = { darwin: "sandbox-exec", linux: "bwrap" }[process.platform] ?? null;
/** A required kernel test with no real sandbox fails here (never a silent pass). */
const needReal = () => assert.ok(REAL.kind, `SP6_REQUIRE_SANDBOX=1 but no OS sandbox: ${REAL.reason}`);

async function world(caseId = "key-opacity", { policyOverrides = {}, sandbox = FAKE_SANDBOX } = {}) {
  const dir = realpathSync(mkdtempSync(join(ROOT, "w-")));
  const home = join(dir, "home");
  const sbx = join(dir, "sbx");            // stands in for the sandbox TMPDIR
  const operator = join(dir, "operator");  // stands in for the operator's home (denied)
  const runRoot = join(dir, "runroot");    // stands in for the run root (denied)
  const priv = join(dir, "private");
  for (const d of [home, sbx, operator, runRoot, priv]) mkdirSync(d, { recursive: true, mode: 0o700 });
  const run = buildRun(await loadScenario(caseId), { runDir: runRoot, home });
  seedHome(run);
  mkdirSync(join(sbx, "Old-Session"), { mode: 0o700 }); // an operator entry the sandbox denies inside its TMPDIR
  mkdirSync(join(home, ".claude"), { recursive: true });
  const policy = {
    home, writeRoots: [home, sbx], denyRead: [operator, runRoot, join(sbx, "Old-Session")], denyWrite: [join(home, ".claude"), operator, runRoot],
    allowRead: [], mktemp: [], since: Date.now(), ...policyOverrides,
  };
  const logs = newLogs();
  const exec = (argv, { stdin = "", cwd = home, env = { HOME: home }, seam, callTimeoutMs } = {}) => execForwarded(run, { argv, stdin, cwd, env }, logs, { policy, privateDir: priv, seam: { sandbox, ...seam }, callTimeoutMs });
  return { dir, home, sbx, operator, runRoot, priv, run, logs, exec, policy, sandbox, key: join(home, ".agents", "sohopay-agent-workload", "secret.json") };
}
const err = (r) => JSON.parse(r.stderr).error;
/** A real VOUCHER_ISSUED prepare response for this world (the input an honest voucher sign gets). */
function prep(w) {
  const b = createBackend(w.run);
  const ch = b.state.orderRef;
  const out = b.callTool("prepare_x402_payment", { merchant: w.run.identity.pay_to, amount: "1000000", order_ref: ch, idempotency_key: "44444444-4444-4444-8444-444444444444" });
  assert.ok(out.ok, JSON.stringify(out));
  const f = join(w.sbx, "prep.json");
  writeFileSync(f, JSON.stringify(out.result));
  return f;
}
/** Alternate `at` between the real directory `real` (renamed in/out) and a symlink to `elsewhere`; returns stop(). */
function dirLinkFlipper(at, real, elsewhere) {
  const code = `const fs=require("fs");const [at,real,el]=process.argv.slice(1);for(;;){try{fs.renameSync(real,at)}catch{};try{fs.renameSync(at,real)}catch{};try{fs.symlinkSync(el,at)}catch{};try{fs.unlinkSync(at)}catch{}}`;
  const c = spawn(process.execPath, ["-e", code, at, real, elsewhere], { stdio: "ignore" });
  return () => new Promise((r) => { c.once("exit", r); c.kill("SIGKILL"); });
}
/** Flip `link` between two targets in a separate process as fast as it can; returns stop(). */
function flipper(link, a, b) {
  const code = `const fs=require("fs");const [l,a,b]=process.argv.slice(1);let i=0;for(;;){try{fs.unlinkSync(l)}catch{};try{fs.symlinkSync(i++%2?a:b,l)}catch{}}`;
  const c = spawn(process.execPath, ["-e", code, link, a, b], { stdio: "ignore" });
  return () => new Promise((r) => { c.once("exit", r); c.kill("SIGKILL"); });
}

test("sandbox support: macOS uses sandbox-exec, Linux bwrap (REQUIRED under SP6_REQUIRE_SANDBOX=1, not merely under CI)", () => {
  assert.ok(REAL.kind === null || REAL.kind === PLATFORM_KIND, JSON.stringify(REAL));
  if (REQUIRE) assert.equal(REAL.kind, PLATFORM_KIND, `SP6_REQUIRE_SANDBOX=1: this host must provide ${PLATFORM_KIND} (${REAL.reason})`);
});

test("R3-1: detection never yields the fake — no env var selects it; SP6_SIMULATE_NO_SANDBOX=1 only forces 'unavailable' (fail closed)", () => {
  for (const platform of ["darwin", "linux", "win32"]) {
    for (const env of [{}, { SP6_SANDBOX: "fake" }, { SP6_SIGNER_SANDBOX: "fake" }, { SP6_SIMULATE_NO_SANDBOX: "fake" }, { CI: "true" }]) {
      assert.notEqual(sandboxSupport(platform, env).kind, "fake", `${platform} ${JSON.stringify(env)}`);
    }
    assert.equal(sandboxSupport(platform, { SP6_SIMULATE_NO_SANDBOX: "1" }).kind, null, platform);
  }
  assert.equal(FAKE_SANDBOX.kind, "fake");
  assert.ok(Object.isFrozen(FAKE_SANDBOX));
});

test("R3-1: with no OS sandbox (detection forced unavailable, no injected seam) every signer call fails closed — never the fake, never unsandboxed", async () => {
  const w = await world("key-opacity", { sandbox: undefined });
  const saved = process.env.SP6_SIMULATE_NO_SANDBOX;
  process.env.SP6_SIMULATE_NO_SANDBOX = "1";
  try {
    const r = await execForwarded(w.run, { argv: ["capabilities", "--output", "json"], stdin: "", cwd: w.home }, w.logs, { policy: w.policy, privateDir: w.priv });
    assert.equal(r.exitCode, 1);
    assert.equal(r.stdout, "");
    const rec = w.logs.execs.at(-1);
    assert.equal(rec.sandboxFailed, true);
    assert.equal(rec.sandbox, null);
    assert.match(rec.sandboxError, /SP6_SIMULATE_NO_SANDBOX/);
  } finally { if (saved === undefined) delete process.env.SP6_SIMULATE_NO_SANDBOX; else process.env.SP6_SIMULATE_NO_SANDBOX = saved; }
});

test("N2: --write-header outside the sandbox set (an operator dotfile) is refused like the real signer; nothing is written", async () => {
  const w = await world();
  const rc = join(w.operator, ".zshrc");
  writeFileSync(rc, "export PATH=/usr/bin\n");
  const r = await w.exec(["voucher", "sign", "--envelope", "--key", w.key, "--input", prep(w), "--write-header", rc, "--output", "json"]);
  assert.equal(r.exitCode, 1);
  assert.deepEqual(err(r), { code: "MALFORMED_ENVELOPE", message: `cannot write header file: ${rc}` });
  assert.equal(readFileSync(rc, "utf8"), "export PATH=/usr/bin\n", "operator file untouched");
  assert.ok(w.logs.execs[0].refusals.some((f) => f.role === "write_header" && f.arg === rc));
});

test("R2-1(a) KERNEL boundary: with the JS pre-check disabled, the sandboxed child still cannot write outside the sandbox set", { skip: KERNEL_SKIP }, async () => {
  needReal();
  const w = await world("key-opacity", { sandbox: REAL });
  const rc = join(w.operator, ".zshrc");
  writeFileSync(rc, "export PATH=/usr/bin\n");
  const r = await w.exec(["voucher", "sign", "--envelope", "--key", w.key, "--input", prep(w), "--write-header", rc, "--output", "json"], { seam: { precheck: false } });
  assert.equal(r.exitCode, 1, r.stdout);
  assert.equal(err(r).code, "MALFORMED_ENVELOPE");
  assert.equal(readFileSync(rc, "utf8"), "export PATH=/usr/bin\n", "the kernel refused the write");
  assert.equal(w.logs.execs[0].sandbox, REAL.kind);
});

test("R2-1(a) race: a flip loop on the --write-header parent never touches an operator canary outside the sandbox set", { skip: KERNEL_SKIP, timeout: 120_000 }, async () => {
  needReal();
  const w = await world("key-opacity", { sandbox: REAL });
  const canary = join(w.operator, ".zshrc");
  writeFileSync(canary, "CANARY-UNTOUCHED\n");
  const benign = join(w.sbx, "benign");
  mkdirSync(benign);
  const d = join(w.sbx, "d");
  const input = prep(w);
  const stop = flipper(d, benign, w.operator);
  try {
    for (let k = 0; k < 40; k++) await w.exec(["voucher", "sign", "--envelope", "--key", w.key, "--input", input, "--write-header", join(d, ".zshrc"), "--output", "json"]);
  } finally { await stop(); }
  assert.equal(readFileSync(canary, "utf8"), "CANARY-UNTOUCHED\n");
});

test("R2-1(c) race: a flip loop on the --key parent never makes the signer read an operator key outside the sandbox set", { skip: KERNEL_SKIP, timeout: 120_000 }, async () => {
  needReal();
  const w = await world("key-opacity", { sandbox: REAL });
  const opKeyDir = join(w.operator, "keys");
  mkdirSync(opKeyDir, { mode: 0o700 });
  const opCanary = "FAKE-SP6-CANARY-PRIV-operatorkey~000000";
  writeFileSync(join(opKeyDir, "secret.json"), storedKeyFile(opCanary, w.run.identity.borrower_id, w.run.identity.terminal_id), { mode: 0o600 });
  const opJkt = publicFromPrivate(opCanary).jkt;
  // The core refuses any key path that crosses a link, then reads by path. So the race alternates ~/.agents between
  // the REAL directory (the core's checks pass) and a LINK to an operator copy (the following read lands there).
  const real = join(w.home, ".agents-real");
  renameSync(join(w.home, ".agents"), real);
  const opAgents = join(w.operator, "agents");
  mkdirSync(join(opAgents, "sohopay-agent-workload"), { recursive: true, mode: 0o700 });
  chmodSync(opAgents, 0o700);
  copyFileSync(join(opKeyDir, "secret.json"), join(opAgents, "sohopay-agent-workload", "secret.json"));
  chmodSync(join(opAgents, "sohopay-agent-workload", "secret.json"), 0o600);
  const stop = dirLinkFlipper(join(w.home, ".agents"), real, opAgents);
  const outs = [];
  try {
    for (let k = 0; k < 250; k++) {
      // jkt = the OPERATOR key's: only a read of the operator's key file can succeed (the real key mismatches).
      const input = JSON.stringify({ fields: { borrowerId: w.run.identity.borrower_id, terminalId: w.run.identity.terminal_id, jkt: opJkt } });
      outs.push(await w.exec(["pop", "sign", "--key", w.key, "--input", "-", "--output", "json"], { stdin: input }));
    }
  } finally { await stop(); }
  assert.ok(!outs.some((r) => r.exitCode === 0), `the operator's key was never read (${outs.filter((r) => r.exitCode === 0).length} successful signs)`);
});

test("R2-1(b): duplicated path flags are refused with the real usage-error shape (exit 2) — P3 / P4b", async () => {
  const w = await world();
  const before = readFileSync(w.key, "utf8");
  const benign = join(w.sbx, "in.json");
  writeFileSync(benign, "{}");
  for (const argv of [
    ["payment-id", "--input", benign, "--input", benign],
    ["key", "jkt", "--input", benign, "--input", w.key],                                    // P3: second flag reads the key
    ["voucher", "sign", "--envelope", "--key", w.key, "--input", benign, "--write-header", join(w.sbx, "h.txt"), "--write-header", w.key], // P4b
    ["pop", "sign", "--key", w.key, "--key=" + w.key, "--input", "-"],
    ["key", "generate", "--out", w.key, "--out", w.key, "--input", "-"],
  ]) {
    const r = await w.exec(argv);
    assert.equal(r.exitCode, 2, argv.join(" "));
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /^duplicate flag: --(input|key|out|write-header)\n$/);
  }
  assert.equal(readFileSync(w.key, "utf8"), before, "the key file is untouched");
});

test("N2: the run root (e.g. the strace output) cannot be overwritten through the host", async () => {
  const w = await world();
  const strace = join(w.runRoot, "audit.strace");
  writeFileSync(strace, "123 1.0 openat(...) = 3\n");
  const r = await w.exec(["voucher", "sign", "--envelope", "--key", w.key, "--input", prep(w), "--write-header", strace, "--output", "json"]);
  assert.equal(r.exitCode, 1);
  assert.equal(readFileSync(strace, "utf8"), "123 1.0 openat(...) = 3\n");
});

test("N2: a read oracle into a denied root is refused with the real 'cannot read input file' shape", async () => {
  const w = await world();
  const secret = join(w.operator, "creds.json");
  writeFileSync(secret, '{"token":"x"}');
  const r = await w.exec(["payment-id", "--input", secret, "--output", "json"]);
  assert.equal(r.exitCode, 1);
  assert.deepEqual(err(r), { code: "MALFORMED_ENVELOPE", message: `cannot read input file: ${secret}` });
  assert.ok(w.logs.execs[0].refusals.some((f) => f.role === "input"));
});

test("R2-2: a case variant of a denied entry (macOS case-insensitive FS) is refused too", async () => {
  const w = await world();
  writeFileSync(join(w.sbx, "Old-Session", "t.json"), "{}");
  for (const variant of ["OLD-SESSION", "old-session", "Old-Session"]) {
    const f = join(w.sbx, variant, "t.json");
    const r = await w.exec(["payment-id", "--input", f, "--output", "json"]);
    assert.equal(r.exitCode, 1, variant);
    assert.deepEqual(err(r), { code: "MALFORMED_ENVELOPE", message: `cannot read input file: ${f}` });
    assert.ok(w.logs.execs.at(-1).refusals.some((x) => x.role === "input" && x.reason === "outside sandbox"), `the fast pre-check itself refuses ${variant}`);
  }
  const r = await w.exec(["voucher", "sign", "--envelope", "--key", w.key, "--input", prep(w), "--write-header", join(w.sbx, "OLD-SESSION", "victim.txt"), "--output", "json"]);
  assert.equal(r.exitCode, 1);
  assert.ok(!existsSync(join(w.sbx, "Old-Session", "victim.txt")));
});

test("R2-3: writes honour denyWrite (HOME/.claude), and an mktemp-shaped dir counts only if owned by us and created this run", async () => {
  const w = await world();
  const r1 = await w.exec(["voucher", "sign", "--envelope", "--key", w.key, "--input", prep(w), "--write-header", join(w.home, ".claude", "settings.json"), "--output", "json"]);
  assert.equal(r1.exitCode, 1);
  assert.ok(!existsSync(join(w.home, ".claude", "settings.json")));
  assert.ok(w.logs.execs.at(-1).refusals.some((x) => x.role === "write_header"), "the fast pre-check refuses a denyWrite target");
  // An mktemp-shaped dir outside the roots: allowed only when created during this run.
  const mk = join(w.dir, "tmp.AbCdEf1234");
  mkdirSync(mk);
  // Patterns match the /private-stripped canonical path (like the live MKTEMP_DIR_RE's /tmp and /var/folders forms).
  const pattern = `${w.dir.replace(/^\/private(?=\/var\/)/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/tmp\\.[A-Za-z0-9]{6,}`;
  writeFileSync(join(mk, "x.json"), "{}");
  const old = await world("key-opacity", { policyOverrides: { mktemp: [pattern], since: Date.now() + 60_000 } });
  const r2 = await old.exec(["payment-id", "--input", join(mk, "x.json"), "--output", "json"]);
  assert.deepEqual(err(r2), { code: "MALFORMED_ENVELOPE", message: `cannot read input file: ${join(mk, "x.json")}` }, "created before this run → refused");
  const fresh = await world("key-opacity", { policyOverrides: { mktemp: [pattern], since: Date.now() - 60_000 } });
  const r3 = await fresh.exec(["payment-id", "--input", join(mk, "x.json"), "--output", "json"]);
  assert.notEqual(err(r3).message, `cannot read input file: ${join(mk, "x.json")}`, "created this run, owned by us → reaches the signer");
});

test("N2: agent-supplied SOHOPAY_SIGNER_KEY_ROOTS (and any forwarded env but HOME) is ignored; keys stay in the pinned roots", async () => {
  const w = await world("keygen-routes-to-signer");
  const elsewhere = join(w.sbx, "keys");
  mkdirSync(elsewhere, { mode: 0o700 });
  const env = { HOME: w.home, SOHOPAY_SIGNER_KEY_ROOTS: elsewhere };
  const input = JSON.stringify({ borrower_id: w.run.identity.borrower_id, terminal_id: w.run.identity.terminal_id });
  const r = await w.exec(["key", "generate", "--out", join(elsewhere, "secret.json"), "--input", "-", "--output", "json"], { stdin: input, env });
  assert.equal(r.exitCode, 1);
  assert.equal(err(r).code, "KEY_PATH_INVALID");
  assert.ok(!existsSync(join(elsewhere, "secret.json")));
  const ok = await w.exec(["key", "generate", "--out", w.key, "--input", "-", "--output", "json"], { stdin: input, env });
  assert.equal(ok.exitCode, 0, ok.stderr);
  assert.ok(w.logs.owned.some((o) => o.path === w.key), "keygen's own store write is signer-owned");
});

test("N2: an entry the sandbox denies INSIDE an allowed root (the operator's own /tmp/claude-<uid> session) is refused", async () => {
  const w = await world();
  const f = join(w.sbx, "Old-Session", "transcript.json");
  writeFileSync(f, "{}");
  const r = await w.exec(["payment-id", "--input", f, "--output", "json"]);
  assert.equal(r.exitCode, 1);
  assert.deepEqual(err(r), { code: "MALFORMED_ENVELOPE", message: `cannot read input file: ${f}` });
});

test("I8: a final-component link (to the key) is never followed for --write-header or --input; the refusal records the target", async () => {
  const w = await world();
  const before = readFileSync(w.key, "utf8");
  const link = join(w.sbx, "hdr.txt");
  symlinkSync(w.key, link);
  const r = await w.exec(["voucher", "sign", "--envelope", "--key", w.key, "--input", prep(w), "--write-header", link, "--output", "json"]);
  assert.equal(r.exitCode, 1);
  assert.equal(readFileSync(w.key, "utf8"), before);
  const inLink = join(w.sbx, "in.json");
  symlinkSync(w.key, inLink);
  const r2 = await w.exec(["payment-id", "--input", inLink, "--output", "json"]);
  assert.equal(r2.exitCode, 1);
  const refs = w.logs.execs.flatMap((e) => e.refusals);
  assert.ok(refs.some((f) => f.role === "write_header" && f.target === realpathSync(w.key)));
  assert.ok(refs.some((f) => f.role === "input" && f.target === realpathSync(w.key)));
});

const TRACE = childTraceSupport();
const TRACE_SKIP = process.platform === "linux" ? !TRACE.ok && !REQUIRE && `no child trace here (${TRACE.reason}); SP6_REQUIRE_SANDBOX=1 makes this required` : KERNEL_SKIP;
test("I8/R3-6: signer-child opens are traced on Linux (strace -y) — REQUIRED, never a silent pass; on macOS recorded as audit-unavailable", { skip: TRACE_SKIP }, async () => {
  needReal();
  const w = await world("key-opacity", { sandbox: REAL });
  const r = await w.exec(["voucher", "sign", "--envelope", "--key", w.key, "--input", prep(w), "--write-header", join(w.sbx, "h.txt"), "--output", "json"]);
  assert.equal(r.exitCode, 0, r.stderr);
  const rec = w.logs.execs.at(-1);
  if (process.platform === "darwin") { assert.equal(rec.audit, "unavailable"); return; }
  assert.ok(TRACE.ok, `Linux: the signer child must be traced (${TRACE.reason})`);
  assert.equal(rec.audit, "available", "Linux: an untraced signer child fails this test");
  assert.ok(rec.opens.some((o) => o.path === realpathSync(w.key) && o.sanctioned), "the --key read is seen and marked sanctioned");
});

test("fail closed: no usable sandbox (none / missing wrapper / unloadable profile) → refusal + sandboxFailed, never an unsandboxed run", async () => {
  const w = await world();
  // Platform-independent: a support record for this platform's kind whose wrapper is missing, and no sandbox at all.
  const seams = [{ sandbox: { kind: null, reason: "none here" } }, { sandbox: { kind: PLATFORM_KIND ?? "bwrap", path: "/nonexistent/sandbox-wrapper" } }];
  if (REAL.kind) seams.push({ sandbox: REAL, brokenProfile: true }); // needs the real wrapper to reject the profile
  for (const seam of seams) {
    const r = await w.exec(["capabilities", "--output", "json"], { seam });
    assert.equal(r.exitCode, 1, JSON.stringify(seam));
    assert.equal(r.stdout, "");
    assert.equal(w.logs.execs.at(-1).sandboxFailed, true);
  }
});

/** Replace a test world's deny / allow lists with the ones production builds for that HOME (signerPolicy). */
function useProductionLists(w) {
  const confine = confinement({ home: w.home, runRoot: w.runRoot, prefix: w.dir, base: w.operator, platform: process.platform, listTmp: () => [] });
  const { denyRead, denyWrite, allowRead } = signerPolicy({ home: w.home, confine, since: w.policy.since });
  Object.assign(w.policy, { denyRead, denyWrite, allowRead });
}
test("R3-2: the child / pre-check policy denies HOME/.claude/projects (the session JSONL) like the agent's sandbox — built from ONE source", async () => {
  const w = await world();
  useProductionLists(w);
  assert.ok(w.policy.denyRead.includes(join(w.home, ".claude", "projects")), JSON.stringify(w.policy.denyRead));
  const f = join(w.home, ".claude", "projects", "-slug", "s.jsonl");
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, '{"type":"user"}\n');
  const r = await w.exec(["payment-id", "--input", f, "--output", "json"]);
  assert.deepEqual(err(r), { code: "MALFORMED_ENVELOPE", message: `cannot read input file: ${f}` });
  assert.ok(w.logs.execs.at(-1).refusals.some((x) => x.role === "input" && x.reason === "outside sandbox"), "the pre-check refuses it");
});

test("R3-2 KERNEL: with the pre-check off, the sandboxed child cannot read HOME/.claude/projects either", { skip: KERNEL_SKIP }, async () => {
  needReal();
  const w = await world("key-opacity", { sandbox: REAL });
  useProductionLists(w);
  const f = join(w.home, ".claude", "projects", "-slug", "s.jsonl");
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, '{"type":"user"}\n');
  const r = await w.exec(["payment-id", "--input", f, "--output", "json"], { seam: { precheck: false } });
  assert.deepEqual(err(r), { code: "MALFORMED_ENVELOPE", message: `cannot read input file: ${f}` }, "the kernel refused the read (not 'not valid JSON')");
});

test("R3-3: a signer child that never finishes (FIFO --input) is killed at the per-call timeout — refusal + sandboxFailed + timedOut, no survivor", { timeout: 60_000 }, async () => {
  const kinds = [FAKE_SANDBOX, ...(REAL.kind ? [REAL] : [])];
  for (const sandbox of kinds) {
    const w = await world("key-opacity", { sandbox });
    const fifo = join(w.home, "f");
    assert.equal(spawnSync("mkfifo", [fifo]).status, 0);
    const t0 = Date.now();
    const r = await w.exec(["payment-id", "--input", fifo, "--output", "json"], { callTimeoutMs: 1500 });
    assert.ok(Date.now() - t0 < 15_000, `${sandbox.kind}: returned at the timeout`);
    assert.equal(r.exitCode, 1);
    assert.equal(r.stdout, "");
    const rec = w.logs.execs.at(-1);
    assert.equal(rec.sandboxFailed, true, sandbox.kind);
    assert.equal(rec.timedOut, true, sandbox.kind);
    assert.match(rec.sandboxError, /timed out after 1500 ms/);
    assert.ok(Number.isInteger(rec.childPid) && rec.childPid > 1);
    assert.throws(() => process.kill(rec.childPid, 0), "the child (process group) is gone");
  }
});

test("R3-4: a sandbox path with a control character cannot be put into a Seatbelt profile — the call fails closed (adapter error)", async () => {
  assert.throws(() => seatbeltProfile({ writeRoots: ["/w"], denyRead: ["/t/c\x01x"], denyWrite: [], allowRead: [] }), /control character/);
  assert.throws(() => seatbeltProfile({ writeRoots: ["/w\x7f"], denyRead: [], denyWrite: [], allowRead: [] }), /control character/, "DEL too");
  assert.throws(() => seatbeltProfile({ writeRoots: ["/w"], denyRead: [], denyWrite: [], allowRead: ["/t/tab\tx"] }), /control character/, "every C0 is refused (fail closed), tab included");
  for (const fine of ["/t/é", "/t/u x", '/t/we"ird) (allow file-read* (subpath "/"))']) assert.doesNotThrow(() => seatbeltProfile({ writeRoots: ["/w"], denyRead: [fine], denyWrite: [], allowRead: [] }), fine);
  const w = await world("key-opacity", { policyOverrides: { denyRead: [join(ROOT, "c\x01x")] } });
  // Profile generation fails before any spawn, so this runs on every host: a sandbox-exec support record is enough.
  const r = await w.exec(["capabilities", "--output", "json"], { seam: { sandbox: { kind: "sandbox-exec", path: "/usr/bin/sandbox-exec" } } });
  assert.equal(r.exitCode, 1);
  const rec = w.logs.execs.at(-1);
  assert.equal(rec.sandboxFailed, true);
  assert.match(rec.sandboxError, /control character/);
});

test("R3-5: the child trace counts as AVAILABLE only when the child node's execve was seen; otherwise the call is unaudited", () => {
  const rec = () => ({ command: "payment-id", opens: [], audit: "unavailable" });
  const none = rec();
  recordTrace(none, "100 1.0 execve(\"/usr/bin/bwrap\", [\"bwrap\"], 0x0 /* 2 vars */) = 0\n100 1.1 openat(AT_FDCWD, \"/etc/x\", O_RDONLY) = 3</etc/x>\n", { home: "/h", parsed: {}, cwd: "/h" });
  assert.equal(none.audit, "unavailable", "never saw node: the trace parse never started");
  const seen = rec();
  recordTrace(seen, `100 1.0 execve(${JSON.stringify(process.execPath)}, [\"node\"], 0x0 /* 2 vars */) = 0\n`, { home: "/h", parsed: {}, cwd: "/h" });
  assert.equal(seen.audit, "available");
});

test("N2/R2-5: every /exec is logged — path-less, malformed, unparseable and bad-token requests included", async () => {
  const w = await world();
  await w.exec(["capabilities", "--output", "json"]);
  await w.exec(["verify-vectors"]);
  assert.deepEqual(w.logs.execs.map((e) => e.argv[0]), ["capabilities", "verify-vectors"]);
  const host = createSignerHost(w.run, { logs: w.logs, clientToken: "t".repeat(48), policy: w.policy, privateDir: w.priv, seam: { sandbox: w.sandbox } });
  const url = await host.listen(0);
  try {
    const post = (body, token = "t".repeat(48)) => fetch(`${url}/exec`, { method: "POST", headers: { "content-type": "application/json", "x-signer-client": token }, body });
    await post("{not json");
    await post(JSON.stringify({ argv: "capabilities", cwd: w.home }));
    await post(JSON.stringify({ argv: ["capabilities"], cwd: w.home }), "bad");
    const kinds = w.logs.execs.slice(2).map((e) => e.malformed ?? e.rejected);
    assert.deepEqual(kinds, ["body", "argv", "token"]);
    // R2-4: a directory --input gets the real signer error and the host stays up.
    const d = join(w.sbx, "adir");
    mkdirSync(d);
    const r = await (await post(JSON.stringify({ argv: ["payment-id", "--input", d, "--output", "json"], stdin: "", cwd: w.home }))).json();
    assert.equal(r.exitCode, 1);
    assert.deepEqual(err(r), { code: "MALFORMED_ENVELOPE", message: `cannot read input file: ${d}` });
    const again = await (await post(JSON.stringify({ argv: ["capabilities", "--output", "json"], stdin: "", cwd: w.home }))).json();
    assert.equal(again.exitCode, 0, "the host survived");
  } finally { await host.close(); }
});

test("R2-4: an exception inside a call is that call's error only — the host replies, logs it, and keeps serving", async () => {
  const w = await world();
  const host = createSignerHost(w.run, { logs: w.logs, clientToken: "t".repeat(48), policy: w.policy, privateDir: w.priv, seam: { sandbox: w.sandbox, crashOn: "payment-id" } });
  const url = await host.listen(0);
  try {
    const post = (argv) => fetch(`${url}/exec`, { method: "POST", headers: { "content-type": "application/json", "x-signer-client": "t".repeat(48) }, body: JSON.stringify({ argv, stdin: "", cwd: w.home }) }).then((r) => r.json());
    const crashed = await post(["payment-id", "--input", "-"]);
    assert.equal(crashed.exitCode, 1);
    assert.ok(w.logs.execs.some((e) => e.crashed), "the crash is logged (→ adapter error)");
    assert.equal((await post(["capabilities", "--output", "json"])).exitCode, 0, "the host survived");
  } finally { await host.close(); }
});
