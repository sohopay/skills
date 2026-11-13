## Mobile host capability gate

Apply this gate before installing packages, changing MCP configuration, registering a terminal, requesting write scopes, or starting the executable desktop onboarding chain. A phone can use hosted onboarding without installing or executing SKILL.md. Reading instructions, opening a website, and completing OAuth do not by themselves add tools to the originating chat or establish payment readiness.

### Decide from observed capabilities

1. Identify the actual host and surface, not an installed CLI or a user-agent string. Check whether this conversation already exposes the approved SohoPay integration and its authenticated read-only tools. Never claim that a hypothetical tool is callable. Do not probe a payment tool to test connectivity.
2. **No verified integration:** tell the borrower to open the official SohoPay website (sohopay.xyz) and explain: “You can continue on SohoPay's website. This does not connect payment tools to this chat.” For staging, use only the reviewed staging website configured by the operator; never substitute production. Do not invent an activation route, ticket, callback, or deep link. Naming the website is navigation guidance, not a claim that its root is a profile-completion or activation endpoint. If the website offers no enabled onboarding entry, report that limitation and support@sohopay.xyz.
3. **Integration present, signer unavailable or unverified:** perform only authenticated read-only status supported by the installed catalog and granted scope. Open an activation/handoff link only when a supported authorized tool returns it. Do not run desktop commands, generate keys in the model, install a global signer, or create an agent grant to conceal a missing signing runtime. Report `SIGNER_READY` as false/unverified and payment as unavailable.
4. **Verified desktop runtime plus existing signer:** continue the established setup checklist, pinned signer installation rules, borrower authorization and Protocol V2 flow. This mobile guidance does not change desktop key storage, signer pin, spending consent or verifier format.

A future mobile-compatible signer must be separately reviewed against the current authorization and verifier contracts. A web confirmation, passkey assertion, OAuth token or browser session is not an Ed25519 workload voucher signature. Never fall back to a shared/cloud-held signing key.

### State and continuity

Report only server-authoritative states. Keep ACCOUNT_CREATED, IDENTITY_VERIFIED, BANK_CONNECTED, CREDIT_APPROVED, FACILITY_ACCEPTED, AGENT_AUTHORIZED, SIGNER_READY and PAYMENT_READY distinct. Do not infer credit approval from bank connection or payment readiness from a successful account login. Pending, declined, revoked and expired states must remain visible; no invented success receipts.

Use the trusted browser UI for phone OTP, profile, KYC, bank consent, credit acceptance and agent permissions. Never request bank credentials, private keys, signing seeds, legal name, date of birth or OTP in chat. Do not repeat billable checks simply because the app was suspended. Resume from authenticated server state; recover an expired ticket through the supported service, not by editing its URL.

For mobile activation, do not hold the model in a fifteen-minute polling loop. Prefer explicit status refresh when the user returns; if the host supports bounded background status polling, obey the server's retry guidance and stop on completion, expiry, revocation or the bounded cap. Browser navigation and app suspension are not proof of completion. A return-to-assistant action is offered only for a verified host-supported return target; it need not restore the original conversation.

A handoff URL must come from a trusted, authenticated service, preserve its opaque ticket exactly and stay within the configured origin/redirect allowlist. Never append OAuth tokens, credentials, private keys or borrower details to a URL. Do not log or send handoff tickets to analytics.

### Accurate payment language

A2A credit allocation and merchant x402 spending are distinct operations. Existing A2A allocation is not a generic withdrawable on-chain USDC transfer. Show the operation and actual server receipt; “send 20 USDC” must not be silently mapped to a credit allocation.

### Host availability is a verification gate

As checked on 2026-11-12, OpenAI's custom-MCP documentation describes creation/connection on web, while Anthropic documents remote connectors across mobile and other Claude surfaces. These statements are not a certification of SohoPay on either mobile app. Account/workspace permissions, enabled tools, OAuth, signing, callback behavior and actual iOS/Android runs must be verified before marking a host supported. Never instruct an unsupported fresh chat to inject tools into itself.
