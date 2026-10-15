## Reading `onboarding` from `get_context`

Some deployments add an `onboarding` section to `get_context`. When it is absent, ignore this reference, except "No credit account yet" below, which applies on every deployment.

| Field | Meaning |
|---|---|
| `verification_tier` | Which verified sources the borrower has: `PHONE_ONLY`, `WALLET_VERIFIED`, `FINANCIAL_VERIFIED`, `MULTI_SOURCE_VERIFIED`. Coverage, not credit quality. |
| `profile_complete` | The borrower declared their legal name and date of birth. Absent when the deployment does not track it. Not identity or credit approval. |
| `credit_eligibility` | `status` (`NOT_EVALUATED`, `IN_REVIEW`, `ELIGIBLE`, `INELIGIBLE`) and an opaque `band`. Never a score; do not interpret the band. |
| `spend_ready` | Onboarding gates for spending are passed. Not the same as `purchasing_power.can_pay`: decide whether to pay from `can_pay`, and `prepare_x402_payment` stays authoritative. |

### No credit account yet (`credit: null`)

A registered borrower with no credit account gets `credit: null` and `repayment: null`, with `purchasing_power.can_pay` false. That is a normal state, not an error: there is no credit limit, credit balance or credit debt to report yet. Tell the operator there is no credit line yet and follow the listed next actions. If none are listed, there is nothing to do yet; say so plainly. Never present it as a zero limit or a zero balance.

This covers the borrower's own credit only. Gifts they have received still count: when the `gifts` section is `supported` and `gifts.available` is above zero (a `GIFT_RECEIVED` action is listed), report that balance. Gift value cannot be spent until the borrower has a credit account, so do not attempt a payment: report the balance and follow the listed next actions.

### Browser steps (`handoff_type: "OPEN_URL"`)

A next action with `handoff_type: "OPEN_URL"` is a step the borrower does on a SohoPay browser page.

| Action | What to report to the operator |
|---|---|
| `COMPLETE_PROFILE` | The borrower needs to enter their legal name and date of birth in SohoPay. Comes before any other step below. |
| `CONNECT_WALLET` / `CONNECT_BANK` | Call `start_browser_handoff` and open `open_url` verbatim. Either connection is enough. |
| `EVALUATE_CREDIT` | The borrower needs to ask SohoPay to evaluate them for credit. |
| `REVIEW_CREDIT_OFFER` | An offer is waiting for the borrower to review. |

### Wallet proof (`PROVE_WALLET`)

`PROVE_WALLET` is not a browser step. It carries `tool: "request_signature_challenge"` and no `handoff_type`. Its `handoff_required` is `true` only because the borrower signs; there is no page to send them to. It means the borrower's wallet is registered and only its ownership proof is missing: run the wallet-proof step (`request_signature_challenge` → the borrower signs → `submit_signature`). Never fabricate the signature. `CONNECT_BANK` may be listed alongside it, because a bank is an alternative source; report it, and still run the proof.

`CONNECT_WALLET` is for a borrower with no wallet. The two are never listed together.

### Rules

- For `CONNECT_WALLET` or `CONNECT_BANK`, call `start_browser_handoff` (no action argument; the backend chooses the current step) and open `open_url` verbatim. After the borrower returns, call `get_context` again. Never invent a link. Never ask for a legal name, date of birth, bank details, or a passkey in chat.
- Other `OPEN_URL` steps (`COMPLETE_PROFILE`, `EVALUATE_CREDIT`, `REVIEW_CREDIT_OFFER`): report them. Do not invent a link. `PROVE_WALLET` stays on `request_signature_challenge` / `submit_signature`.
- Keep doing any `PAY`, repayment or handle action that is listed alongside it. An `OPEN_URL` action only stops the work that depends on it; wait for the borrower only when nothing else is listed.
- These hints never change the numbered onboarding steps. If `PROVE_WALLET` is not listed (a deployment may not enable it), the wallet-proof step still runs whenever `wallet_proof_verified` is false.
- `IN_REVIEW` or `INELIGIBLE` with no action listed means there is nothing to do; say so plainly. Do not retry or ask for more data.
