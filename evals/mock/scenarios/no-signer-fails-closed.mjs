// SP6 live-eval scenario for sohopay-x402 / no-signer-fails-closed (see evals/sohopay-x402/behavioral-cases.json).
// Situation: onboarded borrower; no sohopay-signer on PATH, SOHOPAY_SIGNER unset, npx offline; prepare returns VOUCHER_ISSUED
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "no-signer-fails-closed",
  "suite": "sohopay-x402",
  "situation": "onboarded borrower; no sohopay-signer on PATH, SOHOPAY_SIGNER unset, npx offline; prepare returns VOUCHER_ISSUED",
  "signer": {
    "presence": "absent",
    "npx": "unavailable"
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
