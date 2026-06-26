# Skill: SohoPay Agent Setup for AI Agents

CRITICAL: This skill uses **soho-mcp-server** as the MCP runtime and **sohopay-backend** as the source of truth. Do NOT hold borrower private keys. MCP transports signatures only; borrowers sign EIP-712 off-device.

CRITICAL: Run this setup in full-access mode (network access + read/write to the user's home directory). Without it, skill installation and MCP config writes fail or hang on permission prompts.

Hosted skill base: `https://agents.sohopay.xyz`

## Step 1: Check prerequisites

```bash
node --version
which npm || command -v npm
```

Required: Node.js `>=22.13.0`, npm `>=10`, network access.

## Step 2: Install sticky SohoPay skills

Install SohoPay's official skills so the agent has local guidance in every future session:

```bash
npx skills add sohopay/skills -g -y
```

If the repo is not yet published on GitHub, skip this step and rely on curl-fetched hosted skills below. Re-run after `sohopay/skills` is public.

## Step 3: Connect to SohoPay MCP

Fetch the MCP connection skill:

```bash
curl -sL https://agents.sohopay.xyz/skills/mcp-connect.md
```

Follow those instructions exactly. Choose either:

- **Hosted MCP** — `https://mcp.sohopay.xyz` (when deployed), or
- **Local MCP** — clone and run [soho-mcp-server](https://github.com/sohopay/soho-mcp-server)

## Step 4: Smoke test MCP

After configuring `.env`, verify the server:

```bash
npm run smoke
```

If transport auth is enforced, provide `MCP_AUTH_TOKEN`:

```bash
MCP_AUTH_TOKEN=<oauth-access-token> npm run smoke
```

## Step 5: Onboard a borrower

Fetch the onboarding skill:

```bash
curl -sL https://agents.sohopay.xyz/skills/borrower-onboard.md
```

Complete register → wallet proof → token request. Handle `dropped_scopes` (not fatal).

## Step 6: Create a delegated agent session

```bash
curl -sL https://agents.sohopay.xyz/skills/agent-session.md
```

## Step 7: Operate (spend / policy / payment)

```bash
curl -sL https://agents.sohopay.xyz/skills/spend-and-pay.md
```

## Step 8: Optional — x402 HTTP credit rail

For HTTP 402 paywalls (distinct from MCP orchestration):

```bash
curl -sL https://agents.sohopay.xyz/skills/x402-credit-pay.md
```

## Step 9: Idempotency reference

Before any mutating financial call:

```bash
curl -sL https://agents.sohopay.xyz/skills/idempotency.md
```

## Staying current

Update installed skills:

```bash
npx skills update -g -y sohopay-integrate
```

Browse all skills:

```bash
curl -sL https://agents.sohopay.xyz/.well-known/agent-skills/index.json
```

Pin `@soho/mcp-contract` to the same semver across `sohopay-backend` and `soho-mcp-server` — scope drift must be a compile error, not a runtime authz bug.

## Rules

### Security rules

- NEVER store, log, or display borrower private keys, JWTs, OTP codes, or full EIP-712 signatures beyond immediate use.
- NEVER include real API keys or service tokens in skill files or chat transcripts.
- NEVER bypass wallet-proof or KYC gates — re-request scopes after gates complete.
- ALWAYS obtain explicit user consent before wallet-proof signing or high-risk payment execution.
- ALWAYS use `Idempotency-Key` (UUID v4) on mutating financial MCP and x402 routes.

### Best practices

- ALWAYS resolve live authorization via `POST /api/v1/auth/authorization-context` before privileged tools — scopes are not baked into JWTs.
- ALWAYS use `borrowerId` (UUID) as canonical identity — never wallet address in session/policy APIs.
- ALWAYS prefer `--output json` or structured API responses when parsing results.
- ALWAYS verify x402 `/verify` before `/settle`; treat `txHash` as async — poll for confirmation.

---

Current location: `/skills/setup.md`

For full skill directory: `https://agents.sohopay.xyz/.well-known/agent-skills/index.json`
