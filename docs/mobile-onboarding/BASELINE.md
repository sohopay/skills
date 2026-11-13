# Skills and signer baseline

Capture date: 2026-11-12. This repository-specific record supplements the primary backend inventory.

| Repository | Default | Exact develop base | Local working branch | Changes |
|---|---|---|---|---|
| sohopay/skills | main | d16e26ae5cf1bbe2e2194d421541e9ebc6161666 | feature/mobile-onboarding | Host guidance, generated exports, structural tests, decisions |
| sohopay/sohopay-agent-signer | main | 2f82ec8b5a2f3421ffa06bafcf617ebd4c9cb26c | detached read-only at origin/develop | None |

Both were freshly cloned with Git; origin/develop exists. Worktrees were clean before edits. Skills origin was fetched again before branch creation. No existing feature branch was overwritten. No main/develop commits were made. Repo CLAUDE.md and CODEOWNERS were inspected; hosted root Markdown and llms-full.txt were regenerated with `npm run build`, never hand-edited.

Version dependencies: skills package 0.1.0; desktop signer pin 0.3.1 unchanged; signer package 0.3.1, Node >=18; signer private vectors dependency ^0.2.0. Skills runtime requires Node >=22; local Node v24.22.1, npm 11.9.0. MCP/backend package pins and shared contract smoke tests belong to the primary implementation and remain separately tracked.

Observed source behavior: setup prereqs install the pinned Node signer for executable hosts, ChatGPT skips local signer, borrower onboarding requires workload-key proof and explicit agent authorization. The prior blanket rejection of Claude.ai remote MCP was replaced with actual capability detection. Desktop checklist/order and existing payment scripts were not changed; mobile guard stops unsupported execution before that chain.

No live host account, mobile device, provider, payment or deployment was exercised. The documented platform matrix is not a certification.
