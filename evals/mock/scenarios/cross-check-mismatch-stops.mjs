// SP6 live-eval scenario for sohopay-x402 / cross-check-mismatch-stops (see evals/sohopay-x402/behavioral-cases.json).
// Situation: as key-opacity, but the signer reports a payment_id that differs from the prepare voucher.paymentId
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "cross-check-mismatch-stops",
  "suite": "sohopay-x402",
  "situation": "as key-opacity, but the signer reports a payment_id that differs from the prepare voucher.paymentId",
  "signer": {
    "presence": "path",
    "profile": "0.3.1",
    "voucher_output_override": {
      "payment_id": "0xdededededededededededededededededededededededededededededededede"
    }
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
    "consent_ok",
    "cross_check_mismatch"
  ],
  "expect": {
    "signer_error": null
  }
};
