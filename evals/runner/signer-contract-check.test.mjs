// scripts/signer-contract-check.mjs (merge gate): a RESOLVED signer must be the pinned version, not just any signer
// advertising the keygen contract; an unresolvable signer stays a soft skip. Stub signers are offered through
// $SOHOPAY_SIGNER, and PATH holds only an empty dir so neither `sohopay-signer` nor the `npx` tier can resolve.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KEYGEN_CONTRACT, SIGNER_PIN, SIGNER_SPEC } from "../../scripts/signer-pin.mjs";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "signer-contract-check.mjs");

/** Run the gate with an optional stub signer whose `capabilities --output json` prints `caps`. */
function runGate(caps) {
  const dir = mkdtempSync(join(tmpdir(), "sp6-contract-check-"));
  try {
    const pathDir = mkdtempSync(join(dir, "path-"));
    const env = { PATH: pathDir, HOME: dir };
    if (caps) {
      const stub = join(dir, "stub-signer.mjs");
      writeFileSync(stub, `process.stdout.write(${JSON.stringify(JSON.stringify(caps))});\n`);
      env.SOHOPAY_SIGNER = `${process.execPath} ${stub}`;
    }
    const r = spawnSync(process.execPath, [SCRIPT], { env, encoding: "utf8", timeout: 30_000 });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const caps = (version) => ({
  signer_protocol: "sohopay-signer/1",
  implementation: "@sohopay/agent-signer",
  implementation_version: version,
  command_contracts: { "key generate": KEYGEN_CONTRACT, "pop sign": "pop-sign/1" },
});

test("contract check: a resolved signer at the pin with the keygen contract passes", () => {
  const r = runGate(caps(SIGNER_PIN));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^OK: /m);
});

test("contract check: a resolved signer at a different version hard-fails, even with the right contract", () => {
  const r = runGate(caps("0.2.0"));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /FAIL: implementation_version is 0\.2\.0/);
  assert.ok(r.out.includes(SIGNER_PIN), `the failure names the pin ${SIGNER_SPEC}: ${r.out}`);
});

test("contract check: a resolved signer with no implementation_version hard-fails", () => {
  const c = caps(SIGNER_PIN);
  delete c.implementation_version;
  const r = runGate(c);
  assert.equal(r.code, 1, r.out);
});

test("contract check: no resolvable signer stays a soft skip (exit 0, WARN)", () => {
  const r = runGate(null);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /WARN: could not resolve a signer/);
});
