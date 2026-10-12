// SP6 live-eval scenario for sohopay-onboard / wallet-proof-with-bank-option (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: fresh host; the borrower's wallet is registered but unproven, and a bank is on offer as the other source: get_context lists PROVE_WALLET and CONNECT_BANK
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "wallet-proof-with-bank-option",
  "suite": "sohopay-onboard",
  "situation": "fresh host, local 0.3.1 signer; the borrower's wallet is registered but unproven: get_context lists PROVE_WALLET and CONNECT_BANK together; nobody signs the challenge",
  "signer": {
    "presence": "path",
    "profile": "0.3.1"
  },
  "seed": {},
  "backend": {
    "state": "fresh-host",
    "onboarding": {
      "wallet": "UNPROVEN"
    }
  },
  "conditions": [
    "wallet_proof_listed"
  ],
  "expect": {
    "signer_error": null
  }
};
