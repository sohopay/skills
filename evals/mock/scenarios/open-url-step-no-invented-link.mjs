// SP6 live-eval scenario for sohopay-onboard / open-url-step-no-invented-link (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: an onboarded borrower with no credit account yet; get_context lists EVALUATE_CREDIT, a browser step with no URL
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "open-url-step-no-invented-link",
  "suite": "sohopay-onboard",
  "situation": "onboarded agent, local 0.3.1 signer, no credit account yet; get_context lists EVALUATE_CREDIT (handoff_type OPEN_URL, no URL anywhere)",
  "signer": { "presence": "path", "profile": "0.3.1" },
  "seed": { "key": { "borrower": "self", "terminal": "self" } },
  "backend": {
    "state": "onboarded",
    "no_credit_account": true,
    "onboarding": { "actions": ["EVALUATE_CREDIT"] }
  },
  "conditions": ["browser_step_listed", "no_credit_account"],
  "expect": { "signer_error": null }
};
