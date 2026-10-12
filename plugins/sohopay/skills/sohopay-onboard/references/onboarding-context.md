## Reading `onboarding` from `get_context`

Some deployments add an `onboarding` section to `get_context`. When it is absent, ignore this reference.

| Field | Meaning |
|---|---|
| `verification_tier` | Which verified sources the borrower has: `PHONE_ONLY`, `WALLET_VERIFIED`, `FINANCIAL_VERIFIED`, `MULTI_SOURCE_VERIFIED`. Coverage, not credit quality. |
| `profile_complete` | The borrower declared their legal name and date of birth. Absent when the deployment does not track it. Not identity or credit approval. |
| `credit_eligibility` | `status` (`NOT_EVALUATED`, `IN_REVIEW`, `ELIGIBLE`, `INELIGIBLE`) and an opaque `band`. Never a score; do not interpret the band. |
| `spend_ready` | Onboarding gates for spending are passed. Not the same as `purchasing_power.can_pay`: decide whether to pay from `can_pay`, and `prepare_x402_payment` stays authoritative. |

### Browser steps (`handoff_type: "OPEN_URL"`)

A next action with `handoff_type: "OPEN_URL"` is a step the borrower does on a SohoPay browser page.

| Action | What to report to the operator |
|---|---|
| `COMPLETE_PROFILE` | The borrower needs to enter their legal name and date of birth in SohoPay. Comes before any other step below. |
| `CONNECT_WALLET` / `CONNECT_BANK` | The borrower needs to connect a wallet or a bank. Either one is enough. |
| `EVALUATE_CREDIT` | The borrower needs to ask SohoPay to evaluate them for credit. |
| `REVIEW_CREDIT_OFFER` | An offer is waiting for the borrower to review. |

### Wallet proof (`PROVE_WALLET`)

`PROVE_WALLET` is not a browser step. It carries `tool: "request_signature_challenge"` and no `handoff_type`. It means the borrower's wallet is registered and only its ownership proof is missing: run the wallet-proof step (`request_signature_challenge` → the borrower signs → `submit_signature`). Never fabricate the signature. `CONNECT_BANK` may be listed alongside it, because a bank is an alternative source; report it, and still run the proof.

`CONNECT_WALLET` is for a borrower with no wallet. The two are never listed together.

### Rules

- Do not attempt an `OPEN_URL` step yourself: report it to the operator. Never ask for a legal name, date of birth or bank details in chat, and never invent a link.
- Keep doing any `PAY`, repayment or handle action that is listed alongside it. An `OPEN_URL` action only stops the work that depends on it; wait for the borrower only when nothing else is listed.
- These hints never change the numbered onboarding steps.
- `IN_REVIEW` or `INELIGIBLE` with no action listed means there is nothing to do; say so plainly. Do not retry or ask for more data.
