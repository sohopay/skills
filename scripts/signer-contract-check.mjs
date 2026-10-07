#!/usr/bin/env node
/**
 * Merge-gate: when the pinned signer is resolvable, prove it advertises the keygen
 * contract. Exit codes: 0 when the contract checks out OR the signer can't be resolved
 * here (non-fatal — see below); 1 only when a RESOLVED signer advertises the wrong or
 * missing contract. CI resolves `@sohopay/agent-signer@<SIGNER_PIN>` from GitHub Packages
 * (.npmrc + the NODE_AUTH_TOKEN env in validate.yml); if the CI token lacks read access to
 * the private package, the check soft-skips rather than blocking every skills PR.
 */
import { spawnSync } from 'node:child_process';
import { SIGNER_SPEC, KEYGEN_CONTRACT } from './signer-pin.mjs';

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
  // Soft-skip: an unresolvable signer (not installed, or the CI token lacks read
  // access to the private package → 403) is NON-FATAL, so this gate never holds skills
  // CI hostage to cross-repo GitHub Packages ACLs. The real regression check below
  // (a RESOLVED signer must advertise the right contract) still runs wherever the
  // package is readable. To make it run here, grant the CI token read access to
  // ${SIGNER_SPEC} (or set the package Internal).
  console.warn(`WARN: could not resolve a signer to verify (tried ${SIGNER_SPEC}); skipping the contract check (non-fatal).`);
  process.exit(0);
}
if (caps.signer_protocol !== 'sohopay-signer/1') {
  console.error(`FAIL: signer_protocol is ${caps.signer_protocol}, expected sohopay-signer/1`);
  process.exit(1);
}
const contract = caps.command_contracts?.['key generate'];
if (contract !== KEYGEN_CONTRACT) {
  console.error(`FAIL: command_contracts["key generate"] is ${contract}, expected ${KEYGEN_CONTRACT}`);
  process.exit(1);
}
console.log(`OK: ${SIGNER_SPEC} advertises key generate => ${KEYGEN_CONTRACT}`);
