import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const setup = read('plugins/sohopay/skills/sohopay-setup/SKILL.md');
const mobile = read('plugins/sohopay/skills/sohopay-setup/references/mobile-host-capabilities.md');
const onboard = read('plugins/sohopay/skills/sohopay-onboard/SKILL.md');
const prereqs = read('plugins/sohopay/skills/sohopay-setup/references/prereqs.md');
// Structural documentation guards, not a claim of live model/device evaluation.
test('setup capability gate precedes executable checklist and signer install', () => {
  assert.ok(setup.indexOf('Host capability gate:') < setup.indexOf('Execute this checklist'));
  assert.ok(setup.indexOf('Host capability gate:') < setup.indexOf('npm i -g'));
  assert.match(setup, /references\/mobile-host-capabilities\.md/);
});
test('unsupported mobile uses trusted website without tool-install claim', () => {
  assert.match(mobile, /official SohoPay website \(sohopay\.xyz\)/);
  assert.match(mobile, /This does not connect payment tools to this chat/);
  assert.match(mobile, /Do not invent an activation route, ticket, callback, or deep link/);
  assert.match(mobile, /Never claim that a hypothetical tool is callable/);
});
test('mobile readiness and signer custody remain fail closed', () => {
  for (const state of ['ACCOUNT_CREATED','IDENTITY_VERIFIED','BANK_CONNECTED','CREDIT_APPROVED','FACILITY_ACCEPTED','AGENT_AUTHORIZED','SIGNER_READY','PAYMENT_READY']) assert.ok(mobile.includes(state));
  assert.match(mobile, /SIGNER_READY.*false\/unverified/);
  assert.match(mobile, /Never fall back to a shared\/cloud-held signing key/);
  assert.match(mobile, /do not hold the model in a fifteen-minute polling loop/);
});
test('mobile onboard gate precedes desktop writes without replacing desktop protocol', () => {
  assert.ok(onboard.indexOf('Host capability gate:') < onboard.indexOf('Execute the numbered workflow'));
  assert.match(onboard, /register_borrower/);
  assert.match(onboard, /references\/workload-key\.md/);
  assert.match(onboard, /Desktop runtimes with the existing signer continue below unchanged/);
  assert.match(prereqs, /npm i -g @sohopay\/agent-signer@0\.3\.1/);
  assert.doesNotMatch(prereqs, /you are \*\*not\*\* a supported MCP client/);
});
test('generated hosted exports include native mobile gate', () => {
  assert.match(read('setup.md'), /## Mobile host capability gate/);
  assert.match(read('setup.md'), /#hosted-reference-mobile-host-capabilities/);
  assert.match(read('borrower-onboard.md'), /Host capability gate:/);
  assert.match(read('llms-full.txt'), /This does not connect payment tools to this chat/);
});
