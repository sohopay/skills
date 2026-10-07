// SP6 live-eval scenario for sohopay-onboard / signer-keygen-unsupported (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: a signer answers capabilities (the real 0.2.0 shape) but advertises no command_contracts["key generate"]
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "signer-keygen-unsupported",
  "suite": "sohopay-onboard",
  "situation": "a signer answers capabilities (the real 0.2.0 shape) but advertises no command_contracts[\"key generate\"]",
  "signer": {
    "presence": "path",
    "profile": "0.2.0"
  },
  "seed": {},
  "backend": {
    "state": "fresh-host"
  },
  "conditions": [
    "capabilities_missing_keygen"
  ],
  "expect": {
    "signer_error": null
  }
};
