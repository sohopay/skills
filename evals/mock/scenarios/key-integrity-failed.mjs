// SP6 live-eval scenario for sohopay-onboard / key-integrity-failed (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: the key at the canonical path is bound to this borrower+terminal but its stored jkt does not derive from its private key, so key generate returns KEY_INTEGRITY_FAILED
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "key-integrity-failed",
  "suite": "sohopay-onboard",
  "situation": "the key at the canonical path is bound to this borrower+terminal but its stored jkt does not derive from its private key, so key generate returns KEY_INTEGRITY_FAILED",
  "signer": {
    "presence": "path",
    "profile": "0.3.1"
  },
  "seed": {
    "key": {
      "borrower": "self",
      "terminal": "self",
      "tamper": true
    }
  },
  "backend": {
    "state": "fresh-host"
  },
  "conditions": [],
  "expect": {
    "signer_error": "KEY_INTEGRITY_FAILED"
  }
};
