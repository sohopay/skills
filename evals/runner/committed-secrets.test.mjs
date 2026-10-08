// Task 14 review I1 / N1 / N2 (scanner in committed-secrets.mjs): nothing committed under evals/ may look like real key
// material.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ANT_KEY_RE, scanCommitted, scanText } from "./committed-secrets.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

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

test("K1: a base64 key glued to a prefix via `=` is flagged (boundary no longer blind to the `=` glue)", () => {
  // The old B64 boundary excluded `=`, so a key run immediately after a `=` was never matched. `=` is only base64
  // padding (trailing), never a run start, so there is no legitimate reason to blind the scanner to a run after it.
  assert.equal(scanText(`KEY=${SEED}`).length, 1, "assignment glue");
  assert.equal(scanText(`--key=${SEED}`).length, 1, "flag=value glue");
  assert.equal(scanText(`d=${SEED}`).length, 1, "secret-ish field via =");
  assert.equal(scanText(`SIGNER_PRIVATE_KEY=${SEED44}`).length, 1, "env-var glue, padded");
  // The offset-based public-field allowlist must survive the boundary change: a public id in its recognized
  // `field: value` form stays exempt (the scanner recognizes `:`-delimited public fields, not `=`).
  assert.deepEqual(scanText(`jkt: ${SEED}`), [], "public field in recognized form is still exempt");
});

test("K2: hex runs of 64+ chars are flagged, including a 128-char expanded key", () => {
  const HEX128 = "9f".repeat(64);
  assert.equal(scanText(`priv=${HEX128}`).length, 1, "128-char hex");
  assert.equal(scanText(`sig: ${HEX128}`).length, 1, "128-char hex after a colon label (no public hex128 field)");
  // A 40-char hex (an eth address) is below the floor and still ignored.
  assert.deepEqual(scanText(`addr=${"ab".repeat(20)}`), []);
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

// Final review I1: honest live goldens must pass. The public MCP / x402 identifiers appear in both casings (MCP args and
// signer stdout are snake_case, vouchers camelCase); a public field still passes only with no secret-ish ancestor.
// Model prose (model_text) passes an id-shaped token only when the SAME value sits in a public field elsewhere in the
// transcript, so a model summarising its payment passes while an unexplained key-shaped token in prose is flagged.
const H1 = "a1".repeat(32);
const H2 = "b2".repeat(32);
const H3 = "c3".repeat(32);
const jt = (o) => scanText(JSON.stringify(o), { json: true });
const call = (args) => ({ i: 0, type: "tool_call", name: "mcp__sohopay__prepare_x402_payment", args, args_text: JSON.stringify(args) });

test("I1: public MCP / x402 id fields pass in snake_case and camelCase, structurally", () => {
  const ids = { order_ref: `0x${H1}`, orderRef: `0x${H1}`, payment_id: `0x${H2}`, paymentId: `0x${H2}`, merchant_id: `0x${H3}`, merchantId: `0x${H3}`,
    agent_key_jkt: SEED, agentKeyJkt: SEED, jkt: SEED, nonce: SEED, pop_signature: `${SEED}${SEED}`, settlement_id: `0x${H2}`, tx_hash: `0x${H1}`, txHash: `0x${H1}` };
  assert.deepEqual(jt({ events: [call(ids)] }), []);
  for (const [k, v] of Object.entries(ids)) assert.equal(jt({ events: [call({ secrets: { [k]: v } })] }).length, 2, `${k} under a secret-ish ancestor (args + args_text)`);
});

test("I1: the reviewer's flagged cases pass — order_ref in prepare args, and a model summary naming the payment id and jkt", () => {
  const t = {
    meta: { adapter: "claude-code" },
    events: [
      call({ merchant: "m", amount: "1", order_ref: `0x${H1}` }),
      { i: 1, type: "tool_result", call_i: 0, text: JSON.stringify({ status: "VOUCHER_ISSUED", payment_id: `0x${H2}`, voucher: { paymentId: `0x${H2}`, agentKeyJkt: SEED, orderRef: `0x${H1}` } }) },
      { i: 2, type: "model_text", text: `Paid. payment_id 0x${H2} for order ${H1}; signed with key ${SEED}.\nDone.` },
    ],
  };
  assert.deepEqual(jt(t), []);
});

test("I1: a planted seed under order_ref inside a secrets ancestor still fails, and so does its echo in prose", () => {
  assert.equal(jt({ secrets: { order_ref: SEED } }).length, 1);
  const t = { events: [{ i: 0, type: "tool_result", call_i: 0, text: JSON.stringify({ secrets: { order_ref: `0x${H1}` } }) }, { i: 1, type: "model_text", text: `order 0x${H1}` }] };
  assert.equal(jt(t).length, 2, "the secret-ancestor value is not admitted as a public value for prose");
});

test("I1: a key-shaped token in prose fails unless its value appears in a public field", () => {
  assert.equal(jt({ events: [{ i: 0, type: "model_text", text: `The key is ${H3}.` }] }).length, 1, "random 64-hex");
  assert.equal(jt({ events: [{ i: 0, type: "model_text", text: `payment_id: 0x${H3}` }] }).length, 1, "a public-looking label in prose does not excuse it");
  assert.equal(jt({ events: [{ i: 0, type: "model_text", text: `seed ${SEED}` }] }).length, 1, "43-char base64");
  assert.equal(jt({ events: [{ i: 0, type: "model_text", text: `{"jkt":"${SEED}"}` }] }).length, 1, "JSON pasted in prose is still prose");
  assert.deepEqual(jt({ events: [call({ jkt: SEED }), { i: 1, type: "model_text", text: `{"jkt":"${SEED}"}` }] }), []);
  assert.equal(jt({ events: [call({ jkt: SEED }), { i: 1, type: "model_text", text: `0x${SEED}` }] }).length, 0, "an 0x prefix in prose is normalized away");
});
