#!/usr/bin/env node
/**
 * Merge-gate: when the pinned signer is resolvable, prove it advertises the keygen
 * contract. Exit codes: 0 when the contract checks out OR the signer can't be resolved
 * here (non-fatal — see below); 1 only when a RESOLVED signer advertises the wrong or
 * missing contract, or is not the pinned version. CI resolves `@sohopay/agent-signer@<SIGNER_PIN>` from GitHub Packages
 * (.npmrc + the NODE_AUTH_TOKEN env in validate.yml); if the CI token lacks read access to
 * the private package, the check soft-skips rather than blocking every skills PR.
 */
import { spawnSync } from 'node:child_process';
import { SIGNER_PIN, SIGNER_SPEC, SIGNER_PKG, KEYGEN_CONTRACT, POPSIGN_CONTRACT } from './signer-pin.mjs';

function candidates() {
  const list = [];
  if (process.env.SOHOPAY_SIGNER) list.push(process.env.SOHOPAY_SIGNER.split(/\s+/));
  list.push(['sohopay-signer']);
  // CI-only: `--yes` installs + runs the exact pinned spec non-interactively from
  // GitHub Packages (.npmrc + NODE_AUTH_TOKEN in validate.yml). `--no` would refuse to
  // install a signer that is merely resolvable and fail the gate closed on a clean runner;
  // this is a read-only `capabilities` probe of a pinned version, so fetching is allowed.
  // (The secret-WRITING `key generate` still forbids the npx tier — that gate lives in the
  // onboard/x402 skill docs, not here.)
  list.push(['npx', '--yes', SIGNER_SPEC]);
  return list;
}

function tryCapabilities(argv) {
  // The signer's `capabilities` defaults to human-readable text; `--output json` is
  // required for the JSON we parse below (the arg parser accepts the flag anywhere).
  const r = spawnSync(argv[0], [...argv.slice(1), 'capabilities', '--output', 'json'], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (r.status !== 0 || !r.stdout) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

let caps = null;
for (const argv of candidates()) {
  caps = tryCapabilities(argv);
  if (caps) break;
}

if (!caps) {
  // Local dev soft-skips an unresolvable signer (not installed, or the CI token lacks read
  // access to the private package → 403) so the gate never holds a local run hostage to
  // cross-repo GitHub Packages ACLs. In CI the signer MUST resolve: a silent soft-skip there
  // would let the contract gap ship green, so emit a GitHub `::error::` annotation and fail.
  // The real regression check below (a RESOLVED signer must advertise the right contract) still
  // runs wherever the package is readable; to make it run in CI, grant the CI token read access
  // to ${SIGNER_SPEC} (or set the package Internal).
  const msg = `could not resolve a signer to verify (tried ${SIGNER_SPEC})`;
  if (process.env.CI) {
    console.error(`::error::signer contract check: ${msg}; grant the CI token read access to ${SIGNER_SPEC} (or set the package Internal) so the contract gate is not silently skipped`);
    process.exit(1);
  }
  console.warn(`WARN: ${msg}; skipping the contract check (non-fatal, local dev).`);
  process.exit(0);
}
if (caps.signer_protocol !== 'sohopay-signer/1') {
  console.error(`FAIL: signer_protocol is ${caps.signer_protocol}, expected sohopay-signer/1`);
  process.exit(1);
}
// A binary merely reporting the signer version string must not pass: require it to name itself
// as the pinned implementation package, not just answer the capabilities probe.
if (caps.implementation !== SIGNER_PKG) {
  console.error(`FAIL: implementation is ${caps.implementation}, expected ${SIGNER_PKG}`);
  process.exit(1);
}
// The gate proves the PINNED signer exactly (==, not >=): a resolved signer of any other version
// (e.g. one already on PATH, or a bumped version whose pin was not updated here) must fail rather
// than pass the gate without exercising the pin. Intent confirmed — the npx tier installs the exact
// SIGNER_SPEC, so a version mismatch only ever means a stale PATH/override signer slipped through.
if (caps.implementation_version !== SIGNER_PIN) {
  console.error(`FAIL: implementation_version is ${caps.implementation_version}, expected the pin ${SIGNER_PIN} (${SIGNER_SPEC})`);
  process.exit(1);
}
const contract = caps.command_contracts?.['key generate'];
if (contract !== KEYGEN_CONTRACT) {
  console.error(`FAIL: command_contracts["key generate"] is ${contract}, expected ${KEYGEN_CONTRACT}`);
  process.exit(1);
}
// Also verify the PoP contract: the signer must advertise `pop sign` at the pinned contract id,
// not merely `key generate` — both are part of the SP1 signer contract the pin stands behind.
const popContract = caps.command_contracts?.['pop sign'];
if (popContract !== POPSIGN_CONTRACT) {
  console.error(`FAIL: command_contracts["pop sign"] is ${popContract}, expected ${POPSIGN_CONTRACT}`);
  process.exit(1);
}
console.log(`OK: ${SIGNER_SPEC} advertises key generate => ${KEYGEN_CONTRACT}, pop sign => ${POPSIGN_CONTRACT}`);
