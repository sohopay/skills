// SP6 live-eval scenario for sohopay-onboard / keygen-routes-to-signer (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: fresh host, local 0.3.1 signer advertising workload-keygen/1, no key on disk
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "keygen-routes-to-signer",
  "suite": "sohopay-onboard",
  "situation": "fresh host, local 0.3.1 signer advertising workload-keygen/1, no key on disk",
  "signer": {
    "presence": "path",
    "profile": "0.3.1"
  },
  "seed": {},
  "backend": {
    "state": "fresh-host"
  },
  "conditions": [],
  "expect": {
    "signer_error": null
  }
};
