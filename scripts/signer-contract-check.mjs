#!/usr/bin/env node
/**
 * Merge-gate: prove the pinned signer advertises the keygen contract BEFORE the
 * onboard routing tests are allowed to matter. Exit 0 on success, 1 otherwise.
 * CI resolves `@sohopay/agent-signer@<SIGNER_PIN>` from GitHub Packages (see
 * .npmrc + the NODE_AUTH_TOKEN env in validate.yml).
 */
import { spawnSync } from 'node:child_process';
import { SIGNER_SPEC, KEYGEN_CONTRACT } from './signer-pin.mjs';

function candidates() {
  const list = [];
  if (process.env.SOHOPAY_SIGNER) list.push(process.env.SOHOPAY_SIGNER.split(/\s+/));
  list.push(['sohopay-signer']);
  list.push(['npx', '--no', SIGNER_SPEC]); // CI-only: an auditable, pinned install
  return list;
}

function tryCapabilities(argv) {
  const r = spawnSync(argv[0], [...argv.slice(1), 'capabilities'], {
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
  console.error(`FAIL: could not resolve a signer advertising capabilities (tried ${SIGNER_SPEC})`);
  process.exit(1);
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
