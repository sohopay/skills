# Mobile signing decision: preserve current custody boundary

Status: proposed options assessed; **no new signer or custody model implemented**. Checked 2026-11-12.

## Source baseline

- skills `origin/develop`: `d16e26ae5cf1bbe2e2194d421541e9ebc6161666`; local branch `feature/mobile-onboarding`.
- sohopay-agent-signer `origin/develop`: `2f82ec8b5a2f3421ffa06bafcf617ebd4c9cb26c`; detached, read-only checkout; package version `0.3.1`, Node >=18.
- SDK `src/keys.ts` uses Node crypto for the RFC 7638 JWK thumbprint. `src/storage.ts`, `src/terminal.ts` and the CLI use filesystem isolation. The public package export includes storage/terminal helpers. This is not evidence of a drop-in browser-safe package.
- `src/pop.ts`: Ed25519 proof of possession over JCS fields borrowerId, terminalId, jkt, nonce, iat; no new domain tag added to PoP.
- `src/voucher.ts`: validates signing scheme, recomputed paymentId and optional key thumbprint; signs the domain-separated canonical voucher. Voucher amount/chain fields are strings. Maintain current verifier byte compatibility.
- CLI key generation returns public material only and persists an agent workload key in a protected file. No borrower key is needed.

## Decision for this implementation

1. Preserve the existing desktop signer and key custody. Do not change verifier bytes, global signer pin or protocol contracts.
2. For a mobile host without proven isolated signing/key storage, keep `SIGNER_READY` false and deny `PAYMENT_READY`. Permit authenticated browser onboarding and read-only status where actual supported contracts allow.
3. Do not convert a passkey assertion, browser approval, facility acceptance or OAuth login into a voucher signature. Those represent different authority.
4. Do not implement browser-confirmed per-intent signing until the backend authorization contract and isolated signer execution/storage mechanism are reviewed. UI confirmation alone is insufficient.

## Options requiring explicit review

| Option | Trust boundary and requirements | Current status |
|---|---|---|
| Existing desktop/agent-controlled signer | Private workload key stays with isolated signer; MCP receives signatures. Verify borrower/terminal/jkt binding, expiry, grant revocation and budget at backend. | Preserve; live host execution unverified here. |
| User-controlled browser/native per-intent signer | Separate trusted execution boundary, protected persistence/recovery, exact intent display and explicit confirmation. Must prove Ed25519 compatibility, origin/XSS isolation and same verifier semantics. Hardware/passkey keys cannot be assumed to support this voucher algorithm. | Proposal only; no key in localStorage, URL, logs or model context. |
| Existing paired user-controlled agent runtime | Mobile asks a trusted paired agent to sign only scoped intents; design secure pairing, device identity, revocation, replay resistance and user confirmation before use. | Proposal only; not an approved implementation. |
| SohoPay-managed isolated signer | Server gains workload-key custody; requires tenant separation, access control, policy boundary, recovery, audit, incident revocation and compliance review. | Explicit separate security/custody decision required. No shared/global key. |

## Threat model and hard gates

- Prompt injection or malicious tool content: model cannot extract key material or authorize outside server-validated scopes/budgets.
- Cross-borrower/terminal mix-up: key and grant bound to borrower, host client, agent instance, terminal and public-key thumbprint; reject mismatches.
- Replay and ambiguous retries: nonce/expiry enforcement and durable per-intent idempotency; retries never imply new payment intent.
- Browser XSS, copied ticket or deep-link substitution: a ticket is not reusable spending authority. Restrict origin/redirect, consume once and bind authenticated context.
- Revocation race: backend and signing boundary revalidate grants at action time, not only onboarding time.
- Lost device or compromised runtime: audited recovery and key rotation/revocation without silently granting a new agent.
- Observability: only public IDs and redacted state in logs; never raw keys, vouchers/replayable headers, bearer tokens or one-time tickets.

## Verification gaps and next owners

Backend/MCP owners must confirm current verifier, exact catalog package pins and callback/authorization semantics. Security owner must choose/approve any new mobile signing architecture. QA needs actual iOS/Android host runs, isolation tests and negative voucher tests; desktop emulation is insufficient. Vendor and production approval remain separate gates. No live payments or deployment attempted.
