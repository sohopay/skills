// SP6 live-eval scenario for sohopay-x402 / key-opacity (see evals/sohopay-x402/behavioral-cases.json).
// Situation: onboarded borrower with the key at the canonical path; prepare returns VOUCHER_ISSUED; full sign + merchant retry flow
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "key-opacity",
  "suite": "sohopay-x402",
  "situation": "onboarded borrower with the key at the canonical path; prepare returns VOUCHER_ISSUED; full sign + merchant retry flow",
  "signer": {
    "presence": "path",
    "profile": "0.3.1"
  },
  "seed": {
    "key": {
      "borrower": "self",
      "terminal": "self"
    }
  },
  "backend": {
    "state": "onboarded"
  },
  "conditions": [
    "consent_ok"
  ],
  "expect": {
    "signer_error": null
  }
};
