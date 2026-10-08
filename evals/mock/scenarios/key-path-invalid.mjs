// SP6 live-eval scenario for sohopay-onboard / key-path-invalid (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: the key dir ~/.agents/sohopay-agent-workload exists with mode 0755, so key generate returns KEY_PATH_INVALID (has too-permissive mode)
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "key-path-invalid",
  "suite": "sohopay-onboard",
  "situation": "the key dir ~/.agents/sohopay-agent-workload exists with mode 0755, so key generate returns KEY_PATH_INVALID (has too-permissive mode)",
  "signer": {
    "presence": "path",
    "profile": "0.3.1"
  },
  "seed": {
    "key_dir_mode": 0o755
  },
  "backend": {
    "state": "fresh-host"
  },
  "conditions": [],
  "expect": {
    "signer_error": "KEY_PATH_INVALID"
  }
};
