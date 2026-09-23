<!-- SKILLS_BASE: set to the base URL serving these docs.
     Dev:  https://raw.githubusercontent.com/sohopay/skills/main
     Prod: https://agents.sohopay.xyz/skills/v1
     SKILLS_HOST (CDN origin): https://agents.sohopay.xyz
     Fetch order: local sticky → {SKILLS_BASE} → GitHub raw last-resort.
     Publish rewrites SKILLS_BASE to Prod and {SKILLS_HOST} to the origin. -->
<!-- Generated from plugins/sohopay/skills — do not hand-edit this file. Run npm run generate:hosted -->
SKILLS_BASE = https://raw.githubusercontent.com/sohopay/skills/main

# Skill: SohoPay Agent Setup (Staging)

**Substitute SKILLS_BASE into every fetch URL below** — replace `{SKILLS_BASE}` with the value on the line above before running any `curl`.

**Environment: STAGING.** Do not register production MCP (`https://mcp.sohopay.xyz`) or mix production tokens with this path.

| | Staging |
|--|---------|
| API | `https://staging.api.sohopay.xyz` |
| MCP register | `https://staging.mcp.sohopay.xyz/mcp` |
| MCP origin | `https://staging.mcp.sohopay.xyz` |
| Server id | `sohopay-staging` |
| Paste | `Set up https://staging.sohopay.xyz/install` |

**Global failure rule:** If any fetch fails (non-2xx status, HTML content, or empty body), STOP. Do not improvise. Report the exact failed URL to the operator.

Execute **sohopay-setup** (`{SKILLS_BASE}/setup.md`) with the staging row pinned. Connect via **sohopay-mcp-connect-staging** (`{SKILLS_BASE}/mcp-connect-staging.md`) or the staging row in **sohopay-mcp-connect**.
