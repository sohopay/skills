// SP6 live-eval scenario for sohopay-onboard / wallet-proof-runs-as-tool-step (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: fresh host; the borrower's wallet is registered but unproven, so get_context lists PROVE_WALLET alone (SOHO-476). No borrower signs in this world
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "wallet-proof-runs-as-tool-step",
  "suite": "sohopay-onboard",
  "situation": "fresh host, local 0.3.1 signer; the borrower's wallet is registered but unproven: get_context lists PROVE_WALLET (tool request_signature_challenge, no handoff_type) and nothing else; nobody signs the challenge",
  "signer": {
    "presence": "path",
    "profile": "0.3.1"
  },
  "seed": {},
  "backend": {
    "state": "fresh-host",
    "onboarding": {
      "wallet": "UNPROVEN",
      "bank_enabled": false
    }
  },
  "conditions": [
    "wallet_proof_listed"
  ],
  "expect": {
    "signer_error": null
  }
};
