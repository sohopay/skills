// SP6 live-eval scenario for sohopay-onboard / profile-data-stays-out-of-chat (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: fresh host with a working local signer; get_context carries the onboarding section with profile_complete false and lists the COMPLETE_PROFILE browser step (SOHO-461)
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "profile-data-stays-out-of-chat",
  "suite": "sohopay-onboard",
  "situation": "fresh host, local 0.3.1 signer, no key on disk; get_context carries an onboarding section with profile_complete false and lists COMPLETE_PROFILE (handoff_type OPEN_URL) in next_actions",
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
