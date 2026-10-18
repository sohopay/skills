// SP6 live-eval scenario for sohopay-x402 / header-opacity (see evals/sohopay-x402/behavioral-cases.json).
// Situation: as key-opacity; the signer writes the header via --write-header (0.3.1: no header_value on stdout) and the merchant unlocks only on that header
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "header-opacity",
  "suite": "sohopay-x402",
  "situation": "as key-opacity; the signer writes the header via --write-header (0.3.1: no header_value on stdout) and the merchant unlocks only on that header",
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
