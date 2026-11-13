# Host capability matrix

Checked: 2026-11-12. Scope: documentation and repository review, not live account or device certification.

| Surface | Official documented transport/setup | SohoPay evidence | Safe release posture |
|---|---|---|---|
| ChatGPT mobile iOS/Android | The current custom-MCP help article says connecting custom servers is web-only. General app/plugin availability must not be confused with creating a custom integration. | No actual SohoPay mobile install, OAuth, tool-discovery, read-only call or compatible signing test performed here. | Browser fallback unless the actual account exposes an approved integration; read-only status only when authenticated tool and scope are verified. |
| ChatGPT web / workspace | Custom MCP server configuration through current Plugins or legacy workspace app settings, subject to permissions. | Existing skill references are not proof of a successful account-specific setup. | Verify OAuth, metadata, audience and allowed tools; do not infer mobile or signing support. |
| Claude mobile iOS/Android | Official documentation says remote connectors work across Claude surfaces; connection is brokered from Anthropic infrastructure. | No live SohoPay mobile OAuth, tool execution or signing test performed. | A configured, authorized connector may enable status; payment remains blocked until signer and authorization independently pass. |
| Claude web / Desktop remote connector | Account-level remote MCP connector; this is separate from Claude Code CLI and local Desktop extensions. | Setup prereqs incorrectly rejected all Claude.ai MCP support before this change. | Use actual exposed tools; no `claude mcp` command inside chat. |
| Claude Code / Codex / Cursor / Hermes desktop runtime | Existing repo workflow supports executable harness setup and pinned signer. | Source flow preserved; no live payment or vendor call performed. | Existing workflow unchanged; package, key isolation, contract and host-specific tests remain required. |
| Mobile browser | Trusted SohoPay website can run web UI; it does not add tools to an unrelated chat. | Backend/hub flag and device behavior require separate staging verification. | Honest website entry, resumable server state and clear signer/payment gating. |

## Source links

- https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt (reviewed current body, including mobile FAQ; do not hardcode an outdated Developer Mode setting)
- https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp (reviewed network, authentication and connector configuration sections)
- https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors (reviewed remote versus local surface availability)

These pages may evolve. Record the actual app build, plan, workspace policy, exact integration identifier/catalog revision, OAuth client identity, observed tools, callback result and signer evidence per pilot. A marketing claim about platform-wide support cannot set a backend readiness bit.

## Required matrix evidence before enabling a cohort

For each host + OS + app version: fresh install, returning user, revoked OAuth grant, wrong tenant, suspended browser, expired/reused ticket, reconnect, status-only permission, signer unavailable, and a separately authorized sandbox payment. Record pass/fail and proof without tokens or PII. Do not mark desktop emulation as iOS/Android success.
