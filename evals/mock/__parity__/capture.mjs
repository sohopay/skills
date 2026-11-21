#!/usr/bin/env node
// Offline, maintainer-run: record the REAL signer's behaviour for every parity case into real-<SIGNER_PIN>.json.
//   node evals/mock/__parity__/capture.mjs <path to a built @sohopay/agent-signer <SIGNER_PIN> checkout or unpacked tarball>
// Each case runs in a throwaway HOME + scratch dir under the OS temp dir (never the operator's ~/.agents).
// Not run in CI: CI compares the mock against the committed recording (parity.test.mjs).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PARITY_CASES, runCase } from "./cases.mjs";
import { SIGNER_PIN } from "../../../scripts/signer-pin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] ?? "");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (pkg.name !== "@sohopay/agent-signer" || pkg.version !== SIGNER_PIN) throw new Error(`expected @sohopay/agent-signer@${SIGNER_PIN} at ${root}, got ${pkg.name}@${pkg.version}`);
const cli = join(root, pkg.bin["sohopay-signer"]);

const exec = (argv, stdin, { env, cwd }) => {
  const r = spawnSync(process.execPath, [cli, ...argv], { input: stdin, env, cwd, encoding: "utf8" });
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.status };
};

const cases = {};
for (const c of PARITY_CASES) {
  const home = mkdtempSync(join(tmpdir(), "sp6-real-home-"));
  const dir = mkdtempSync(join(tmpdir(), "sp6-real-dir-"));
  try { cases[c.id] = runCase(c, exec, { home, dir }); } finally {
    rmSync(home, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true });
  }
}
const out = { signer: `${pkg.name}@${pkg.version}`, node: process.version, cases };
writeFileSync(join(HERE, `real-${SIGNER_PIN}.json`), `${JSON.stringify(out, null, 2)}\n`);
console.log(`recorded ${Object.keys(cases).length} cases`);
