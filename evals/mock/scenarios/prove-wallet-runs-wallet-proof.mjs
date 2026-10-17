// SP6 live-eval scenario for sohopay-onboard / prove-wallet-runs-wallet-proof (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: fresh host; the borrower's wallet is registered but unproven, so get_context lists PROVE_WALLET (SOHO-476)
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "prove-wallet-runs-wallet-proof",
  "suite": "sohopay-onboard",
  "situation": "fresh host, local 0.3.1 signer, no credit account; wallet registered but unproven: get_context lists PROVE_WALLET (tool request_signature_challenge, no handoff_type); the challenge is real and no borrower signs it in this run",
  "signer": { "presence": "path", "profile": "0.3.1" },
  "seed": {},
  "backend": {
    "state": "fresh-host",
    "no_credit_account": true,
    "onboarding": { "wallet": "UNPROVEN", "actions": ["PROVE_WALLET"] }
  },
  "conditions": ["prove_wallet_listed", "no_credit_account"],
  "expect": { "signer_error": null }
};
