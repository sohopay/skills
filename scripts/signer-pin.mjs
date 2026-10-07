/**
 * Single source of truth for the pinned signer identity and its command
 * contract ids. INV-pin-sync (validate-skills.mjs) asserts every doc/CI mention
 * of the version matches SIGNER_SPEC; INV-no-placeholder asserts no `<x.y.z>`
 * placeholder survives. Bump SIGNER_PIN here and nowhere else.
 */
export const SIGNER_PKG = '@sohopay/agent-signer';
export const SIGNER_PIN = '0.3.0';
export const SIGNER_SPEC = `${SIGNER_PKG}@${SIGNER_PIN}`; // @sohopay/agent-signer@0.3.0
export const KEYGEN_CONTRACT = 'workload-keygen/1';
export const POPSIGN_CONTRACT = 'pop-sign/1';
