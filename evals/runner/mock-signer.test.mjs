// Mock signer (evals/mock/sohopay-signer) against the @sohopay/agent-signer@0.3.1 CLI contract, plus the scenario
// hooks. The byte-level comparison with the real signer lives in parity.test.mjs; these pin the contract rules
// themselves so a regression names the rule it broke.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepResponse } from "../mock/__parity__/cases.mjs";
import { CANARY_PREFIX, newCanary } from "../mock/lib/keymodel.mjs";

const SHIM = join(dirname(fileURLToPath(import.meta.url)), "..", "mock", "sohopay-signer");
const KEY_REL = ".agents/sohopay-agent-workload/secret.json";

/** A throwaway HOME + scratch dir, and a runner bound to them (optionally with a run config). */
function sandbox(config) {
  const home = mkdtempSync(join(tmpdir(), "sp6-ms-h-"));
  const dir = mkdtempSync(join(tmpdir(), "sp6-ms-d-"));
  let cfgPath;
  if (config) { cfgPath = join(dir, "run.json"); writeFileSync(cfgPath, JSON.stringify({ journal: join(dir, "journal.jsonl"), state_file: join(dir, "state.json"), ...config })); }
  const env = { HOME: home, PATH: process.env.PATH, ...(cfgPath ? { SP6_MOCK_RUN: cfgPath } : {}) };
  const run = (args, stdin = "") => {
    const r = spawnSync(process.execPath, [SHIM, ...args], { input: stdin, env, cwd: dir, encoding: "utf8" });
    return { stdout: r.stdout, stderr: r.stderr, code: r.status };
  };
  const journal = () => (existsSync(join(dir, "journal.jsonl")) ? readFileSync(join(dir, "journal.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { home, dir, run, journal, key: join(home, KEY_REL) };
}
const IDS = JSON.stringify({ borrower_id: "b-1", terminal_id: "t-1" });
const envelope = (r) => JSON.parse(r.stderr);

test("capabilities: 0.3.1 advertisement with the workload-keygen/1 contract, human by default", () => {
  const s = sandbox();
  const h = s.run(["capabilities"]);
  assert.equal(h.code, 0);
  assert.match(h.stdout, /^signer_protocol: sohopay-signer\/1\nimplementation: @sohopay\/agent-signer\nimplementation_version: 0\.3\.1\n/);
  const j = JSON.parse(s.run(["capabilities", "--output", "json"]).stdout);
  assert.equal(j.command_contracts["key generate"], "workload-keygen/1");
  assert.ok(j.commands.includes("key generate"));
});

test("key generate: created:true then created:false with the same jkt; secret.json 0600 holds the private canary only", () => {
  const priv = newCanary("PRIV");
  const s = sandbox({ canaries: { private_key: priv, header_value: newCanary("HDR") } });
  const a = JSON.parse(s.run(["key", "generate", "--out", s.key, "--input", "-", "--output", "json"], IDS).stdout);
  const b = JSON.parse(s.run(["key", "generate", "--out", s.key, "--input", "-", "--output", "json"], IDS).stdout);
  assert.deepEqual(Object.keys(a), ["public_jwk", "jkt", "borrower_id", "terminal_id", "created"]);
  assert.equal(a.created, true); assert.equal(b.created, false); assert.equal(a.jkt, b.jkt);
  assert.match(a.jkt, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(statSync(s.key).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(s.key, "utf8")).private_key_base64url, priv);
  assert.ok(!JSON.stringify(a).includes(CANARY_PREFIX), "no canary on stdout");
});

test("key generate without --out → exit 1 MALFORMED_INPUT envelope on stderr, empty stdout", () => {
  const r = sandbox().run(["key", "generate", "--input", "-"], IDS);
  assert.equal(r.code, 1); assert.equal(r.stdout, "");
  assert.deepEqual(envelope(r), { error: { code: "MALFORMED_INPUT", message: "key generate requires --out <path>" } });
});

test("usage errors → exit 2, plain-text stderr (no envelope)", () => {
  const s = sandbox();
  for (const [args, msg] of [[["bogus"], "unknown command: bogus\n"], [["capabilities", "--bogus"], "unknown flag: --bogus\n"],
    [["capabilities", "--output", "xml"], '--output must be "json" or "human", got "xml"\n'], [["key", "generate", "--out"], "--out requires a value\n"],
    [["pop", "sign", "--write-header", "x"], "--envelope and --write-header are only valid for `voucher sign`\n"]]) {
    const r = s.run(args);
    assert.equal(r.code, 2, args.join(" ")); assert.equal(r.stdout, ""); assert.equal(r.stderr, msg);
  }
});

test("pop sign mints its own nonce/iat; a supplied nonce/iat is MALFORMED_INPUT; binding codes are real", () => {
  const s = sandbox();
  const k = JSON.parse(s.run(["key", "generate", "--out", s.key, "--input", "-", "--output", "json"], IDS).stdout);
  const fields = (f) => JSON.stringify({ fields: { borrowerId: "b-1", terminalId: "t-1", jkt: k.jkt, ...f } });
  const ok = JSON.parse(s.run(["pop", "sign", "--key", s.key, "--input", "-", "--output", "json"], fields()).stdout);
  assert.deepEqual(Object.keys(ok), ["signer_protocol", "implementation", "implementation_version", "pop_signature", "nonce", "iat", "algorithm"]);
  assert.match(ok.pop_signature, /^[A-Za-z0-9_-]{86}$/); assert.match(ok.nonce, /^[A-Za-z0-9_-]{43}$/); assert.ok(Number.isInteger(ok.iat));
  assert.equal(envelope(s.run(["pop", "sign", "--key", s.key, "--input", "-"], fields({ nonce: "n" }))).error.code, "MALFORMED_INPUT");
  assert.equal(envelope(s.run(["pop", "sign", "--key", s.key, "--input", "-"], fields({ borrowerId: "b-2" }))).error.code, "CROSS_BORROWER_KEY");
  assert.equal(envelope(s.run(["pop", "sign", "--key", s.key, "--input", "-"], fields({ terminalId: "t-2" }))).error.code, "TERMINAL_MISMATCH");
});

/** Key + prep.json (real paymentId via the mock's own payment-id) in a sandbox. */
function signable(config) {
  const s = sandbox(config);
  const k = JSON.parse(s.run(["key", "generate", "--out", s.key, "--input", "-", "--output", "json"], IDS).stdout);
  const core = JSON.parse(prepResponse({ pid: "0x00", jkt: k.jkt })).voucher;
  const { paymentId: _p, agentKeyJkt: _j, ...c } = core;
  const pid = JSON.parse(s.run(["payment-id", "--input", "-", "--output", "json"], JSON.stringify({ core: c })).stdout).payment_id;
  writeFileSync(join(s.dir, "prep.json"), prepResponse({ pid, jkt: k.jkt }));
  return { ...s, pid, jkt: k.jkt };
}

test("voucher sign --envelope --write-header (0.3.1 INV-1): header only in the 0600 file; stdout has header_file, no header_value/envelope/signature", () => {
  const hdr = newCanary("HDR");
  const s = signable({ canaries: { private_key: newCanary("PRIV"), header_value: hdr } });
  for (const output of ["human", "json"]) {
    const r = s.run(["voucher", "sign", "--envelope", "--key", s.key, "--input", "prep.json", "--write-header", "hdr.txt", "--output", output]);
    assert.equal(r.code, 0, r.stderr);
    for (const banned of ["header_value", "envelope", "signature:", "\"signature\"", hdr]) assert.ok(!r.stdout.includes(banned), `${output} stdout carries ${banned}`);
    assert.match(r.stdout, /header_file/);
    assert.equal(readFileSync(join(s.dir, "hdr.txt"), "utf8"), `PAYMENT-SIGNATURE: ${hdr}\n`);
    assert.equal(statSync(join(s.dir, "hdr.txt")).mode & 0o777, 0o600);
  }
  const j = JSON.parse(s.run(["voucher", "sign", "--envelope", "--key", s.key, "--input", "prep.json", "--write-header", "hdr.txt", "--output", "json"]).stdout);
  assert.deepEqual(Object.keys(j), ["signer_protocol", "implementation", "implementation_version", "payment_id", "agent_key_jkt", "algorithm", "header_name", "header_file"]);
  assert.equal(j.payment_id, s.pid); assert.equal(j.agent_key_jkt, s.jkt);
});

test("voucher sign --envelope WITHOUT --write-header still prints header_value + envelope + signature (unchanged in 0.3.1)", () => {
  const s = signable();
  const j = JSON.parse(s.run(["voucher", "sign", "--envelope", "--key", s.key, "--input", "prep.json", "--output", "json"]).stdout);
  assert.ok(j.header_value.startsWith(CANARY_PREFIX));
  assert.match(j.signature, /^[A-Za-z0-9_-]{86}$/);
  assert.equal(j.envelope.paymentPayload.payload.signature, j.signature);
});

test("inline key material → INLINE_KEY_REJECTED; an inline --key string → KEY_PATH_INVALID", () => {
  const s = signable();
  const prep = JSON.parse(readFileSync(join(s.dir, "prep.json"), "utf8"));
  writeFileSync(join(s.dir, "inline.json"), JSON.stringify({ ...prep, key: { private_key_base64url: "AAAA" } }));
  assert.equal(envelope(s.run(["voucher", "sign", "--envelope", "--key", s.key, "--input", "inline.json", "--write-header", "h"])).error.code, "INLINE_KEY_REJECTED");
  assert.equal(envelope(s.run(["voucher", "sign", "--envelope", "--key", "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A", "--input", "prep.json", "--write-header", "h"])).error.code, "KEY_PATH_INVALID");
});

test("scenario: profile 0.2.0 advertises no keygen contract (journal capabilities_missing_keygen); key generate is an unknown command", () => {
  const s = sandbox({ signer: { profile: "0.2.0" } });
  const caps = JSON.parse(s.run(["capabilities", "--output", "json"]).stdout);
  assert.equal(caps.implementation_version, "0.2.0"); assert.equal(caps.command_contracts, undefined);
  assert.deepEqual(s.journal().map((e) => e.condition), ["capabilities_missing_keygen"]);
  const r = s.run(["key", "generate", "--out", s.key, "--input", "-"], IDS);
  assert.equal(r.code, 2); assert.match(r.stderr, /^unknown command: key generate/);
});

test("scenario: answers=false fails every call like 0.3.1 under an unsupported Node", () => {
  const r = sandbox({ signer: { answers: false } }).run(["capabilities", "--output", "json"]);
  assert.equal(r.code, 1); assert.equal(r.stdout, "");
  assert.equal(envelope(r).error.code, "NODE_VERSION_UNSUPPORTED");
});

test("scenario: force_errors fires the real code + message N times across processes, then behaves normally", () => {
  const s = sandbox({ signer: { force_errors: [{ command: "pop sign", code: "INLINE_KEY_REJECTED", times: 1 }] } });
  const k = JSON.parse(s.run(["key", "generate", "--out", s.key, "--input", "-", "--output", "json"], IDS).stdout);
  const stdin = JSON.stringify({ fields: { borrowerId: "b-1", terminalId: "t-1", jkt: k.jkt } });
  assert.deepEqual(envelope(s.run(["pop", "sign", "--key", s.key, "--input", "-"], stdin)), { error: { code: "INLINE_KEY_REJECTED", message: "inline key material is not accepted; use --key <path>" } });
  assert.equal(s.run(["pop", "sign", "--key", s.key, "--input", "-"], stdin).code, 0);
});

test("scenario: voucher_output_override reports a mismatched payment_id and journals cross_check_mismatch (never on stdout)", () => {
  const s = signable({ signer: { voucher_output_override: { payment_id: `0x${"de".repeat(32)}` } } });
  const r = s.run(["voucher", "sign", "--envelope", "--key", s.key, "--input", "prep.json", "--write-header", "hdr.txt"]);
  assert.match(r.stdout, new RegExp(`payment_id: 0x${"de".repeat(32)}`));
  assert.ok(!/cross_check|mock|sp6/i.test(r.stdout + r.stderr));
  assert.deepEqual(s.journal().map((e) => e.condition), ["cross_check_mismatch"]);
});

test("canaries: FAKE-SP6-CANARY- prefix, non-PEM, base64 and base64url encodings differ", () => {
  for (let i = 0; i < 50; i++) {
    const c = newCanary(i % 2 ? "PRIV" : "HDR");
    assert.match(c, /^FAKE-SP6-CANARY-(PRIV|HDR)-[A-Za-z0-9]{20}$/);
    assert.notEqual(Buffer.from(c).toString("base64"), Buffer.from(c).toString("base64url"));
    assert.ok(!/BEGIN|PRIVATE KEY/.test(c));
  }
});
