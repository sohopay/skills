# Canonical SohoPay endpoints

Validated against [sohopay-backend/infrastructure/lib/config.ts](https://github.com/sohopay/sohopay-backend/blob/main/infrastructure/lib/config.ts).

| Surface | Production | Staging |
|---------|------------|---------|
| Agent skills (hosted) | `https://agents.sohopay.xyz` | same CDN (T4 public) |
| Setup bootstrap | `https://agents.sohopay.xyz/skills/v1/setup.md` | `https://agents.sohopay.xyz/skills/v1/setup-staging.md` |
| Backend API | `https://api.sohopay.xyz` | `https://staging.api.sohopay.xyz` |
| MCP server | `https://mcp.sohopay.xyz` | `https://staging.mcp.sohopay.xyz` |
| Skill index | `https://agents.sohopay.xyz/.well-known/agent-skills/index.json` | — |
| Swagger (non-prod only) | — | backend `/api/docs` on staging API |

**Note:** Older docs may reference `sohopay.com`; production infrastructure currently uses the `sohopay.xyz` hosted zone. Hosted skills use `.xyz` URLs only.
