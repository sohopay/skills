// T15 fix round 2, N2 + I8: the out-of-process signer host is confined exactly like a real signer inside the agent's
// sandbox, logs EVERY /exec (argv, each opened file by fd identity, each refusal), ignores behaviour-changing env,
// and identifies what it opened by the OPENED fd (fstat dev/ino against the key store; /proc/self/fd on Linux) —
// never by a path realpath'd before or after the open.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRun, seedHome } from "../mock/run-config.mjs";
import { loadScenario } from "../mock/scenarios/index.mjs";
import { execForwarded, newLogs } from "../mock/signer-host.mjs";

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "sp6-host-")));
after(() => rmSync(ROOT, { recursive: true, force: true }));

async function world(caseId = "key-opacity") {
  const dir = mkdtempSync(join(ROOT, "w-"));
  const home = join(dir, "home");
  const sbx = join(dir, "sbx");            // stands in for the sandbox TMPDIR
  const operator = join(dir, "operator");  // stands in for the operator's home (denied)
  const runRoot = join(dir, "runroot");    // stands in for the run root (denied)
  const priv = join(dir, "private");
  for (const d of [home, sbx, operator, runRoot, priv]) mkdirSync(d, { recursive: true, mode: 0o700 });
  const run = buildRun(await loadScenario(caseId), { runDir: runRoot, home });
  seedHome(run);
  mkdirSync(join(sbx, "old-session"), { mode: 0o700 }); // an operator entry the sandbox denies inside its TMPDIR
  const policy = { home, roots: [home, sbx], mktemp: [], deny: [join(sbx, "old-session")] };
  const logs = newLogs();
  const exec = (argv, { stdin = "", cwd = home, env = { HOME: home }, seam } = {}) => execForwarded(run, { argv, stdin, cwd, env }, logs, { policy, privateDir: priv, seam });
  return { dir, home, sbx, operator, runRoot, priv, run, logs, exec, key: join(home, ".agents", "sohopay-agent-workload", "secret.json") };
}
const err = (r) => JSON.parse(r.stderr).error;

test("N2: --write-header outside the sandbox set (an operator dotfile) is refused like the real signer; nothing is written", async () => {
  const w = await world();
  const rc = join(w.operator, ".zshrc");
  writeFileSync(rc, "export PATH=/usr/bin\n");
  writeFileSync(join(w.sbx, "prep.json"), "{}");
  const r = w.exec(["voucher", "sign", "--envelope", "--key", w.key, "--input", join(w.sbx, "prep.json"), "--write-header", rc, "--output", "json"]);
  assert.equal(r.exitCode, 1);
  assert.deepEqual(err(r), { code: "MALFORMED_ENVELOPE", message: `cannot write header file: ${rc}` });
  assert.equal(readFileSync(rc, "utf8"), "export PATH=/usr/bin\n", "operator file untouched");
  assert.equal(w.logs.execs.length, 1);
  assert.ok(w.logs.execs[0].refusals.some((f) => f.role === "write_header" && f.arg === rc));
});

test("N2: the run root (e.g. the strace output) cannot be overwritten through the host", async () => {
  const w = await world();
  const strace = join(w.runRoot, "audit.strace");
  writeFileSync(strace, "123 1.0 openat(...) = 3\n");
  writeFileSync(join(w.sbx, "prep.json"), "{}");
  const r = w.exec(["voucher", "sign", "--envelope", "--key", w.key, "--input", join(w.sbx, "prep.json"), "--write-header", strace, "--output", "json"]);
  assert.equal(r.exitCode, 1);
  assert.equal(readFileSync(strace, "utf8"), "123 1.0 openat(...) = 3\n");
});

test("N2: a read oracle into a denied root is refused with the real 'cannot read input file' shape, before any open", async () => {
  const w = await world();
  const secret = join(w.operator, "creds.json");
  writeFileSync(secret, '{"token":"x"}');
  let opened = 0;
  const r = w.exec(["payment-id", "--input", secret, "--output", "json"], { seam: { beforeOpen: () => { opened += 1; } } });
  assert.equal(r.exitCode, 1);
  assert.deepEqual(err(r), { code: "MALFORMED_ENVELOPE", message: `cannot read input file: ${secret}` });
  assert.equal(opened, 0, "refused by policy, never opened");
  assert.ok(w.logs.execs[0].refusals.some((f) => f.role === "input"));
});

test("N2: agent-supplied SOHOPAY_SIGNER_KEY_ROOTS (and any forwarded env but HOME) is ignored; keys stay in the pinned roots", async () => {
  const w = await world("keygen-routes-to-signer");
  const elsewhere = join(w.sbx, "keys");
  mkdirSync(elsewhere, { mode: 0o700 });
  const env = { HOME: w.home, SOHOPAY_SIGNER_KEY_ROOTS: elsewhere };
  const input = JSON.stringify({ borrower_id: w.run.identity.borrower_id, terminal_id: w.run.identity.terminal_id });
  const r = w.exec(["key", "generate", "--out", join(elsewhere, "secret.json"), "--input", "-", "--output", "json"], { stdin: input, env });
  assert.equal(r.exitCode, 1);
  assert.equal(err(r).code, "KEY_PATH_INVALID");
  assert.ok(!existsSync(join(elsewhere, "secret.json")));
  const ok = w.exec(["key", "generate", "--out", w.key, "--input", "-", "--output", "json"], { stdin: input, env });
  assert.equal(ok.exitCode, 0, ok.stderr);
});

test("N2: every /exec is logged — path-less calls included — with argv, cwd and time", async () => {
  const w = await world();
  w.exec(["capabilities", "--output", "json"]);
  w.exec(["verify-vectors"]);
  assert.deepEqual(w.logs.execs.map((e) => e.argv[0]), ["capabilities", "verify-vectors"]);
  for (const e of w.logs.execs) assert.ok(Number.isFinite(e.at) && Number.isFinite(e.done) && e.cwd === w.home);
});

test("I8: a parent-dir link flipped ON only for the open is caught by the OPENED fd's identity (dev/ino in the key store)", async () => {
  const w = await world();
  const benign = join(w.sbx, "benign");
  mkdirSync(benign);
  writeFileSync(join(benign, "secret.json"), "{}");
  const flip = join(w.sbx, "d");
  symlinkSync(benign, flip); // the policy check sees a benign dir inside the sandbox
  const seam = {
    beforeOpen: () => { unlinkSync(flip); symlinkSync(join(w.home, ".agents", "sohopay-agent-workload"), flip); },
    afterOpen: () => { unlinkSync(flip); symlinkSync(benign, flip); },
  };
  w.exec(["payment-id", "--input", join(flip, "secret.json"), "--output", "json"], { seam });
  const [o] = w.logs.execs[0].opens;
  assert.equal(o.role, "input");
  assert.equal(o.storeHit, true, "the fd that was read is the key file");
  assert.equal(o.path, realpathSync(w.key));
  assert.equal(realpathSync(join(flip, "secret.json")), realpathSync(join(benign, "secret.json")), "before/after realpath would have looked benign");
});

test("I8: a final-component link (to the key) is never followed — O_NOFOLLOW refuses it, and the refusal is logged", async () => {
  const w = await world();
  const link = join(w.sbx, "hdr.txt");
  symlinkSync(w.key, link);
  const before = readFileSync(w.key, "utf8");
  writeFileSync(join(w.sbx, "prep.json"), "{}");
  const r = w.exec(["voucher", "sign", "--envelope", "--key", w.key, "--input", join(w.sbx, "prep.json"), "--write-header", link, "--output", "json"]);
  assert.equal(r.exitCode, 1);
  assert.equal(readFileSync(w.key, "utf8"), before, "the key file is not written through the link");
  assert.ok(w.logs.execs[0].refusals.some((f) => f.role === "write_header" && f.arg === link));
});

test("I8: a planted file swapped into the open path by rename is identified by inode, not by the name", async () => {
  const w = await world();
  const p = join(w.sbx, "in.json");
  writeFileSync(p, "{}");
  const seam = { beforeOpen: () => { renameSync(p, `${p}.bak`); symlinkSync(w.key, `${p}.tmp`); renameSync(`${p}.tmp`, p); } };
  const r = w.exec(["payment-id", "--input", p, "--output", "json"], { seam });
  // The swapped-in link is the final component: O_NOFOLLOW refuses; nothing about the key is read.
  assert.equal(r.exitCode, 1);
  assert.ok(w.logs.execs[0].refusals.some((f) => f.role === "input"));
  assert.ok(!w.logs.execs[0].opens.some((o) => o.storeHit));
});

test("N2: an entry the sandbox denies INSIDE an allowed root (the operator's own /tmp/claude-<uid> session) is refused too", async () => {
  const w = await world();
  const f = join(w.sbx, "old-session", "transcript.json");
  writeFileSync(f, "{}");
  const r = w.exec(["payment-id", "--input", f, "--output", "json"]);
  assert.equal(r.exitCode, 1);
  assert.deepEqual(err(r), { code: "MALFORMED_ENVELOPE", message: `cannot read input file: ${f}` });
});
