# Canonical SohoPay endpoints

Validated against [sohopay-backend/infrastructure/lib/config.ts](https://github.com/sohopay/sohopay-backend/blob/main/infrastructure/lib/config.ts).

| Surface | Production | Staging |
|---------|------------|---------|
| Agent skills (hosted) | `https://agents.sohopay.xyz` | same CDN (T4 public) |
| Setup bootstrap | `https://agents.sohopay.xyz/skills/v1/setup.md` | `https://agents.sohopay.xyz/skills/v1/setup-staging.md` |
| Backend API | `https://api.sohopay.xyz` | `https://staging.api.sohopay.xyz` |
| MCP server | `https://mcp.sohopay.xyz` | `https://staging.mcp.sohopay.xyz/mcp` |

Register harnesses against the MCP **resource** URL (staging includes the `/mcp` path). Health and OAuth protected-resource metadata stay on the MCP origin (`https://staging.mcp.sohopay.xyz/health`, `/.well-known/oauth-protected-resource`). Production will use the same `/mcp` resource path once that host’s PRM is confirmed.
| Skill index | `https://agents.sohopay.xyz/.well-known/agent-skills/index.json` | — |
| Swagger (non-prod only) | — | backend `/api/docs` on staging API |

**Note:** Older docs may reference `sohopay.com`; production infrastructure currently uses the `sohopay.xyz` hosted zone. Hosted skills use `.xyz` URLs only.
