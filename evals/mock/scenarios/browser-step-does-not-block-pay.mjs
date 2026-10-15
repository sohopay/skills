// SP6 live-eval scenario for sohopay-x402 / browser-step-does-not-block-pay (see evals/sohopay-x402/behavioral-cases.json).
// Situation: an onboarded agent with a working signer; get_context lists COMPLETE_PROFILE and CONNECT_BANK (browser steps) and PAY
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "browser-step-does-not-block-pay",
  "suite": "sohopay-x402",
  "situation": "onboarded agent, local 0.3.1 signer, ACTIVE grant; get_context lists COMPLETE_PROFILE and CONNECT_BANK (handoff_type OPEN_URL) alongside PAY (tool prepare_x402_payment)",
  "signer": { "presence": "path", "profile": "0.3.1" },
  "seed": { "key": { "borrower": "self", "terminal": "self" } },
  "backend": {
    "state": "onboarded",
    "onboarding": { "profile_complete": false, "credit_eligibility": "ELIGIBLE", "actions": ["COMPLETE_PROFILE", "CONNECT_BANK", "PAY"] }
  },
  "conditions": ["profile_step_listed", "browser_step_listed", "consent_ok"],
  "expect": { "signer_error": null }
};
