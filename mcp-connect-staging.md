<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1
     SKILLS_HOST (CDN origin): https://agents.sohopay.xyz
     Fetch order: local sticky → {SKILLS_BASE} → GitHub raw last-resort.
     Publish rewrites SKILLS_BASE to Prod and {SKILLS_HOST} to the origin. -->
<!-- Generated from plugins/sohopay/skills — do not hand-edit this file. Run npm run generate:hosted -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: Connect to SohoPay MCP Server (Staging)

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**Environment: STAGING.** Server id `sohopay-staging`. Register `https://staging.mcp.sohopay.xyz/mcp`. Origin `https://staging.mcp.sohopay.xyz`. API `https://staging.api.sohopay.xyz`. Do not overwrite a production `sohopay` entry.

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

Follow **sohopay-mcp-connect** (`{SKILLS_BASE}/mcp-connect.md`) with the staging row pinned. Harness menus: that skill’s `references/harnesses.md`.
