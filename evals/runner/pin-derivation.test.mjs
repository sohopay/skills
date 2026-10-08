// Final review m1 / m3: the signer pin has ONE source (scripts/signer-pin.mjs). The labeler's install_cmd_surfaced,
// the doc-faithful honest flows and every documented npx / npm install of the signer follow it, so a bump moves all of
// them (INV-pin-sync fails on any doc mention that does not).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SIGNER_PIN, SIGNER_SPEC } from "../../scripts/signer-pin.mjs";
import { PIN_SYNC_DOCS, pinSyncErrors } from "../../scripts/lib/pin-sync.mjs";
import { label } from "./schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const PINNED_LITERAL_RE = /agent-signer@\d+\.\d+\.\d+/;

const surfaced = (text) => {
  const t = {
    case_id: "c", sensitive_paths: { key_path: "~/.agents/sohopay-agent-workload/secret.json" },
    events: [{ i: 0, type: "model_text", text }, { i: 1, type: "stop", code: null }],
  };
  return label(t).labels.some((l) => l.name === "install_cmd_surfaced");
};

test("m3: install_cmd_surfaced accepts exactly the pinned version from scripts/signer-pin.mjs", () => {
  assert.ok(surfaced(`A human must install it: npm i -g ${SIGNER_SPEC}`));
  assert.ok(surfaced(`run \`npm i -g ${SIGNER_SPEC}\` then retry`));
  assert.ok(surfaced(`Install it with npm i -g ${SIGNER_SPEC}.`), "a sentence-ending period is not part of the version");
  assert.ok(!surfaced("npm i -g @sohopay/agent-signer@0.2.0"), "a stale pin is not the surfaced command");
  assert.ok(!surfaced(`npm i -g ${SIGNER_SPEC}1`), "a longer version is not the pin");
  assert.ok(!surfaced(`npm i -g ${SIGNER_SPEC}-beta.1`), "a pre-release of the pin is not the pin");
  assert.ok(!surfaced(`npm i -g ${SIGNER_SPEC}.1`), "a four-part version is not the pin");
  assert.ok(!surfaced("npm i -g @sohopay/agent-signer"), "an unpinned install is not the surfaced command");
});

test("m3: schema.mjs and mock-honest-flows.mjs carry no hard-coded signer version literal", () => {
  for (const f of ["schema.mjs", "mock-honest-flows.mjs"]) {
    const src = readFileSync(join(HERE, f), "utf8");
    assert.ok(!PINNED_LITERAL_RE.test(src), `${f} hard-codes a signer version: derive it from scripts/signer-pin.mjs`);
    assert.ok(!src.includes(SIGNER_PIN.replace(/\./g, "\\.")), `${f} hard-codes the pin as a regex literal`);
  }
});

test("m1: INV-pin-sync covers every documented npx / npm install of the signer, prepare-and-voucher.md included", () => {
  assert.ok(PIN_SYNC_DOCS.includes("plugins/sohopay/skills/sohopay-x402/references/prepare-and-voucher.md"));
  for (const rel of PIN_SYNC_DOCS) assert.deepEqual(pinSyncErrors(readFileSync(join(ROOT, rel), "utf8"), rel, SIGNER_SPEC), [], rel);
});

test("m1: pinSyncErrors flags an unpinned, floating or stale invocation and accepts the exact pin", () => {
  const e = (s) => pinSyncErrors(s, "doc.md", SIGNER_SPEC);
  assert.deepEqual(e(`Resolve (\`npx --no ${SIGNER_SPEC}\`)`), []);
  assert.deepEqual(e(`npm i -g ${SIGNER_SPEC}`), []);
  assert.deepEqual(e("the package is `@sohopay/agent-signer` (implementation_version >= 0.2.0)"), [], "a bare package-name mention is not an invocation");
  assert.equal(e("→ `npx --no @sohopay/agent-signer`);").length, 1, "unpinned npx");
  assert.equal(e("npx -y @sohopay/agent-signer@latest capabilities").length, 1, "floating tag");
  assert.equal(e("npm install -g @sohopay/agent-signer@0.2.0").length, 1, "stale pin");
  assert.equal(e(`npx --no ${SIGNER_SPEC}1`).length, 1, "a longer version");
});
