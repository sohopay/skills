// SP6 live-eval scenario for sohopay-onboard / register-fails-then-retry-reuses-key (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: fresh host; key generate succeeds (created:true) but the first register_agent_workload_key fails (upstream 503); the retry's key generate returns created:false with the same jkt
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "register-fails-then-retry-reuses-key",
  "suite": "sohopay-onboard",
  "situation": "fresh host; key generate succeeds (created:true) but the first register_agent_workload_key fails (upstream 503); the retry's key generate returns created:false with the same jkt",
  "signer": {
    "presence": "path",
    "profile": "0.3.1"
  },
  "seed": {},
  "backend": {
    "state": "fresh-host",
    "register_fail_times": 1
  },
  "conditions": [
    "register_failed"
  ],
  "expect": {
    "signer_error": null
  }
};
