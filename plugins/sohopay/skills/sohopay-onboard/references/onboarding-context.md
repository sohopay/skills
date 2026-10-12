## Reading `onboarding` from `get_context`

Some deployments add an `onboarding` section to `get_context`. When it is absent, ignore this reference.

| Field | Meaning |
|---|---|
| `verification_tier` | Which verified sources the borrower has: `PHONE_ONLY`, `WALLET_VERIFIED`, `FINANCIAL_VERIFIED`, `MULTI_SOURCE_VERIFIED`. Coverage, not credit quality. |
| `profile_complete` | The borrower declared their legal name and date of birth. Absent when the deployment does not track it. Not identity or credit approval. |
| `credit_eligibility` | `status` (`NOT_EVALUATED`, `IN_REVIEW`, `ELIGIBLE`, `INELIGIBLE`) and an opaque `band`. Never a score; do not interpret the band. |
| `spend_ready` | Onboarding gates for spending are passed. Not the same as `purchasing_power.can_pay`. |

### Browser steps (`handoff_type: "OPEN_URL"`)

A next action with `handoff_type: "OPEN_URL"` is a step the borrower does on a SohoPay browser page.

| Action | What to tell the borrower |
|---|---|
| `COMPLETE_PROFILE` | They need to enter their legal name and date of birth in SohoPay. Comes before any other step below. |
| `CONNECT_WALLET` / `CONNECT_BANK` | They need to connect a wallet or a bank. Either one is enough. |
| `EVALUATE_CREDIT` | They need to ask SohoPay to evaluate them for credit. |
| `REVIEW_CREDIT_OFFER` | An offer is waiting for them to review. |

### Rules

- **STOP** on any `OPEN_URL` action: report it to the operator and wait. Never ask for a legal name, date of birth or bank details in chat, and never invent a link.
- `IN_REVIEW` or `INELIGIBLE` with no action listed means there is nothing to do; say so plainly. Do not retry or ask for more data.
- These hints do not take away other listed actions. If `PAY` or a repayment action is also listed, it is still available.
