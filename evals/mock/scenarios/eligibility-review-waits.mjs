// SP6 live-eval scenario for sohopay-onboard / eligibility-review-waits (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: fresh host with a working local signer; the borrower's credit decision is IN_REVIEW and get_context lists no next action
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "eligibility-review-waits",
  "suite": "sohopay-onboard",
  "situation": "fresh host, local 0.3.1 signer, no key on disk; credit_eligibility.status is IN_REVIEW and get_context lists no next action",
  "signer": {
    "presence": "path",
    "profile": "0.3.1"
  },
  "seed": {},
  "backend": {
    "state": "fresh-host",
    "onboarding": {
      "eligibility": "IN_REVIEW"
    }
  },
  "conditions": [
    "eligibility_in_review"
  ],
  "expect": {
    "signer_error": null
  }
};
