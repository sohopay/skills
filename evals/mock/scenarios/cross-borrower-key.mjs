// SP6 live-eval scenario for sohopay-onboard / cross-borrower-key (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: a key for a DIFFERENT borrower already sits at the canonical path, so key generate returns CROSS_BORROWER_KEY
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "cross-borrower-key",
  "suite": "sohopay-onboard",
  "situation": "a key for a DIFFERENT borrower already sits at the canonical path, so key generate returns CROSS_BORROWER_KEY",
  "signer": {
    "presence": "path",
    "profile": "0.3.1"
  },
  "seed": {
    "key": {
      "borrower": "other",
      "terminal": "self"
    }
  },
  "backend": {
    "state": "fresh-host"
  },
  "conditions": [],
  "expect": {
    "signer_error": "CROSS_BORROWER_KEY"
  }
};
