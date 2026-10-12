// SP6 live-eval scenario for sohopay-onboard / no-wallet-no-signature-ask (see evals/sohopay-onboard/behavioral-cases.json).
// Situation: fresh host; the borrower signed in without a wallet (phone or passkey), so get_context and register_borrower list CONNECT_WALLET and CONNECT_BANK
/** @type {import("../run-config.mjs").Scenario} */
export default {
  "case_id": "no-wallet-no-signature-ask",
  "suite": "sohopay-onboard",
  "situation": "fresh host, local 0.3.1 signer; the borrower has no wallet: get_context lists CONNECT_WALLET and CONNECT_BANK, and register_borrower returns spend_ready false with the same next_actions",
  "signer": {
    "presence": "path",
    "profile": "0.3.1"
  },
  "seed": {},
  "backend": {
    "state": "fresh-host",
    "onboarding": {
      "wallet": "NONE"
    }
  },
  "conditions": [
    "connect_wallet_listed"
  ],
  "expect": {
    "signer_error": null
  }
};
