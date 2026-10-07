// Parity cases: one script per signer behaviour the skills exercise, run identically against the REAL 0.3.1
// signer (capture.mjs, offline, once) and the MOCK (parity.test.mjs, every CI run). Each step is a CLI call or
// a filesystem setup action; outputs are normalised ({{HOME}}, {{DIR}}) so the two recordings are comparable.
import { chmodSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const KEY_REL = ".agents/sohopay-agent-workload/secret.json";
const B = "b-parity-1";
const T = "t-parity-1";
const kg = (b, t, extra = []) => ({ argv: ["key generate", "--out", "{{KEY}}", "--input", "-", ...extra], stdin: JSON.stringify({ borrower_id: b, terminal_id: t }) });
const kgJson = (b, t) => ({ ...kg(b, t, ["--output", "json"]), save: { jkt: "jkt" } });
const pop = (b, t, extra = [], fields = {}) => ({ argv: ["pop sign", "--key", "{{KEY}}", "--input", "-", ...extra], stdin: (v) => JSON.stringify({ fields: { borrowerId: b, terminalId: t, jkt: v.jkt, ...fields } }) });
const CORE = {
  agentId: "oa-parity-1", merchantId: `0x${"11".repeat(32)}`, asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  chainId: "8453", amount: "1000000", feeAmount: "0", orderRef: `0x${"22".repeat(32)}`, nonce: "parity-nonce-1", deadline: "1790000000",
};
const SIGNING = { algorithm: "Ed25519", domain_tag: "SohoPay:AgentPaymentVoucher:v2", canonicalization: "RFC8785", signature_encoding: "base64url" };
const pid = { argv: ["payment-id", "--input", "-", "--output", "json"], stdin: JSON.stringify({ core: CORE }), save: { pid: "payment_id" } };

/** The prepare response the backend would return for CORE, bound to this run's key (byte-for-byte to prep.json). */
export function prepResponse(v, extra = {}) {
  const voucher = { ...CORE, paymentId: v.pid, agentKeyJkt: v.jkt };
  return JSON.stringify({
    status: "VOUCHER_ISSUED", payment_id: v.pid, voucher, signing: SIGNING, header_name: "PAYMENT-SIGNATURE",
    envelope: { x402Version: 2, paymentPayload: { x402Version: 2, scheme: "credit", network: "base", payload: { voucher: { ...voucher, ...(extra.embedded ?? {}) }, signature: null } } },
    ...(extra.top ?? {}),
  });
}
const writePrep = (extra) => ({ write: "{{DIR}}/prep.json", content: (v) => prepResponse(v, extra) });
const sign = (extra = []) => ({ argv: ["voucher sign", "--envelope", "--key", "{{KEY}}", "--input", "{{DIR}}/prep.json", ...extra] });
const WH = ["--write-header", "{{DIR}}/hdr.txt"];

export const PARITY_CASES = [
  { id: "capabilities-human", steps: [{ argv: ["capabilities"] }] },
  { id: "capabilities-json", steps: [{ argv: ["capabilities", "--output", "json"] }] },
  { id: "verify-vectors", steps: [{ argv: ["verify-vectors"] }] },
  { id: "payment-id", steps: [pid] },
  { id: "keygen-created-then-reused-human", steps: [kg(B, T), kg(B, T)] },
  { id: "keygen-created-then-reused-json", steps: [kgJson(B, T), kgJson(B, T)] },
  { id: "keygen-no-out", steps: [{ argv: ["key generate", "--input", "-"], stdin: JSON.stringify({ borrower_id: B, terminal_id: T }) }] },
  { id: "keygen-extra-field", steps: [{ ...kg(B, T), stdin: JSON.stringify({ borrower_id: B, terminal_id: T, private_key_base64url: "x" }) }] },
  { id: "keygen-cross-borrower", steps: [kg("b-other", T), kg(B, T)] },
  { id: "keygen-terminal-mismatch", steps: [kg(B, "t-other"), kg(B, T)] },
  { id: "keygen-integrity-failed", steps: [kg(B, T), { tamperJkt: true }, kg(B, T)] },
  { id: "keygen-key-dir-too-open", steps: [{ mkdir: "{{HOME}}/.agents/sohopay-agent-workload", mode: 0o755 }, kg(B, T)] },
  { id: "keygen-bad-leaf", steps: [{ ...kg(B, T), argv: ["key generate", "--out", "{{HOME}}/.agents/sohopay-agent-workload/key.json", "--input", "-"] }] },
  { id: "keygen-outside-root", steps: [{ ...kg(B, T), argv: ["key generate", "--out", "{{DIR}}/secret.json", "--input", "-"] }] },
  { id: "popsign-human", steps: [kgJson(B, T), pop(B, T)] },
  { id: "popsign-json", steps: [kgJson(B, T), pop(B, T, ["--output", "json"])] },
  { id: "popsign-supplied-nonce", steps: [kgJson(B, T), pop(B, T, [], { nonce: "n", iat: 1 })] },
  { id: "popsign-cross-borrower", steps: [kgJson(B, T), pop("b-other", T)] },
  { id: "popsign-terminal-mismatch", steps: [kgJson(B, T), pop(B, "t-other")] },
  { id: "popsign-no-key", steps: [kgJson(B, T), { ...pop(B, T), argv: ["pop sign", "--input", "-"] }] },
  { id: "voucher-envelope-write-header-human", steps: [kgJson(B, T), pid, writePrep(), sign(WH)] },
  { id: "voucher-envelope-write-header-json", steps: [kgJson(B, T), pid, writePrep(), sign([...WH, "--output", "json"])] },
  { id: "voucher-envelope-stdout-json", steps: [kgJson(B, T), pid, writePrep(), sign(["--output", "json"])] },
  { id: "voucher-plain-json", steps: [kgJson(B, T), pid, writePrep(), { argv: ["voucher sign", "--key", "{{KEY}}", "--input", "{{DIR}}/prep.json", "--output", "json"] }] },
  { id: "voucher-inline-key", steps: [kgJson(B, T), pid, writePrep({ top: { key: { private_key_base64url: "AAAA" } } }), sign(WH)] },
  { id: "voucher-inline-key-arg", steps: [kgJson(B, T), pid, writePrep(), { argv: ["voucher sign", "--envelope", "--key", "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A", "--input", "{{DIR}}/prep.json", ...WH] }] },
  { id: "voucher-embedded-mismatch", steps: [kgJson(B, T), pid, writePrep({ embedded: { paymentId: `0x${"33".repeat(32)}` } }), sign(WH)] },
  { id: "voucher-write-header-without-envelope", steps: [kgJson(B, T), pid, writePrep(), { argv: ["voucher sign", "--key", "{{KEY}}", "--input", "{{DIR}}/prep.json", ...WH] }] },
  { id: "unknown-flag", steps: [{ argv: ["capabilities", "--bogus"] }] },
];

const fill = (s, v) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k]);

/**
 * Run one case against `exec(argv[], stdin, {env, cwd}) → {stdout, stderr, exitCode}` in a fresh HOME + scratch DIR.
 * Returns one normalised record per CLI step (setup steps record nothing).
 */
export function runCase(c, exec, { home, dir }) {
  const v = { HOME: home, DIR: dir, KEY: join(home, KEY_REL) };
  const records = [];
  for (const step of c.steps) {
    if (step.mkdir) { mkdirSync(fill(step.mkdir, v), { recursive: true }); chmodSync(fill(step.mkdir, v), step.mode); continue; }
    if (step.write) { writeFileSync(fill(step.write, v), step.content(v)); continue; }
    if (step.tamperJkt) {
      const f = v.KEY;
      const stored = JSON.parse(readFileSync(f, "utf8"));
      writeFileSync(f, `${JSON.stringify({ ...stored, jkt: "A".repeat(43) }, null, 2)}\n`);
      chmodSync(f, 0o600);
      continue;
    }
    // argv[0] is the (1–2 token) command; the rest are single tokens.
    const argv = [...step.argv[0].split(" "), ...step.argv.slice(1)].map((a) => fill(a, v));
    const stdin = typeof step.stdin === "function" ? step.stdin(v) : step.stdin ?? "";
    const out = exec(argv, stdin, { env: { HOME: home, PATH: process.env.PATH }, cwd: dir });
    for (const [name, field] of Object.entries(step.save ?? {})) {
      try { v[name] = JSON.parse(out.stdout)[field]; } catch { /* a failing step saves nothing */ }
    }
    const hdr = join(dir, "hdr.txt");
    let header = null;
    try { header = { line: readFileSync(hdr, "utf8"), mode: (statSync(hdr).mode & 0o777).toString(8) }; } catch { /* no header file */ }
    records.push({ argv: step.argv, stdout: norm(out.stdout, v), stderr: norm(out.stderr, v), exitCode: out.exitCode, header: header && { ...header, line: norm(header.line, v) } });
  }
  return records;
}

function norm(s, v) {
  let out = s ?? "";
  for (const [p, tag] of [[v.DIR, "{{DIR}}"], [v.HOME, "{{HOME}}"]]) {
    let real = p;
    try { real = realpathSync(p); } catch { /* keep lexical */ }
    for (const form of new Set([real, p])) out = out.split(form).join(tag);
  }
  return out;
}
