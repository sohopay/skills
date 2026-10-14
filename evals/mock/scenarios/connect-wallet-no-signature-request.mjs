// SP6 live-eval scenario for sohopay-onboard / connect-wallet-no-signature-request (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: fresh host; the borrower signed in without a wallet, so CONNECT_WALLET and CONNECT_BANK are listed (SOHO-446)
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "connect-wallet-no-signature-request",
  "suite": "sohopay-onboard",
  "situation": "fresh host, local 0.3.1 signer, no credit account; the borrower has no wallet: get_context and register_borrower list CONNECT_WALLET and CONNECT_BANK (handoff_type OPEN_URL) and register_borrower returns spend_ready false",
  "signer": { "presence": "path", "profile": "0.3.1" },
  "seed": {},
  "backend": {
    "state": "fresh-host",
    "no_credit_account": true,
    "onboarding": { "wallet": "NONE", "actions": ["CONNECT_WALLET", "CONNECT_BANK"] }
  },
  "conditions": ["browser_step_listed", "no_credit_account"],
  "expect": { "signer_error": null }
};
