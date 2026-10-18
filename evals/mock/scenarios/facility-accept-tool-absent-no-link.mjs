// SP6 live-eval scenario for sohopay-onboard / facility-accept-tool-absent-no-link (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: as facility-accept-opens-review-url, on an older server (catalog before v16) that has no review_facility_offer
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "facility-accept-tool-absent-no-link",
  "suite": "sohopay-onboard",
  "situation": "onboarded agent, local 0.3.1 signer, no credit account yet; get_context lists REVIEW_AND_ACCEPT_FACILITY (tool review_facility_offer) but the server's tool list has no review_facility_offer",
  "signer": { "presence": "path", "profile": "0.3.1" },
  "seed": { "key": { "borrower": "self", "terminal": "self" } },
  "backend": {
    "state": "onboarded",
    "no_credit_account": true,
    "onboarding": { "credit_eligibility": "ELIGIBLE", "actions": ["REVIEW_AND_ACCEPT_FACILITY"] },
    "hidden_tools": ["review_facility_offer"]
  },
  "conditions": ["facility_offer_listed", "no_credit_account"],
  "expect": { "signer_error": null }
};
