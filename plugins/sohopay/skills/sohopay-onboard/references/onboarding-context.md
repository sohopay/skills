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

| Action | What to do |
|---|---|
| `COMPLETE_PROFILE` | Report it: the borrower needs to enter their legal name and date of birth in SohoPay. Comes before any other step below. |
| `CONNECT_WALLET` / `CONNECT_BANK` | Get the borrower a link with `start_browser_handoff` (see "Connect link" below). Either connection is enough for **evidence**; it does **not** by itself activate spendable credit. |
| `EVALUATE_CREDIT` | Report it: the borrower needs to ask SohoPay to evaluate them for credit. |
| `REVIEW_CREDIT_OFFER` | Report it: an offer is waiting for the borrower to review. |

Only `CONNECT_WALLET` and `CONNECT_BANK` have a link tool (`start_browser_handoff`). For the other OPEN_URL steps there is no link to give: report the step and never invent one.

### Facility acceptance (`REVIEW_AND_ACCEPT_FACILITY`)

`REVIEW_AND_ACCEPT_FACILITY` is not an `OPEN_URL` step. The backend lists `tool: "review_facility_offer"`, which is **not** an MCP tool — do not call it. Report that the borrower must review and accept the facility offer; there is no link to give. Until acceptance completes, there is no credit line (`credit` is null) and `can_pay` is false, even when wallet or bank sources are connected. Linking a source is evidence only, not spendable credit.

### Connect link (`start_browser_handoff`)

1. If your tool list has no `start_browser_handoff` (an older server), report the step as the borrower's to do in SohoPay and give no link.
2. Call `start_browser_handoff` with a fresh `idempotency_key`. It takes no action argument: the backend picks the current connect step and returns `action`, `open_url` and `expires_at`. Tell the borrower which connection the link is for (`action`).
3. Open `open_url` for the borrower exactly as returned, the same way as the agent-grant consent page. If you cannot open a browser, give it to the borrower verbatim. Never shorten, rewrite or rebuild it, and never drop its `#…` part. It is single-use and bound to this borrower: give it to no one else, and do not fetch it with your own tools.
4. Do not poll. Ask the borrower to tell you when they have finished in the browser, then call `get_context` again and follow what it lists.
5. `409 NO_BROWSER_HANDOFF` means no connect step is current any more (your `get_context` is out of date). Call `get_context` again. Do not retry the handoff.
6. If the link is past `expires_at`, or the borrower lost it, call `start_browser_handoff` again with a **new** `idempotency_key`. Reusing the old key returns the same expired link.
7. Do not call it when `PROVE_WALLET` is listed. Run the wallet proof instead, and only call `start_browser_handoff` if the borrower chooses to connect a bank instead (see below).

### Wallet proof (`PROVE_WALLET`)

`PROVE_WALLET` is not a browser step. It carries `tool: "request_signature_challenge"` and no `handoff_type`. Its `handoff_required` is `true` only because the borrower signs; there is no page to send them to. It means the borrower's wallet is registered and only its ownership proof is missing: run the wallet-proof step (`request_signature_challenge` → the borrower signs → `submit_signature`). Never fabricate the signature. `CONNECT_BANK` may be listed alongside it, because a bank is an alternative source; report it, and still run the proof. Do not start a bank link the borrower did not ask for. If they say they would rather connect a bank, get the link with `start_browser_handoff`.

`CONNECT_WALLET` is for a borrower with no wallet. The two are never listed together.

### Rules

- The only link you give is one a tool returned: `start_browser_handoff`'s `open_url` for a connect step. Never invent a link. Never ask for a legal name, date of birth, bank details, or a passkey in chat.
- `PROVE_WALLET` stays on `request_signature_challenge` / `submit_signature`.
- Keep doing any `PAY`, repayment or handle action that is listed alongside it. An `OPEN_URL` action only stops the work that depends on it; wait for the borrower only when nothing else is listed.
- These hints never change the numbered onboarding steps. If `PROVE_WALLET` is not listed (a deployment may not enable it), the wallet-proof step still runs whenever `wallet_proof_verified` is false.
- `IN_REVIEW` or `INELIGIBLE` with no action listed means there is nothing to do; say so plainly. Do not retry or ask for more data.
