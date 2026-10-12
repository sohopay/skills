// SP6 live-eval scenario for sohopay-x402 / no-credit-account-stops (see evals/sohopay-x402/behavioral-cases.json).
// Situation: an onboarded agent (own key, ACTIVE grant) pays for a borrower with no credit account (SOHO-473)
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "no-credit-account-stops",
  "suite": "sohopay-x402",
  "situation": "an onboarded agent (own key, ACTIVE grant) pays for a borrower with no credit account: get_context money sections are null and prepare answers CREDIT_ACCOUNT_NOT_FOUND",
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
    "no_credit_account": true
  },
  "conditions": [
    "no_credit_account"
  ],
  "expect": {
    "signer_error": null
  }
};
