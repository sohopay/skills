// SP6 live-eval scenario for sohopay-x402 / pays-with-profile-incomplete (see evals/sohopay-x402/behavioral-cases.json).
// Situation: an onboarded agent (own key, ACTIVE grant) pays for a borrower whose profile is incomplete: get_context lists COMPLETE_PROFILE beside PAY (SOHO-461)
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "pays-with-profile-incomplete",
  "suite": "sohopay-x402",
  "situation": "an onboarded agent (own key, ACTIVE grant) pays for a borrower whose profile is incomplete: get_context lists COMPLETE_PROFILE and PAY together, and prepare issues a voucher as usual",
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
    "onboarding": {
      "profile_complete": false
    }
  },
  "conditions": [
    "profile_step_listed",
    "consent_ok"
  ],
  "expect": {
    "signer_error": null
  }
};
