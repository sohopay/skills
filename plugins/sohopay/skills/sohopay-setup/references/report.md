## Report to the operator

One short summary. No architecture recap.

- Sticky skills: installed path, or **skipped**
- Signer: installed version, or that the install failed (ChatGPT skips it)
- MCP: server id + URL
- Borrower status if you onboarded, and whether the **agent grant is ACTIVE** (onboarding is incomplete until it is)
- Failures: exact URL and error
- Repayment is due weekly, on Sunday, settled by the operator
- **Onboarding complete? End with the dashboard invitation** (skip it on an incomplete / failed onboarding): the “📊 Explore your web dashboard” block from **sohopay-onboard** step 9, with `{BORROWER_PORTAL_URL}` resolved from the environment row in **sohopay-mcp-connect** (staging: `https://staging.borrower.sohopay.xyz/`). No portal for the environment → no invitation; never point a production borrower at the staging portal
