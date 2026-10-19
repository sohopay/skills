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
| `COMPLETE_PROFILE` | Report it: the borrower enters their legal name and date of birth on the SohoPay page, never in chat. It does not delay the workload key or the grant. After those, it is the first blocker, ahead of any wallet or bank step. There is no link. Report it, claim a handle first if `CLAIM_HANDLE` is listed, then end the turn. Do not poll. |
| `CONNECT_WALLET` / `CONNECT_BANK` | Alternatives (`reason_code: FINANCIAL_SOURCE_REQUIRED`): ask the borrower wallet or bank, then get the link for that choice with `start_browser_handoff` (see "Choosing a source" and "Connect link" below). Either connection is enough for **evidence**; it does **not** by itself activate spendable credit. |
| `REVIEW_AND_ACCEPT_FACILITY` | Get the borrower a link with `review_facility_offer` (see "Facility acceptance" below). |

`COMPLETE_PROFILE` has no link tool: report the step and never invent a link.

### Choosing a source (`FINANCIAL_SOURCE_REQUIRED`)

Every entry with `reason_code: FINANCIAL_SOURCE_REQUIRED` is an alternative, so never act on the first one alone. `register_borrower` lists the same steps as bare action names (`CONNECT_WALLET`, `CONNECT_BANK`, `PROVE_WALLET`), with no reason code.

1. The workload key, token, and ACTIVE grant come first, even when `COMPLETE_PROFILE` is listed. After that, `COMPLETE_PROFILE` is ahead of this choice: report it, invent no link, and do not start a wallet or bank step. When it is not listed, ask the borrower one question naming both options: connect a wallet, or connect a bank.
2. `CONNECT_WALLET` + `CONNECT_BANK` (no wallet): get the link for the chosen step ("Connect link").
3. `PROVE_WALLET` + `CONNECT_BANK` (wallet registered, proof missing): a wallet choice is the wallet proof below, with no link; a bank choice is the `CONNECT_BANK` link.
4. Do not start a link, or a signature challenge, before the borrower has chosen.
5. A `CONNECT_BANK` listed next to `EVALUATE_CREDIT` belongs to a borrower who already has a verified source: it is optional evidence, so report it and do not stop for it.

A borrower who picks the bank and has no proven wallet still registers the workload key and may activate a within-threshold grant through passkey consent. Payment can remain blocked by `REPAYMENT_METHOD_REQUIRED`; report that readiness state separately. See **Bank only** in the onboarding steps.

`EVALUATE_CREDIT` and `REVIEW_CREDIT_OFFER` are statuses, not browser steps (an older deployment may still mark them `handoff_type: "OPEN_URL"`; treat them the same). Report them: the borrower needs SohoPay to evaluate them for credit, or has an offer waiting. Call no tool and give no link. A `CONNECT_BANK` listed next to `EVALUATE_CREDIT` is optional evidence and does not block that status.

### Facility acceptance (`REVIEW_AND_ACCEPT_FACILITY`)

The backend lists it with `tool: "review_facility_offer"`. Until acceptance completes, there is no credit line (`credit` is null) and `can_pay` is false, even when wallet or bank sources are connected. Linking a source is evidence only, not spendable credit.

1. If your tool list has no `review_facility_offer` (an older server), report that the borrower must review and accept the facility offer in SohoPay, and give no link.
2. Call `review_facility_offer` with a fresh `idempotency_key`. It takes no offer argument: the backend picks the open offer and returns `action` (`FACILITY_ACCEPT`), `open_url` and `expires_at`.
3. Open `open_url` for the borrower exactly as returned, as in step 3 of "Connect link": whole, never shortened, rewritten or rebuilt. Never build a `/facility/accept` link yourself. It is single-use and bound to this borrower: give it to no one else, and do not fetch it with your own tools. The page handles sign-in and confirmation.
4. Do not poll. Ask the borrower to tell you when they have finished, then call `get_context` again and follow what it lists.
5. `409 FACILITY_OFFER_NOT_AVAILABLE` means no offer can be reviewed right now (it expired, was withdrawn, or is already accepted). Call `get_context` again. Do not retry.
6. Reuse an `idempotency_key` only to retry a call that failed in transit. If the link is past `expires_at`, or the borrower lost it, call `review_facility_offer` again with a **new** `idempotency_key`; the new link replaces the old one.

### Connect link (`start_browser_handoff`)

1. If your tool list has no `start_browser_handoff` (an older server), report the step as the borrower's to do in SohoPay and give no link.
2. Call `start_browser_handoff` with `action` set to the borrower's choice (`CONNECT_WALLET` or `CONNECT_BANK`) and a fresh `idempotency_key`. It returns `action`, `open_url` and `expires_at`; the backend mints only a step that is current. Tell the borrower which connection the link is for (`action`). An older server's tool takes no `action` argument and mints the first connect step listed: use it that way only when that step is the borrower's choice, otherwise report the chosen step with no link.
3. Open `open_url` for the borrower exactly as returned, the same way as the agent-grant consent page. If you cannot open a browser, give it to the borrower verbatim. Never shorten, rewrite or rebuild it, and never drop its `#…` part. It is single-use and bound to this borrower: give it to no one else, and do not fetch it with your own tools.
4. Do not poll. Ask the borrower to tell you when they have finished in the browser, then call `get_context` again and follow what it lists.
5. `409 NO_BROWSER_HANDOFF` means the chosen connect step is not current (your `get_context` is out of date, or you sent `CONNECT_WALLET` while `PROVE_WALLET` is listed). Call `get_context` again. Do not retry the handoff.
6. If the link is past `expires_at`, or the borrower lost it, call `start_browser_handoff` again with a **new** `idempotency_key`. Reusing the old key returns the same expired link.
7. When `PROVE_WALLET` is listed, call it only with `action: CONNECT_BANK`, after the borrower chose the bank. A wallet choice is the wallet proof (see below).

### Wallet proof (`PROVE_WALLET`)

`PROVE_WALLET` is not a browser step. It carries `tool: "request_signature_challenge"` and no `handoff_type`. Its `handoff_required` is `true` only because the borrower signs; there is no page to send them to. It means the borrower's wallet is registered and only its ownership proof is missing: run the wallet-proof step (`request_signature_challenge` → the borrower signs → `submit_signature`). Never fabricate the signature. `CONNECT_BANK` may be listed alongside it, because a bank is an alternative source: ask the borrower wallet or bank first ("Choosing a source"). Run the proof only after they choose the wallet; if they choose the bank, get the `CONNECT_BANK` link instead and skip the proof.

`CONNECT_WALLET` is for a borrower with no wallet. The two are never listed together.

### Rules

- The only link you give is one a tool returned: `start_browser_handoff`'s `open_url` for a connect step, or `review_facility_offer`'s for facility acceptance. Never invent a link. Never ask for a legal name, date of birth, bank details, or a passkey in chat.
- `PROVE_WALLET` stays on `request_signature_challenge` / `submit_signature`.
- Keep doing any `PAY`, repayment or handle action that is listed alongside it. An `OPEN_URL` action only stops the work that depends on it; wait for the borrower only when nothing else is listed.
- `COMPLETE_PROFILE` and a source step do not delay the workload key or `authorize_agent`. Those are done first. The source step gates spendable credit. Wallet proof runs when `PROVE_WALLET` is the borrower's choice. If no source step is listed and `PROVE_WALLET` is not either (a deployment may not enable it), the wallet-proof step still runs whenever `wallet_proof_verified` is false.
- `IN_REVIEW` or `INELIGIBLE` with no action listed means there is nothing to do; say so plainly. Do not retry, poll, or ask for more data. The borrower is onboarded but not spend-ready.
