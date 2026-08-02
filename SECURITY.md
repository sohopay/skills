# Security Policy

SohoPay is a payments product. We take the integrity of these skill docs and the
integration flows they describe seriously.

## Reporting a vulnerability

Email **support@sohopay.xyz** with details and reproduction steps.
<!-- TODO(confirm): stand up a dedicated security@sohopay.xyz alias and use it here instead. -->

Please do **not** open public GitHub issues for security reports. We will
acknowledge receipt and coordinate a fix and disclosure timeline with you.

## Scope

In scope:

- The skill docs in this repository (`setup.md` and the chained `*.md` files) —
  especially any instruction that could cause an agent to escalate privileges,
  disable permission prompts, leak secrets, or move funds without operator consent.
- `install.sh` and the CI guardrails in `scripts/`.
- `.well-known/agent-skills/index.json` correctness.

Out of scope (report to their own repos):

- `sohopay-backend`, `sohopay-mcp-server`, and the on-chain contracts.

## Verifying doc integrity

Agents fetch these docs over the network, so their integrity matters.

- Prefer fetching from a **pinned commit SHA** rather than a mutable branch when
  reproducibility matters, e.g.
  `https://raw.githubusercontent.com/sohopay/skills/<commit-sha>/setup.md`.
- <!-- TODO: publish checksums (e.g. a signed SHA-256 manifest of the skill set) and
     document how to verify a fetched doc against it before execution. --> A
  checksum/signature manifest is planned; until it ships, pin to a commit SHA you
  have reviewed.

## Design invariants (do not weaken)

- Docs never instruct an agent to run in a bypass / full-access mode or to disable
  permission prompts.
- Consent-critical actions (wallet-proof signing, token requests, payment execution)
  require an explicit operator STOP-and-confirm.
- Every remote fetch uses `curl -fsSL` and fails loudly rather than improvising.
