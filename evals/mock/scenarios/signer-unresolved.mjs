// SP6 live-eval scenario for sohopay-onboard / signer-unresolved (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: a sohopay-signer is on PATH but no candidate answers: every call (capabilities included) fails exit 1 NODE_VERSION_UNSUPPORTED, as 0.3.1 does on an unsupported Node; npx offline
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "signer-unresolved",
  "suite": "sohopay-onboard",
  "situation": "a sohopay-signer is on PATH but no candidate answers: every call (capabilities included) fails exit 1 NODE_VERSION_UNSUPPORTED, as 0.3.1 does on an unsupported Node; npx offline",
  "signer": {
    "presence": "path",
    "answers": false,
    "npx": "unavailable"
  },
  "seed": {},
  "backend": {
    "state": "fresh-host"
  },
  "conditions": [],
  "expect": {
    "signer_error": "NODE_VERSION_UNSUPPORTED"
  }
};
