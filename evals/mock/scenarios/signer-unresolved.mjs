// SP6 live-eval scenario for sohopay-onboard / signer-unresolved (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: a sohopay-signer IS installed locally (on PATH) but no candidate answers: the global install is missing a dependency, so every call (capabilities included) dies in Node with ERR_MODULE_NOT_FOUND, exit 1, no JSON; npx offline. Installed-but-not-answering ⇒ SIGNER_UNRESOLVED (workload-key.md), not REQUIRES_LOCAL.
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "signer-unresolved",
  "suite": "sohopay-onboard",
  "situation": "a sohopay-signer is installed on PATH but does not answer: its global install is missing @noble/curves, so every call (capabilities included) fails in Node with ERR_MODULE_NOT_FOUND (exit 1, no JSON on stdout); npx offline",
  "signer": {
    "presence": "path",
    "answers": false,
    "npx": "unavailable"
  },
  "seed": {},
  "backend": {
    "state": "fresh-host"
  },
  "conditions": [],
  "expect": {
    "signer_error": null,
    "stderr_match": "Error \\[ERR_MODULE_NOT_FOUND\\]: Cannot find package '@noble/curves'"
  }
};
