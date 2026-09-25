## Step 3: Optional — sticky SohoPay skills (skip by default)

**Skip this step unless the operator explicitly asks for sticky / offline skills.** Do not run `npx skills add`, do not prompt the operator to install sticky skills, and do not ask them to install Node.js or npm.

When the operator **does** explicitly request sticky skills:

1. Verify Node.js `>=22.13.0` and npm `>=10` (only now):

```bash
node --version
npm --version
```

2. Install SohoPay's official skills **only for the harness from Step 1**. Always pass `--agent` / `-a`. Omitting it (especially with `-y`) makes the CLI symlink into every detected agent directory.

| Step 1 harness | Install command |
|----------------|-----------------|
| Claude Code | `npx skills add sohopay/skills -g -y -a claude-code` |
| Cursor | `npx skills add sohopay/skills -g -y -a cursor` |
| Codex | `npx skills add sohopay/skills -g -y -a codex` |
| Hermes | `npx skills add sohopay/skills -g -y -a hermes-agent` |
| ChatGPT app | Skip — no `npx skills` target; read hosted docs when connecting |
| Claude.ai chat | Do not install. You should already have STOPped in Step 1. |

Re-running is safe; it updates in place. Install lands sibling folders such as `~/.claude/skills/sohopay-setup/` (not `sohopay-integrate/docs/`).
