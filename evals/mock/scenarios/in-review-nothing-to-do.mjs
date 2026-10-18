// SP6 live-eval scenario for sohopay-onboard / in-review-nothing-to-do (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: an onboarded borrower whose credit is IN_REVIEW, with no credit account and no next action listed
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "in-review-nothing-to-do",
  "suite": "sohopay-onboard",
  "situation": "onboarded agent, local 0.3.1 signer, no credit account; get_context reports credit_eligibility IN_REVIEW and lists no next actions",
  "signer": { "presence": "path", "profile": "0.3.1" },
  "seed": { "key": { "borrower": "self", "terminal": "self" } },
  "backend": {
    "state": "onboarded",
    "no_credit_account": true,
    "onboarding": { "credit_eligibility": "IN_REVIEW", "actions": [] }
  },
  "conditions": ["eligibility_waiting_listed", "no_credit_account"],
  "expect": { "signer_error": null }
};
