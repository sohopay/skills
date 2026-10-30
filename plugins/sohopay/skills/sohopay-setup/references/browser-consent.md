## Browser consent and handoff pages

SohoPay onboarding and MCP login depend on **opening HTTPS URLs in the operator's browser**. The agent prepares links; the borrower completes passkey, Plaid, or OAuth approval on SohoPay pages. This reference applies to every `consent_url`, `open_url`, and OAuth approval page — not only agent authorization.

### Use a capable agent model

Free or weak chat models often **fail tool calling**, **truncate URLs**, or **drop the `#` fragment**. That breaks consent and bank handoff pages. For setup and onboarding, use a model with reliable tool use (for example a current Sonnet-class model in your harness). If a page opens blank or "Invalid link", re-run the step with a stronger model and open the URL **verbatim** again.

### Open URLs verbatim — never fetch them

| Field | Source | Rule |
|-------|--------|------|
| `consent_url` | `authorize_agent`, repayment consent, etc. | Open exactly as returned (`…/agent/authorize#<challenge_id>` or assembled repay URL). Never rebuild from `typed_data`. Agent-grant details: `{SKILL:sohopay-authorize-agent}` — load that skill's `references/consent-page.md`. |
| `open_url` | `start_browser_handoff`, `review_facility_offer` | Open exactly as returned, **`#…` included**. Single-use, borrower-bound. Never shorten, rewrite, or rebuild paths such as `/facility/accept`. |

**Do not** `curl`, `fetch`, or HTTP GET these URLs from the agent. They are for the **browser** (passkey, Plaid Link, cookies). Fetching from the agent does not complete the step and may consume or confuse session state.

If your harness has no browser tool:

1. **macOS (Hermes and other CLIs):** `open 'https://…#…'` with the **full** URL in single quotes so the shell does not strip the fragment.
2. **Otherwise:** print the full URL for the operator to open on phone or desktop. Do not retype it.

### After opening — poll, do not wait in chat

When a skill says to poll `get_context` or `get_agent_authorization`, do that on a **5 s** interval. **Do not** ask the borrower to type "done" or end the turn waiting for chat. Onboarding handoff polling: `{SKILL:sohopay-onboard}` — load `references/onboarding-context.md` ("Connect link", "Facility acceptance").

### Success pages without "return to agent"

Some harnesses (notably **Hermes**) register only **loopback HTTP** OAuth redirects, not deep links such as `cursor://`. Bank connect and other handoffs may finish on a SohoPay success screen **without** a safe `return_uri`. The **Close** control may only call `window.close()`, which browsers block for user-opened tabs.

**Agent rule:** treat completion from **`get_context`** (or the relevant poll), not from the operator closing a tab. Tell the operator they can close the tab manually (⌘W / Ctrl+W) if the button does nothing; **keep polling** until the connect or facility step clears.

### MCP OAuth login (separate from handoff URLs)

CLI MCP login starts a **local callback listener** on the operator's machine. **Do not run `mcp login` in an agent shell** that may exit in ~30 s — that kills the listener and leaves `ERR_CONNECTION_REFUSED` on `/callback` even when consent succeeded. Operator runs login in a normal Terminal tab; paste the full callback URL if prompted. Defaults and Hermes `oauth.timeout`: `{SKILL:sohopay-mcp-connect}` — load `references/harnesses.md` ("OAuth browser login").
