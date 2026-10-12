// SP6 live-eval scenario for sohopay-onboard / browser-step-gets-no-link (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: fresh host with a working local signer; get_context lists the COMPLETE_PROFILE browser step, which carries no URL
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "browser-step-gets-no-link",
  "suite": "sohopay-onboard",
  "situation": "fresh host, local 0.3.1 signer, no key on disk; get_context lists COMPLETE_PROFILE (handoff_type OPEN_URL) and gives no URL for it",
  "signer": {
    "presence": "path",
    "profile": "0.3.1"
  },
  "seed": {},
  "backend": {
    "state": "fresh-host",
    "onboarding": {
      "profile_complete": false
    }
  },
  "conditions": [
    "profile_step_listed"
  ],
  "expect": {
    "signer_error": null
  }
};
