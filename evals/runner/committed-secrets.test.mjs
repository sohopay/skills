// Task 14 review I1: nothing committed under evals/ may look like real key material. Every 43-char base64url token
// (the shape of a raw Ed25519 seed, the signer's `private_key_base64url`) must either carry the FAKE-SP6-CANARY-
// prefix or sit in a field that is PUBLIC by construction (allowlist below, each with its reason). PEM blocks are
// never allowed.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TOKEN_RE = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;
const PEM_RE = /-----BEGIN [A-Z0-9 ]*-----/;
const CANARY = "FAKE-SP6-CANARY-";

// Public-by-construction fields. Matched on the text right before the token, as JSON (`"f":"`, escaped `\"f\":\"`)
// or the signer's human output (`f: `).
const PUBLIC_FIELDS = {
  x: "Ed25519 public JWK coordinate — the public key itself",
  jkt: "RFC 7638 thumbprint of the public JWK",
  agent_key_jkt: "RFC 7638 thumbprint the signer echoes from the voucher",
  agentKeyJkt: "RFC 7638 thumbprint inside a voucher (public, sent to the merchant)",
  nonce: "PoP nonce the signer mints and the agent sends to the backend in the clear",
};
const fieldBefore = (text, at) => {
  const head = text.slice(Math.max(0, at - 40), at);
  const m = /(?:\\?"([A-Za-z_]+)\\?"\s*:\s*\\?"|(?:^|\\n|\n)([A-Za-z_]+): )$/.exec(head);
  return m ? m[1] ?? m[2] : null;
};

/** Offending tokens in one text (empty = clean). */
export function scanText(text) {
  const bad = [];
  if (PEM_RE.test(text)) bad.push("PEM block");
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m[0].startsWith(CANARY)) continue;
    const f = fieldBefore(text, m.index);
    if (f && Object.hasOwn(PUBLIC_FIELDS, f)) continue;
    bad.push(`${m[0].slice(0, 6)}… (43-char base64url${f ? ` in field ${f}` : ""})`);
  }
  return bad;
}

test("scanner: flags a bare 43-char base64url token and a PEM block; accepts canaries and public fields", () => {
  const seedShaped = "A".repeat(20) + "b".repeat(23);
  assert.equal(scanText(`--key ${seedShaped} --input -`).length, 1);
  assert.equal(scanText(`{"private_key_base64url":"${seedShaped}"}`).length, 1);
  const dashes = "-".repeat(5); // assembled at runtime so this file does not itself carry a PEM header
  assert.equal(scanText(`${dashes}BEGIN PRIVATE KEY${dashes}\nMC4CAQ\n`).length, 1);
  assert.deepEqual(scanText(`--key FAKE-SP6-CANARY-PRIV-INLINE-${"0".repeat(15)}`), []);
  assert.deepEqual(scanText(`{"x":"${seedShaped}","jkt":"${seedShaped}"}`), []);
  assert.deepEqual(scanText(`{\\"x\\":\\"${seedShaped}\\"}`), []);
  assert.deepEqual(scanText(`signer_protocol: sohopay-signer/1\nnonce: ${seedShaped}\n`), []);
});

test("I1: no committed file under evals/ carries real-looking key material", () => {
  const files = execFileSync("git", ["ls-files", "evals"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  assert.ok(files.length > 50);
  const findings = [];
  for (const f of files) {
    const hits = scanText(readFileSync(join(ROOT, f), "utf8"));
    if (hits.length) findings.push(`${f}: ${hits.join(", ")}`);
  }
  assert.deepEqual(findings, []);
});
