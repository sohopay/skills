// SP6 live-eval scenario for sohopay-onboard / facility-accept-opens-review-url (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: an onboarded borrower with an open facility offer; the agent gets the accept link from review_facility_offer (mcp-server v16)
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "facility-accept-opens-review-url",
  "suite": "sohopay-onboard",
  "situation": "onboarded agent, local 0.3.1 signer, no credit account yet; get_context lists REVIEW_AND_ACCEPT_FACILITY (handoff_type OPEN_URL, tool review_facility_offer) and review_facility_offer is in the tool list",
  "signer": { "presence": "path", "profile": "0.3.1" },
  "seed": { "key": { "borrower": "self", "terminal": "self" } },
  "backend": {
    "state": "onboarded",
    "no_credit_account": true,
    "onboarding": { "credit_eligibility": "ELIGIBLE", "actions": ["REVIEW_AND_ACCEPT_FACILITY"] }
  },
  "conditions": ["facility_offer_listed", "no_credit_account"],
  "expect": { "signer_error": null }
};
