# sohopay/skills

Canonical source for **SohoPay agent skills** — curl bootstrap plus open-registry install for Cursor, Claude Code, and Codex.

## Quick start (integrators)

```bash
curl -sL https://agents.sohopay.xyz/skills/setup.md
```

Sticky install (after this repo is published on GitHub):

```bash
npx skills add sohopay/skills -g
```

## Repository layout

| Path | Purpose |
|------|---------|
| `setup.md`, `*.md` | Hosted skill docs (synced to `agents.sohopay.xyz`) |
| `.well-known/agent-skills/index.json` | Machine-readable skill index |
| `plugins/sohopay/skills/` | Open-registry skill packages (`SKILL.md` per skill) |
| `scripts/validate-skills.mjs` | CI guardrails |
| `scripts/generate-llms-full.mjs` | Builds `llms-full.txt` |

## Canonical endpoints

See [docs/endpoints.md](docs/endpoints.md). Public skill host uses the `sohopay.xyz` Route53 zone (`agents.sohopay.xyz`).

**Architecture plan:** [docs/PLAN.md](docs/PLAN.md)

## Bootstrap GitHub repo

The `sohopay` org exists. Create the remote repo once (requires org admin):

```bash
gh repo create sohopay/skills --public \
  --description "SohoPay agent skills for AI coding agents"
cd /path/to/skills
git init && git add . && git commit -m "chore: initial agent skills"
git remote add origin git@github.com:sohopay/skills.git
git push -u origin main
```

## Local validation

```bash
npm run validate
npm run generate:llms-full
```

## Deploy

Push to `main` runs `.github/workflows/validate.yml` then `.github/workflows/deploy.yml` (requires AWS OIDC secrets — see workflow comments).

## License

Internal / SohoPay use only unless otherwise noted.
