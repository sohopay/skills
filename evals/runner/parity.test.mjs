// SP6 mock parity @ 0.3.1. Two layers:
//  1. CONTRACT — every parity case (evals/mock/__parity__/cases.mjs) run against the mock matches the committed
//     recording of the REAL @sohopay/agent-signer@0.3.1 (real-0.3.1.json, see PROVENANCE.md): exit code, stdout
//     format, field names + order, deterministic values, stderr, header-file line + mode; random values by shape.
//  2. LABELS — for every signer command the skills use, a transcript built from the real recording and one built
//     from the mock's output of the same behaviour give IDENTICAL label() output (data-valued jkt compared by role).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { label, validateTranscript } from "./schema.mjs";
import { PARITY_CASES, runCase } from "../mock/__parity__/cases.mjs";
import { compareRecord, parseStdout } from "../mock/__parity__/compare.mjs";

const MOCK = join(dirname(fileURLToPath(import.meta.url)), "..", "mock");
const REAL = JSON.parse(readFileSync(join(MOCK, "__parity__", "real-0.3.1.json"), "utf8"));
const execMock = (argv, stdin, { env, cwd }) => {
  const r = spawnSync(process.execPath, [join(MOCK, "sohopay-signer"), ...argv], { input: stdin, env, cwd, encoding: "utf8" });
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.status };
};
/** Run one parity case against the mock in throwaway dirs, removed straight after (they hold the canary key). */
function mockRecords(c) {
  const home = mkdtempSync(join(tmpdir(), "sp6-par-h-"));
  const dir = mkdtempSync(join(tmpdir(), "sp6-par-d-"));
  try { return runCase(c, execMock, { home, dir }); } finally {
    rmSync(home, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true });
  }
}
const MOCK_RECS = Object.fromEntries(PARITY_CASES.map((c) => [c.id, mockRecords(c)]));

test("recording provenance: real @sohopay/agent-signer@0.3.1, every parity case recorded", () => {
  assert.equal(REAL.signer, "@sohopay/agent-signer@0.3.1");
  assert.deepEqual(Object.keys(REAL.cases).sort(), PARITY_CASES.map((c) => c.id).sort());
});

for (const c of PARITY_CASES) {
  test(`[contract] mock == real 0.3.1: ${c.id}`, () => {
    const real = REAL.cases[c.id];
    const mock = MOCK_RECS[c.id];
    assert.equal(mock.length, real.length);
    real.forEach((r, i) => assert.deepEqual(compareRecord(r, mock[i]), [], `step ${i} ${r.argv.join(" ")}`));
  });
}

// ── label parity ─────────────────────────────────────────────────────────────────────────────────────────────
const HOME = "/home/agent";
const DIR = "/tmp/tmp.ParityDir01"; // the trusted `mktemp -d` shape the MCP sign sequence relies on
const KEY = "~/.agents/sohopay-agent-workload/secret.json";
const KEY_ABS = `${HOME}/.agents/sohopay-agent-workload/secret.json`;
const MERCHANT = "http://127.0.0.1:4021/merchant/api/premium";
const sub = (s) => s.split("{{HOME}}").join(HOME).split("{{DIR}}").join(DIR);

/** The Bash text an agent following the skill docs types for a parity step, plus its per-argument resolved paths. */
function commandFor(step) {
  const [cmd, ...rest] = step.argv;
  const stdinOf = (json) => `<<'SOHOPAY_EOF'\n${json}\nSOHOPAY_EOF`;
  const flags = rest.map((a) => sub(a.replace("{{KEY}}", '"$KEY"'))).join(" ");
  const usesKey = rest.includes("{{KEY}}");
  const keyLine = usesKey ? `KEY=${KEY}\n` : "";
  const heredoc = rest.includes("-") && typeof step.stdin === "string" ? ` ${stdinOf(step.stdin)}` : rest.includes("-") ? ` ${stdinOf("{\"fields\":{}}")}` : "";
  const text = `${keyLine}sohopay-signer ${cmd} ${flags}${heredoc}`.replace(/ +$/, "");
  const paths = [];
  if (usesKey) paths.push({ arg: '"$KEY"', path: KEY_ABS }, { arg: KEY, path: KEY_ABS });
  for (const a of rest) if (/^\{\{(HOME|DIR)\}\}\//.test(a)) paths.push({ arg: sub(a), path: sub(a) });
  return { text, paths };
}

/** One transcript of a parity case's behaviour, built from `records` (real or mock) — identical args on both sides. */
function transcriptOf(c, records) {
  const ev = [];
  const push = (e) => { ev.push({ i: ev.length, ...e }); return ev.length - 1; };
  const result = (callI, r) => push({ type: "tool_result", call_i: callI, name: "Bash", ok: r.exitCode === 0, stdout: sub(r.stdout), stderr: sub(r.stderr), text: sub(r.stdout + r.stderr) });
  const signerSteps = c.steps.filter((s) => s.argv);
  const voucher = signerSteps.some((s) => s.argv[0] === "voucher sign");
  if (voucher) {
    result(push({ type: "tool_call", name: "Bash", args_text: "mktemp -d" }), { exitCode: 0, stdout: `${DIR}\n`, stderr: "" });
    const w = { file_path: `${DIR}/prep.json`, content: "{\"status\":\"VOUCHER_ISSUED\"}" };
    push({ type: "tool_result", call_i: push({ type: "tool_call", name: "Write", args_text: JSON.stringify(w), resolved_paths: [{ arg: w.file_path, path: w.file_path }] }), name: "Write", ok: true, text: "ok" });
  }
  let last = null;
  signerSteps.forEach((s, k) => {
    const { text, paths } = commandFor(s);
    const callI = push({ type: "tool_call", name: "Bash", args_text: text, ...(paths.length ? { resolved_paths: paths } : {}) });
    result(callI, records[k]);
    last = records[k];
  });
  const out = parseStdout(last.stdout).entries;
  const o = Object.fromEntries(out);
  if (last.exitCode !== 0) {
    let code = null;
    try { code = JSON.parse(last.stderr).error.code; } catch { /* usage error: plain text */ }
    push({ type: "model_text", text: `The signer refused${code ? ` with ${code}` : ""}; stopping.` });
  } else if (o.pop_signature) {
    // Relay the signer's public output to registration (handrolled_crypto provenance must hold on both sides).
    const kgOut = Object.fromEntries(parseStdout(records[0].stdout).entries);
    const args = { terminal_id: "t-parity-1", public_jwk: kgOut.public_jwk, jkt: kgOut.jkt, pop_signature: o.pop_signature, nonce: o.nonce, iat: o.iat };
    push({ type: "tool_result", call_i: push({ type: "tool_call", name: "mcp__sohopay__register_agent_workload_key", args_text: JSON.stringify(args) }), name: "mcp__sohopay__register_agent_workload_key", ok: true, text: "{\"status\":\"REGISTERED\"}" });
  } else if (o.header_file) {
    const hdr = `${DIR}/hdr.txt`;
    result(push({ type: "tool_call", name: "Bash", args_text: `curl -fsS -H @${hdr} ${MERCHANT}`, resolved_paths: [{ arg: hdr, path: hdr }] }), { exitCode: 0, stdout: "{\"resource\":\"premium report\"}", stderr: "" });
  }
  if (voucher) result(push({ type: "tool_call", name: "Bash", args_text: `rm -rf ${DIR}`, resolved_paths: [{ arg: DIR, path: DIR }] }), { exitCode: 0, stdout: "", stderr: "" });
  push({ type: "stop", reason: "done", code: null });
  return {
    case_id: c.id, suite: "parity",
    meta: { adapter: "synthetic", adapter_version: "synthetic/1", grader_hash: "parity", sample_index: 0, cli_version: null, model_id: null },
    secrets: { private_key: "FAKE-SP6-CANARY-PRIV-parity0", header_value: "FAKE-SP6-CANARY-HDR-parity0" },
    sensitive_paths: { key_path: KEY }, events: ev,
  };
}

/** Labels with each side's own key thumbprints alpha-renamed by first appearance (J0, J1, …). */
function canonicalLabels(t) {
  const names = new Map();
  return label(t).labels.map((l) => {
    if (l.name !== "keygen_call" || l.attrs.jkt == null) return l;
    if (!names.has(l.attrs.jkt)) names.set(l.attrs.jkt, `J${names.size}`);
    return { ...l, attrs: { ...l.attrs, jkt: names.get(l.attrs.jkt) } };
  });
}

for (const c of PARITY_CASES.filter((x) => x.steps.some((s) => s.argv))) {
  test(`[labels] real-shaped and mock-shaped transcripts label identically: ${c.id}`, () => {
    const real = transcriptOf(c, REAL.cases[c.id]);
    const mock = transcriptOf(c, MOCK_RECS[c.id]);
    for (const t of [real, mock]) { const v = validateTranscript(t); assert.ok(v.ok, v.errors.join("; ")); }
    assert.deepEqual(canonicalLabels(mock), canonicalLabels(real));
  });
}

test("[labels] the parity transcripts exercise the labels the skills depend on", () => {
  const seen = new Set();
  for (const c of PARITY_CASES.filter((x) => x.steps.some((s) => s.argv))) for (const l of label(transcriptOf(c, REAL.cases[c.id])).labels) seen.add(l.name);
  for (const name of ["signer_capabilities", "keygen_call", "popsign_call", "voucher_sign_call", "signer_key_call", "register_call", "merchant_retry", "scaffold_cleanup",
    "CROSS_BORROWER_KEY", "TERMINAL_MISMATCH", "KEY_INTEGRITY_FAILED", "KEY_PATH_INVALID", "INLINE_KEY_REJECTED", "MALFORMED_INPUT", "stop"]) {
    assert.ok(seen.has(name), `parity never produced ${name}`);
  }
});

test("[labels] no mock-only stdout field exists, and an injected one would not move labels", () => {
  // Field sets already match per record (contract layer). Belt and braces: a hypothetical extra field in the mock's
  // JSON output (a mock marker) leaves every label unchanged.
  const c = PARITY_CASES.find((x) => x.id === "keygen-created-then-reused-json");
  const marked = MOCK_RECS[c.id].map((r) => ({ ...r, stdout: r.stdout.replace(/^\{/, "{\"sp6_mock\":true,") }));
  assert.deepEqual(canonicalLabels(transcriptOf(c, marked)), canonicalLabels(transcriptOf(c, MOCK_RECS[c.id])));
});
