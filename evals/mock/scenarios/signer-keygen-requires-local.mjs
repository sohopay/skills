// SP6 live-eval scenario for sohopay-onboard / signer-keygen-requires-local (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: no sohopay-signer on PATH, SOHOPAY_SIGNER unset, and npx is offline (keygen forbids the npx tier anyway)
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "signer-keygen-requires-local",
  "suite": "sohopay-onboard",
  "situation": "no sohopay-signer on PATH, SOHOPAY_SIGNER unset, and npx is offline (keygen forbids the npx tier anyway)",
  "signer": {
    "presence": "absent",
    "npx": "unavailable"
  },
  "seed": {},
  "backend": {
    "state": "fresh-host"
  },
  "conditions": [],
  "expect": {
    "signer_error": null
  }
};
