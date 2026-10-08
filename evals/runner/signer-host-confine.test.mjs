// T15 fix rounds 2–3, N2 + I8 + R2-1..R2-5: the signer host runs the signer core in a CHILD process under the same OS
// sandbox filesystem policy the agent's Bash gets (macOS sandbox-exec, Linux bwrap), so path races hit the kernel,
// exactly as for a real signer inside the agent's sandbox. The JS pre-check is only a fast refusal with the real error
// shape. Duplicated path flags are refused; the child's argv is rebuilt from the parsed values. Every /exec — malformed,
// unparseable and bad-token requests included — is logged. Missing sandbox → refusal + sandboxFailed (adapter error).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRun, seedHome } from "../mock/run-config.mjs";
import { createBackend } from "../mock/backend.mjs";
import { publicFromPrivate, storedKeyFile } from "../mock/lib/keymodel.mjs";
import { loadScenario } from "../mock/scenarios/index.mjs";
import { createSignerHost, execForwarded, newLogs, sandboxSupport } from "../mock/signer-host.mjs";

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "sp6-host-")));
after(() => rmSync(ROOT, { recursive: true, force: true }));
const SANDBOX = sandboxSupport();

async function world(caseId = "key-opacity", { policyOverrides = {} } = {}) {
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
  const exec = (argv, { stdin = "", cwd = home, env = { HOME: home }, seam } = {}) => execForwarded(run, { argv, stdin, cwd, env }, logs, { policy, privateDir: priv, seam });
  return { dir, home, sbx, operator, runRoot, priv, run, logs, exec, policy, key: join(home, ".agents", "sohopay-agent-workload", "secret.json") };
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

test("sandbox support: macOS uses sandbox-exec, Linux bwrap (asserted on Linux CI)", () => {
  if (process.platform === "darwin") assert.equal(SANDBOX.kind, "sandbox-exec");
  if (process.platform === "linux" && process.env.CI) assert.equal(SANDBOX.kind, "bwrap", "Linux CI must provide bwrap (Claude Code's own sandbox prerequisite)");
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

test("R2-1(a) KERNEL boundary: with the JS pre-check disabled, the sandboxed child still cannot write outside the sandbox set", { skip: !SANDBOX.kind && `no OS sandbox here (${SANDBOX.reason})` }, async () => {
  const w = await world();
  const rc = join(w.operator, ".zshrc");
  writeFileSync(rc, "export PATH=/usr/bin\n");
  const r = await w.exec(["voucher", "sign", "--envelope", "--key", w.key, "--input", prep(w), "--write-header", rc, "--output", "json"], { seam: { precheck: false } });
  assert.equal(r.exitCode, 1, r.stdout);
  assert.equal(err(r).code, "MALFORMED_ENVELOPE");
  assert.equal(readFileSync(rc, "utf8"), "export PATH=/usr/bin\n", "the kernel refused the write");
  assert.equal(w.logs.execs[0].sandbox, SANDBOX.kind);
});

test("R2-1(a) race: a flip loop on the --write-header parent never touches an operator canary outside the sandbox set", { skip: !SANDBOX.kind && `no OS sandbox here (${SANDBOX.reason})`, timeout: 120_000 }, async () => {
  const w = await world();
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

test("R2-1(c) race: a flip loop on the --key parent never makes the signer read an operator key outside the sandbox set", { skip: !SANDBOX.kind && `no OS sandbox here (${SANDBOX.reason})`, timeout: 120_000 }, async () => {
  const w = await world();
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

test("I8: signer-child opens are traced on Linux (strace -y); on macOS they are recorded as audit-unavailable", async () => {
  const w = await world();
  await w.exec(["voucher", "sign", "--envelope", "--key", w.key, "--input", prep(w), "--write-header", join(w.sbx, "h.txt"), "--output", "json"]);
  const rec = w.logs.execs.at(-1);
  if (process.platform === "darwin") assert.equal(rec.audit, "unavailable");
  else if (rec.audit === "available") assert.ok(rec.opens.some((o) => o.path === realpathSync(w.key) && o.sanctioned), "the --key read is seen and marked sanctioned");
});

test("fail closed: no usable sandbox (missing wrapper / unloadable profile) → refusal + sandboxFailed, never an unsandboxed run", async () => {
  const w = await world();
  for (const seam of [{ sandboxCommand: "/nonexistent/sandbox-exec" }, { brokenProfile: true }]) {
    const r = await w.exec(["capabilities", "--output", "json"], { seam });
    assert.equal(r.exitCode, 1);
    assert.equal(r.stdout, "");
    assert.equal(w.logs.execs.at(-1).sandboxFailed, true);
  }
});

test("N2/R2-5: every /exec is logged — path-less, malformed, unparseable and bad-token requests included", async () => {
  const w = await world();
  await w.exec(["capabilities", "--output", "json"]);
  await w.exec(["verify-vectors"]);
  assert.deepEqual(w.logs.execs.map((e) => e.argv[0]), ["capabilities", "verify-vectors"]);
  const host = createSignerHost(w.run, { logs: w.logs, clientToken: "t".repeat(48), policy: w.policy, privateDir: w.priv });
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
  const host = createSignerHost(w.run, { logs: w.logs, clientToken: "t".repeat(48), policy: w.policy, privateDir: w.priv, seam: { crashOn: "payment-id" } });
  const url = await host.listen(0);
  try {
    const post = (argv) => fetch(`${url}/exec`, { method: "POST", headers: { "content-type": "application/json", "x-signer-client": "t".repeat(48) }, body: JSON.stringify({ argv, stdin: "", cwd: w.home }) }).then((r) => r.json());
    const crashed = await post(["payment-id", "--input", "-"]);
    assert.equal(crashed.exitCode, 1);
    assert.ok(w.logs.execs.some((e) => e.crashed), "the crash is logged (→ adapter error)");
    assert.equal((await post(["capabilities", "--output", "json"])).exitCode, 0, "the host survived");
  } finally { await host.close(); }
});
