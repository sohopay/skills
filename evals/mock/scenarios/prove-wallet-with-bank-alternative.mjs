// SP6 live-eval scenario for sohopay-onboard / prove-wallet-with-bank-alternative (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: as prove-wallet-runs-wallet-proof, with CONNECT_BANK listed beside PROVE_WALLET as the alternative source
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "prove-wallet-with-bank-alternative",
  "suite": "sohopay-onboard",
  "situation": "fresh host, local 0.3.1 signer, no credit account; wallet registered but unproven: get_context lists PROVE_WALLET and CONNECT_BANK (handoff_type OPEN_URL); no borrower signs the challenge in this run",
  "signer": { "presence": "path", "profile": "0.3.1" },
  "seed": {},
  "backend": {
    "state": "fresh-host",
    "no_credit_account": true,
    "onboarding": { "wallet": "UNPROVEN", "actions": ["PROVE_WALLET", "CONNECT_BANK"] }
  },
  "conditions": ["prove_wallet_listed", "browser_step_listed", "no_credit_account"],
  "expect": { "signer_error": null }
};
