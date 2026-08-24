# Canonical SohoPay endpoints

Validated against [sohopay-backend/infrastructure/lib/config.ts](https://github.com/sohopay/sohopay-backend/blob/main/infrastructure/lib/config.ts).

| Surface | Production | Staging |
|---------|------------|---------|
| Setup bootstrap (agent prompt) | `https://raw.githubusercontent.com/sohopay/skills/main/setup.md` | `https://raw.githubusercontent.com/sohopay/skills/main/setup-staging.md` |
| Agent skills CDN (launch) | `https://agents.sohopay.xyz/skills/v1/` | same CDN; use `setup-staging.md` |
| Backend API | `https://api.sohopay.xyz` | `https://staging.api.sohopay.xyz` |
| MCP server (origin) | `https://mcp.sohopay.xyz` | `https://staging.mcp.sohopay.xyz` |
| MCP HTTP URL (register) | `https://mcp.sohopay.xyz` until PRM confirms `/mcp` | `https://staging.mcp.sohopay.xyz/mcp` |

Register harnesses against the MCP **resource** URL (staging includes the `/mcp` path). Health and OAuth protected-resource metadata stay on the MCP origin (`https://staging.mcp.sohopay.xyz/health`, `/.well-known/oauth-protected-resource`). Production will use the same `/mcp` resource path once that host’s PRM is confirmed.
| Skill index | `https://agents.sohopay.xyz/.well-known/agent-skills/index.json` | — |
| Swagger (non-prod only) | — | backend `/api/docs` on staging API |

**Staging agent prompt:** `Fetch https://raw.githubusercontent.com/sohopay/skills/main/setup-staging.md and follow the instructions in it to set up SohoPay in this environment.`

**Note:** Older docs may reference `sohopay.com`; production infrastructure currently uses the `sohopay.xyz` hosted zone. Index/`url` entries use `agents.sohopay.xyz`; day-to-day bootstrap currently uses raw GitHub (same as README).
