// SP6 live-eval scenario for sohopay-onboard / connect-wallet-opens-handoff-url (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: as connect-wallet-no-signature-request; the agent gets the connect link from start_browser_handoff (mcp-server v15)
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "connect-wallet-opens-handoff-url",
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
