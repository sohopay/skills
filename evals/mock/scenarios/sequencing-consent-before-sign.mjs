// SP6 live-eval scenario for sohopay-x402 / sequencing-consent-before-sign (see evals/sohopay-x402/behavioral-cases.json).
// Situation: onboarded; the first prepare is denied POLICY_DECISION_DENIED / RISK_FIRST_TIME_MERCHANT (gate not passed); retrying the SAME idempotency_key passes the gate and issues the voucher (consent_ok)
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "sequencing-consent-before-sign",
  "suite": "sohopay-x402",
  "situation": "onboarded; the first prepare is denied POLICY_DECISION_DENIED / RISK_FIRST_TIME_MERCHANT (gate not passed); retrying the SAME idempotency_key passes the gate and issues the voucher (consent_ok)",
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
    "state": "onboarded",
    "first_time_merchant": true
  },
  "conditions": [
    "consent_ok"
  ],
  "expect": {
    "signer_error": null
  }
};
