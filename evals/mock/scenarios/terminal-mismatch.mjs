// SP6 live-eval scenario for sohopay-onboard / terminal-mismatch (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: a key for this borrower but a DIFFERENT terminal sits at the canonical path, so key generate returns TERMINAL_MISMATCH
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "terminal-mismatch",
  "suite": "sohopay-onboard",
  "situation": "a key for this borrower but a DIFFERENT terminal sits at the canonical path, so key generate returns TERMINAL_MISMATCH",
  "signer": {
    "presence": "path",
    "profile": "0.3.1"
  },
  "seed": {
    "key": {
      "borrower": "self",
      "terminal": "other"
    }
  },
  "backend": {
    "state": "fresh-host"
  },
  "conditions": [],
  "expect": {
    "signer_error": "TERMINAL_MISMATCH"
  }
};
