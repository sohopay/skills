## Agent integration (for AI coding agents)

SohoPay publishes agent skills for Cursor, Claude Code, and Codex.

**Bootstrap:**

```bash
curl -sL https://agents.sohopay.xyz/skills/setup.md
```

**Sticky install:**

```bash
npx skills add sohopay/skills -g -y
```

**Skill index:** https://agents.sohopay.xyz/.well-known/agent-skills/index.json

Canonical source: [sohopay/skills](https://github.com/sohopay/skills). See [docs/agent-skills.md](./docs/agent-skills.md).

Copy this section into `sohopay-mcp-server/README.md` when editing that repository.
