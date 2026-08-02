# sohopay/skills

Canonical source for **SohoPay agent skills** — the docs an AI coding agent fetches to connect to SohoPay, onboard a borrower, and operate USDC micro-credit. SohoPay provides USDC micro-credit for AI agents.

## Quick start (agent-driven)

Paste this into your agent (Claude Code, Cursor, Codex, or Hermes):

```
Fetch https://raw.githubusercontent.com/sohopay/skills/main/setup.md and
follow the instructions in it to set up SohoPay in this environment.
```

<!-- At launch this URL switches to https://agents.sohopay.xyz/skills/v1/setup.md -->

Prefer to read the instructions first (for humans):

```bash
curl -fsSL https://raw.githubusercontent.com/sohopay/skills/main/setup.md
```

## Sticky install

Install the skills so the agent has SohoPay guidance in every future session:

```bash
npx skills add sohopay/skills -g       # open skills registry
gh skill install sohopay/skills        # GitHub CLI skills
```

## What this installs and what it can do

Running setup will:

- **Write skills** to your agent's skills directory (`sohopay/skills`).
- **Register the SohoPay MCP server** in your harness config (hosted URL or local `sohopay-mcp-server`).
- **After borrower onboarding**, the agent holds **USDC spending authority** under policy limits. **Repayment is due weekly, on Sunday**, and is settled by the operator.

Every consent-critical step (wallet-proof signing, token requests, payment execution) pauses and asks you first. The docs never instruct an agent to disable permission prompts or run in a bypass mode.

## Repository layout

| Path | Purpose |
|------|---------|
| `setup.md`, `*.md` | Hosted skill docs (served from raw GitHub in dev, `agents.sohopay.xyz` at launch) |
| `.well-known/agent-skills/index.json` | Machine-readable skill index |
| `plugins/sohopay/skills/` | Open-registry skill packages (`SKILL.md` per skill) |
| `install.sh` | Deterministic non-agent installer for operators/CI |
| `scripts/validate-skills.mjs` | CI guardrails |
| `scripts/generate-llms-full.mjs` | Builds `llms-full.txt` |

## Canonical endpoints

See [docs/endpoints.md](docs/endpoints.md). Public skill host uses the `sohopay.xyz` Route53 zone (`agents.sohopay.xyz`).

**Architecture plan:** [docs/PLAN.md](docs/PLAN.md) · **Engineering notes:** [docs/engineering-notes.md](docs/engineering-notes.md)

## Local validation

```bash
npm run validate
npm run generate:llms-full
```

## Deploy

Push to `main` runs `.github/workflows/validate.yml` then `.github/workflows/deploy.yml` (requires AWS OIDC secrets — see workflow comments).

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting and doc-integrity guidance.

## License

Licensed under the [Apache License 2.0](LICENSE) — permissive reuse with an
explicit patent grant. These skill docs are meant to be freely fetched, read,
forked, and adapted by integrators.
