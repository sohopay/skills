// Task 14 review I1 / N1 / N2: nothing committed under evals/ may look like real key material.
//
// Key-shaped tokens: base64 / base64url runs of 43–44 chars (a 32-byte Ed25519 seed, padded or not) or 86–88 chars
// (64-byte material: an expanded private key or a signature), and 64-char hex runs (a 32-byte secret in hex). PEM
// headers are never allowed. A key-shaped token passes only if it carries the FAKE-SP6-CANARY- prefix, or sits in a
// field that is PUBLIC by construction (PUBLIC_FIELDS, each with its reason) AND no enclosing key is secret-ish
// (`secret`, `private`, `d`, `key_material`, …), AND, for a JWK `x`, the JWK carries no `d`.
// JSON files are walked structurally (strings holding embedded JSON are parsed and walked too), so the ancestor rule is
// exact. Other text (signer human output inside a JSON string, .mjs/.md files) is matched on the field name written
// right before the token, and the token's line must not mention a secret-ish name.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const B64_RUN_RE = /(?<![A-Za-z0-9_+/=-])[A-Za-z0-9_+/-]+={0,2}(?![A-Za-z0-9_+/=-])/g;
const HEX64_RE = /(?<![0-9A-Fa-f])[0-9A-Fa-f]{64}(?![0-9A-Fa-f])/g;
const KEY_LENGTHS = new Set([43, 44, 86, 87, 88]);
const PEM_RE = /-----BEGIN [A-Z0-9 ]*-----/;
// Anthropic API keys (`sk-ant-api03-…`, `sk-ant-admin01-…`): flagged in any context, whatever field holds them.
const ANT_KEY_RE = /sk-ant-[A-Za-z0-9_-]{20,}/;
const CANARY = "FAKE-SP6-CANARY-";
const SECRETISH_RE = /secret|private|^d$|key_material/i;

const PUBLIC_FIELDS = {
  x: "Ed25519 public JWK coordinate (only inside a JWK that carries no d)",
  jkt: "RFC 7638 thumbprint of a public JWK",
  agent_key_jkt: "RFC 7638 thumbprint the signer echoes from the voucher",
  agentKeyJkt: "RFC 7638 thumbprint inside a voucher (public, sent to the merchant)",
  nonce: "PoP nonce the signer mints and the agent sends to the backend in the clear",
  pop_signature: "Ed25519 PoP signature, sent to the backend in the clear",
  signature: "Ed25519 voucher signature, carried in the public payment envelope",
  payment_id: "keccak256 payment id (0x-hex), public on-chain identifier",
  paymentId: "keccak256 payment id inside a voucher (0x-hex), public",
  merchantId: "bytes32 merchant registry id inside a voucher (0x-hex), public on-chain",
  orderRef: "bytes32 merchant order reference inside a voucher (0x-hex), public",
  expect_hash: "sha256 of a case's expect text (assertions.json)",
  skill_hash: "sha256 of a suite's skill closure (golden meta)",
};

/** Key-shaped tokens in a string, each with its offset. */
function keyShaped(s) {
  const out = [];
  for (const m of s.matchAll(B64_RUN_RE)) {
    const t = m[0];
    // Random key material mixes cases and digits; this keeps word-ish runs (paths, identifiers) out.
    if (KEY_LENGTHS.has(t.length) && /[A-Z]/.test(t) && /[a-z]/.test(t) && /[0-9]/.test(t)) out.push({ t, at: m.index, kind: `${t.length}-char base64` });
  }
  for (const m of s.matchAll(HEX64_RE)) out.push({ t: m[0], at: m.index, kind: "64-char hex" });
  return out;
}
const fieldBefore = (text, at) => {
  const head = text.slice(Math.max(0, at - 48), at);
  const m = /(?:\\?"([A-Za-z_]+)\\?"\s*:\s*\\?"(?:0x)?|(?:^|\\n|\n)([A-Za-z_]+): (?:0x)?)$/.exec(head);
  return m ? m[1] ?? m[2] : null;
};
const lineOf = (text, at) => text.slice(text.lastIndexOf("\n", at) + 1, (text.indexOf("\n", at) + 1 || text.length + 1) - 1);
const tryJson = (s) => { const t = s.trim(); if (!/^[[{]/.test(t)) return undefined; try { return JSON.parse(t); } catch { return undefined; } };

/** Flat text (non-JSON): field-name allowlist, and no secret-ish name on the token's line. */
function scanFlat(text, ancestors, bad) {
  for (const { t, at, kind } of keyShaped(text)) {
    if (t.startsWith(CANARY)) continue;
    const f = fieldBefore(text, at);
    const ok = f && Object.hasOwn(PUBLIC_FIELDS, f) && f !== "x" && !ancestors.some((a) => SECRETISH_RE.test(a)) &&
      !SECRETISH_RE.test(lineOf(text, at).replace(/\b(?:secret\.json|sohopay-agent-workload)\b/g, ""));
    if (!ok) bad.push(`${t.slice(0, 6)}… (${kind}${f ? ` after ${f}` : ""}${ancestors.length ? ` under ${ancestors.join(".")}` : ""})`);
  }
}

/** Structural walk: `ancestors` are the enclosing keys, `parent` the object holding the current value. */
function walk(v, ancestors, parent, bad) {
  if (Array.isArray(v)) { v.forEach((x) => walk(x, ancestors, null, bad)); return; }
  if (v && typeof v === "object") { for (const [k, x] of Object.entries(v)) walk(x, [...ancestors, k], v, bad); return; }
  if (typeof v !== "string") return;
  const embedded = tryJson(v);
  if (embedded !== undefined) { walk(embedded, ancestors, null, bad); return; }
  const key = ancestors[ancestors.length - 1];
  // Signer human output: `field: <json>` lines carry structured values (e.g. `public_jwk: {"kty":…,"x":…}`).
  if (v.includes("\n") || /^[A-Za-z_]+: [[{]/.test(v)) {
    const flat = [];
    for (const line of v.split("\n")) {
      const m = /^([A-Za-z_]+): ([[{].*)$/.exec(line);
      const inner = m && tryJson(m[2]);
      if (inner !== undefined && inner !== null) walk(inner, [...ancestors, m[1]], null, bad);
      else flat.push(line);
    }
    scanFlat(flat.join("\n"), ancestors, bad);
    return;
  }
  const whole = keyShaped(v);
  if (whole.length === 1 && whole[0].t.length === v.replace(/^0x/, "").length) {
    if (v.startsWith(CANARY)) return;
    const above = ancestors.slice(0, -1);
    const publicField = Object.hasOwn(PUBLIC_FIELDS, key) && !above.some((a) => SECRETISH_RE.test(a));
    const jwkOk = key !== "x" || (parent && parent.kty !== undefined && !("d" in parent));
    if (!(publicField && jwkOk)) bad.push(`${v.slice(0, 6)}… (${whole[0].kind} at ${ancestors.join(".")})`);
    return;
  }
  scanFlat(v, ancestors, bad);
}

/**
 * A committed file's findings. One path is allowlisted, with its reason: evals/live-workflow.sha256 is the T17 hash pin
 * of the live workflow (a PUBLIC digest of a committed file), accepted only in exact `sha256sum` format.
 */
const PIN_PATH = "evals/live-workflow.sha256";
const PIN_RE = /^[0-9a-f]{64} {2}\.github\/workflows\/evals-live\.yml\n?$/;
export function scanCommitted(rel, text) {
  if (rel === PIN_PATH && PIN_RE.test(text)) return [];
  return scanText(text, { json: rel.endsWith(".json") });
}

/** Offending tokens in one file's text (empty = clean). JSON is walked structurally. */
export function scanText(text, { json = false } = {}) {
  const bad = [];
  if (PEM_RE.test(text)) bad.push("PEM block");
  for (const _ of text.matchAll(new RegExp(ANT_KEY_RE.source, "g"))) bad.push("Anthropic API key (sk-ant-…)");
  const doc = json ? tryJson(text) : undefined;
  if (doc !== undefined) walk(doc, [], null, bad);
  else scanFlat(text, [], bad);
  return bad;
}

// A 43-char key-shaped test token, assembled at runtime so this file does not itself carry one.
const SEED = ["Kq3Zr8Lm2Q", "p5Tn7Vb3Xc", "9Hd1Jf4Kg6", "Sw0Ya8Eu2I", "o5P"].join("");
const SEED44 = `${SEED}A`;
const HEX = "9f".repeat(32);

test("scanner: flags key-shaped tokens (43/44, 86–88 base64, 64 hex) and PEM; accepts canaries", () => {
  assert.equal(SEED.length, 43);
  assert.equal(scanText(`--key ${SEED} --input -`).length, 1);
  assert.equal(scanText(`--key ${SEED44} --input -`).length, 1, "44-char");
  assert.equal(scanText(`--key ${SEED.replace(/_/g, "/")}= --input -`).length, 1, "padded standard base64");
  assert.equal(scanText(`blob ${SEED}${SEED} end`).length, 1, "86-char");
  assert.equal(scanText(`priv=${HEX}`).length, 1, "64-hex");
  const dashes = "-".repeat(5); // assembled at runtime so this file does not itself carry a PEM header
  assert.equal(scanText(`${dashes}BEGIN PRIVATE KEY${dashes}\nMC4CAQ\n`).length, 1);
  assert.deepEqual(scanText(`--key FAKE-SP6-CANARY-INLINE-${"x0".repeat(10)}`), []);
  assert.deepEqual(scanText("evals/sohopay-onboard/transcripts/adversarial/register-fails"), [], "paths are not key material");
});

test("scanner: public fields pass only in their public form (N2)", () => {
  const j = (o) => scanText(JSON.stringify(o), { json: true });
  assert.deepEqual(j({ public_jwk: { kty: "OKP", crv: "Ed25519", x: SEED }, jkt: SEED, nonce: SEED, payment_id: `0x${HEX}` }), []);
  assert.deepEqual(j({ events: [{ text: JSON.stringify({ public_jwk: { kty: "OKP", x: SEED }, jkt: SEED }) }] }), [], "embedded JSON");
  assert.deepEqual(j({ events: [{ text: `jkt: ${SEED}\nnonce: ${SEED}\n` }] }), [], "signer human output");
  assert.deepEqual(j({ events: [{ text: `public_jwk: {"kty":"OKP","crv":"Ed25519","x":"${SEED}"}\njkt: ${SEED}\n` }] }), [], "human public_jwk line");
  assert.equal(j({ events: [{ text: `public_jwk: {"kty":"OKP","x":"${SEED}","d":"${SEED}"}\n` }] }).length, 2, "human JWK line with d");
  assert.equal(j({ jwk: { kty: "OKP", crv: "Ed25519", x: SEED, d: SEED44 } }).length, 2, "a d-bearing JWK: x and d both flagged");
  assert.equal(j({ jwk: { kty: "OKP", crv: "Ed25519", x: SEED, d: "short" } }).length, 1, "x in a d-bearing JWK fails");
  assert.equal(j({ secrets: { jkt: SEED } }).length, 1, "a seed under jkt nested in secrets fails");
  assert.equal(j({ private_key: { nonce: SEED } }).length, 1);
  assert.equal(j({ x: SEED }).length, 1, "x outside a JWK fails");
  assert.equal(j({ private_key_base64url: SEED }).length, 1);
  assert.equal(scanText(`{"secret": {"jkt": "${SEED}"}}`).length, 1, "flat text: secret-ish name on the line");
  assert.equal(scanText(`const seed = "${SEED}";`).length, 1, "flat text: no public field");
});

const committed = () => execFileSync("git", ["ls-files", "evals"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
const scanFile = (f) => scanCommitted(f, readFileSync(join(ROOT, f), "utf8"));

test("T17 N1: the workflow hash pin is allowlisted ONLY at its exact path and ONLY in exact sha256sum format", () => {
  const good = `${HEX}  .github/workflows/evals-live.yml\n`;
  assert.deepEqual(scanCommitted("evals/live-workflow.sha256", good), [], "the pin itself");
  assert.deepEqual(scanCommitted("evals/live-workflow.sha256", good.trimEnd()), [], "no trailing newline");
  assert.equal(scanCommitted("evals/other.sha256", good).length, 1, "any other path with a 64-hex token is still flagged");
  assert.equal(scanCommitted("evals/runner/live-workflow.sha256", good).length, 1, "same basename elsewhere is flagged");
  assert.ok(scanCommitted("evals/live-workflow.sha256", `${good}${HEX}\n`).length >= 1, "an extra token in the pin file is flagged");
  assert.ok(scanCommitted("evals/live-workflow.sha256", `${HEX}  .github/workflows/evals-live.yml extra\n`).length >= 1, "trailing junk is flagged");
  assert.ok(scanCommitted("evals/live-workflow.sha256", `${HEX.toUpperCase()}  .github/workflows/evals-live.yml\n`).length >= 1, "upper-case hex is not the sha256sum format");
  assert.ok(scanCommitted("evals/live-workflow.sha256", `${HEX} .github/workflows/evals-live.yml\n`).length >= 1, "one space is not the sha256sum format");
  assert.ok(scanCommitted("evals/live-workflow.sha256", `${HEX}  .github/workflows/validate.yml\n`).length >= 1, "a pin for another file is flagged");
});

// T17 C1: an Anthropic API key (`sk-ant-…`, ~108 chars) is not caught by the length-based rule above. Assembled at
// runtime so this file carries none.
const ANT = ["sk", "ant", "api03", "Lp3Wq8Zx1Cv6Bn9Mk2Jh7Gf4Ds0Ae5Ry8Tu3Io6Pl1Kj9Hg4Fd2Sa7Qw0Ez5Xc3Vb8Nm"].join("-");

test("C1: the scanner flags Anthropic API keys (sk-ant-…) anywhere — bare, in JSON, in env-dump text — and leaves short mentions alone", () => {
  assert.ok(scanText(`ANTHROPIC_API_KEY=${ANT}`).some((f) => /Anthropic API key/.test(f)));
  assert.ok(scanText(JSON.stringify({ events: [{ stdout: `x ${ANT} y` }] }), { json: true }).some((f) => /Anthropic API key/.test(f)));
  assert.ok(scanText(JSON.stringify({ jkt: ANT }), { json: true }).some((f) => /Anthropic API key/.test(f)), "a public field name does not excuse it");
  assert.deepEqual(scanText("keys look like sk-ant-api03-…; never commit one"), []);
  assert.ok(!scanText(`k=${ANT}`).join(" ").includes(ANT.slice(14, 30)), "findings never echo the key");
});

test("C1: no committed file ANYWHERE in the repo carries an Anthropic API key", () => {
  const all = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const hits = all.filter((f) => { try { return ANT_KEY_RE.test(readFileSync(join(ROOT, f), "utf8")); } catch { return false; } });
  assert.deepEqual(hits, []);
});

test("I1/N1: no committed file under evals/ carries real-looking key material", () => {
  const files = committed();
  assert.ok(files.length > 50);
  const findings = files.flatMap((f) => { const hits = scanFile(f); return hits.length ? [`${f}: ${hits.join(", ")}`] : []; });
  assert.deepEqual(findings, []);
});
