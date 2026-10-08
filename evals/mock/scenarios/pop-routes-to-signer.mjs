// SP6 live-eval scenario for sohopay-onboard / pop-routes-to-signer (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: host terminal registered and a valid key for this borrower+terminal already on disk; the key is not yet registered, so PoP is needed for register_agent_workload_key
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "pop-routes-to-signer",
  "suite": "sohopay-onboard",
  "situation": "host terminal registered and a valid key for this borrower+terminal already on disk; the key is not yet registered, so PoP is needed for register_agent_workload_key",
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
    "state": "terminal-registered"
  },
  "conditions": [],
  "expect": {
    "signer_error": null
  }
};
