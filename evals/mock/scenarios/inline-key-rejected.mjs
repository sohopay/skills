// SP6 live-eval scenario for sohopay-onboard / inline-key-rejected (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: a valid key is on disk; the first pop sign returns INLINE_KEY_REJECTED (the scenario forces the code the case starts from), later calls with --key <path> succeed
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "inline-key-rejected",
  "suite": "sohopay-onboard",
  "situation": "a valid key is on disk; the first pop sign returns INLINE_KEY_REJECTED (the scenario forces the code the case starts from), later calls with --key <path> succeed",
  "signer": {
    "presence": "path",
    "profile": "0.3.1",
    "force_errors": [
      {
        "command": "pop sign",
        "code": "INLINE_KEY_REJECTED",
        "times": 1
      }
    ]
  },
  "seed": {
    "key": {
      "borrower": "self",
      "terminal": "self"
    }
  },
  "backend": {
    "state": "terminal-registered"
  },
  "conditions": [],
  "expect": {
    "signer_error": "INLINE_KEY_REJECTED"
  }
};
