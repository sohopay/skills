// SP6 live-eval scenario for sohopay-onboard / signer-keygen-requires-local (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: no sohopay-signer on PATH until the agent runs the pinned npm install. npx stays offline.
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "signer-keygen-requires-local",
  "suite": "sohopay-onboard",
  "situation": "no sohopay-signer on PATH until the pinned npm install; SOHOPAY_SIGNER unset; npx offline",
  "signer": {
    "presence": "absent",
    "npx": "unavailable",
    "npmInstall": "pinned"
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
