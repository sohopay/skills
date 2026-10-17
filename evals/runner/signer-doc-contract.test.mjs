// The pinned signer, the parity recording and signer.md's "Consume the output" section describe one contract.
//   1. The parity recording (evals/mock/__parity__/real-<pin>.json) is of the pinned version (scripts/signer-pin.mjs),
//      so a pin bump without a re-capture/re-verify fails here.
//   2. Under `--write-header` the doc names only stdout fields the recorded signer prints: every backticked
//      snake_case field the section's intro lists as present is in the recorded field set, `header_file` is named,
//      and each credential field the signer omits (header_value / envelope / signature) is named only as absent.
//   3. The cross-check steps read only fields that exist under `--write-header`.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SIGNER_PIN, SIGNER_SPEC } from "../../scripts/signer-pin.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RECORDING = join(ROOT, "evals/mock/__parity__", `real-${SIGNER_PIN}.json`);
const SIGNER_MD = join(ROOT, "plugins/sohopay/skills/sohopay-x402/references/signer.md");

/** Field names the recorded signer prints for `voucher sign --envelope --write-header --output json`. */
function writeHeaderFields() {
  const steps = JSON.parse(readFileSync(RECORDING, "utf8")).cases["voucher-envelope-write-header-json"];
  const step = steps.find((s) => s.argv.includes("--write-header") && s.argv.includes("json") && s.exitCode === 0);
  return new Set(Object.keys(JSON.parse(step.stdout)));
}

/** Field names the recorded signer prints for `voucher sign --envelope --output json` (no --write-header). */
function envelopeFields() {
  const r = JSON.parse(readFileSync(RECORDING, "utf8")).cases;
  for (const steps of Object.values(r))
    for (const s of steps)
      if (s.argv.includes("--envelope") && !s.argv.includes("--write-header") && s.argv.includes("json") && s.exitCode === 0)
        return new Set(Object.keys(JSON.parse(s.stdout)));
  throw new Error("no envelope-mode json step without --write-header in the recording");
}

/** The "Consume the output and retry" section: { intro, steps }. */
function consumeSection() {
  const md = readFileSync(SIGNER_MD, "utf8");
  const start = md.indexOf("### Consume the output");
  assert.ok(start >= 0, "signer.md has no Consume the output section");
  const end = md.indexOf("\n### ", start + 1);
  const body = md.slice(start, end < 0 ? undefined : end);
  const firstStep = body.search(/\n1\. /);
  return { intro: body.slice(0, firstStep), steps: body.slice(firstStep) };
}

const NEGATION = /\b(no|not|never|without|omits?|drops?)\b/i;
// A snake_case identifier opening a code span: `payment_id`, or `header_name === "…"`.
const tokens = (s) => [...s.matchAll(/`([a-z][a-z0-9_]*)/g)].map((m) => m[1]).filter((t) => t.includes("_"));

test("the parity recording exists for the pinned signer version", () => {
  assert.ok(existsSync(RECORDING), `no parity recording for ${SIGNER_SPEC} at ${RECORDING}`);
  assert.equal(JSON.parse(readFileSync(RECORDING, "utf8")).signer, SIGNER_SPEC);
});

test("signer.md Consume the output: lists only fields the signer prints under --write-header", () => {
  const present = writeHeaderFields();
  const { intro } = consumeSection();
  assert.match(intro, /--write-header/, "the intro must say which mode it describes");
  assert.ok(tokens(intro).includes("header_file"), "the intro must name header_file");
  for (const sentence of intro.split(/(?<=[.;])\s+/)) {
    for (const t of tokens(sentence)) {
      if (present.has(t)) continue;
      assert.match(sentence, NEGATION, `"${t}" is not printed under --write-header; it may appear only as absent: ${sentence.trim()}`);
    }
  }
});

test("signer.md Consume the output: names every credential field the signer withholds under --write-header as absent", () => {
  const present = writeHeaderFields();
  const withheld = [...envelopeFields()].filter((f) => !present.has(f));
  assert.ok(withheld.includes("header_value"), "recording sanity: header_value must be withheld under --write-header");
  const { intro } = consumeSection();
  for (const f of withheld) {
    const sentence = intro.split(/(?<=[.;])\s+/).find((s) => s.includes(`\`${f}\``));
    assert.ok(sentence && NEGATION.test(sentence), `the intro must state that \`${f}\` is not on stdout under --write-header`);
  }
});

test("signer.md Consume the output: the cross-check steps read only fields that exist under --write-header", () => {
  const present = writeHeaderFields();
  const { steps } = consumeSection();
  // Steps 1–2 are the checks the agent runs on the signer's stdout.
  const checks = steps.split(/\n3\. /)[0];
  const read = tokens(checks).filter((t) => !t.startsWith("voucher"));
  assert.ok(read.includes("payment_id") && read.includes("agent_key_jkt") && read.includes("header_name"));
  for (const t of read) assert.ok(present.has(t), `cross-check reads \`${t}\`, which the signer does not print under --write-header`);
});
