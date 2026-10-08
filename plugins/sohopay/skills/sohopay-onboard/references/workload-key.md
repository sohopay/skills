## Protocol V2 agent workload key

Required before Protocol V2 x402 (`prepare_x402_payment` → `VOUCHER_ISSUED`). Without a registered key, prepare returns `X402_AGENT_KEY_NOT_REGISTERED`. Tool ships with MCP catalog **v5** ([sohopay-mcp-server#94](https://github.com/sohopay/sohopay-mcp-server/issues/94)); backend alignment [sohopay-backend#1144](https://github.com/sohopay/sohopay-backend/issues/1144).

**Key ownership:** the **agent** (client runtime) holds the Ed25519 workload keypair; SohoPay / MCP never see the private key. The agent does **not** generate, read, or sign with the key itself — a runtime **signer** owns generation, persistence, and signing. The agent only passes a key **path** and relays the signer's public output. Lifecycle alias: `onboard_sohopay_agent` → tool name `register_agent_workload_key`.

**Route to the signer — never hand-roll crypto.** The agent never generates a keypair, builds a JWK, computes a thumbprint, or signs a proof-of-possession in prose. It resolves the signer and calls it. If no conformant signer with the keygen contract is present, **fail closed** — do not improvise, do not fall back to in-prose crypto.

### Resolve the signer (keygen rules)

Resolve via `{SKILL:sohopay-x402}` `references/signer.md`, with two keygen-specific gates on top of the shared resolver:

1. **The npx tier is disallowed for `key generate`.** A secret-writing command runs only on a locally-installed signer: `$SOHOPAY_SIGNER`, then `sohopay-signer` on `PATH`. `$SOHOPAY_SIGNER` comes from the operator's environment — the agent **never** sets it inline.
2. **`command_contracts["key generate"]` must equal `"workload-keygen/1"`** (read from `<signer> capabilities --output json`). An absent key ⇒ fail closed `SIGNER_KEYGEN_UNSUPPORTED`.

- No local signer is installed (`$SOHOPAY_SIGNER` unset and no `sohopay-signer` on `PATH`; npx is disallowed here) ⇒ **`SIGNER_KEYGEN_REQUIRES_LOCAL`**. Hand the operator the exact pinned install command and **stop**:

  ```text
  npm i -g @sohopay/agent-signer@0.3.0
  ```

  The agent **does not** run the install itself and **does not** set `$SOHOPAY_SIGNER` — secret-handling software is installed by a human, once, auditably.
- A signer resolves but lacks the keygen contract ⇒ **`SIGNER_KEYGEN_UNSUPPORTED`**: stop, no prose fallback.
- A local signer is installed but none answers `capabilities --output json` (nonzero exit, stdout that is not JSON, or another `signer_protocol`) ⇒ **`SIGNER_UNRESOLVED`**: stop and surface.

### Generate + register (once per terminal)

Use the **canonical key path defined in `{SKILL:sohopay-x402}` `references/signer.md`** for both `--out` and `--key` (do not restate the literal here — it has one home). `$KEY` below is that path: shell variables do not survive between tool calls, so set `KEY=` to it on the first line of the **same** Bash call as each command below (or pass the path itself as the value).

Supply stdin with a **single-quoted heredoc** (`<<'SOHOPAY_EOF'` … `SOHOPAY_EOF`) exactly as shown, filling in the values — never `echo … |` or `printf … |`, and never an unquoted heredoc.

1. **Generate (signer owns it):**

   ```text
   <signer> key generate --out "$KEY" --input - --output json <<'SOHOPAY_EOF'
   { "borrower_id": "…", "terminal_id": "…" }
   SOHOPAY_EOF
   ```

   stdin is the non-secret `{ "borrower_id": "…", "terminal_id": "…" }`. Capture the signer's stdout `{ public_jwk, jkt, borrower_id, terminal_id, created }`. **The agent never reads `secret.json`** — the signer writes and owns it. `created: false` means the key already existed for this borrower+terminal and was reused (a retry after a partial failure is safe — never regenerate).

2. **Proof-of-possession (signer owns it):**

   ```text
   <signer> pop sign --key "$KEY" --input - --output json <<'SOHOPAY_EOF'
   { "fields": { "borrowerId": "…", "terminalId": "…", "jkt": "…" } }
   SOHOPAY_EOF
   ```

   stdin is exactly `{ "fields": { "borrowerId": "…", "terminalId": "…", "jkt": "…" } }` (the `jkt` from step 1). The signer mints its own `nonce` + `iat` — **never** supply them (a client-supplied `nonce`/`iat` is rejected `MALFORMED_INPUT`). Capture `{ pop_signature, nonce, iat }`.

3. **Register:** call `register_agent_workload_key` → `POST /api/v1/agents/{terminal_id}/keys` with the captured public material + `pop_signature` + `nonce` + `iat`.

| Field | Detail |
|-------|--------|
| `borrower_id` | Canonical borrower UUID (`whoami.borrower_id ?? whoami.principal_id`) |
| `terminal_id` | Must match the terminal from `register_borrower`. Omit to use `SOHO_TERMINAL_ID` or the host default — then pass that same resolved value as the signer's PoP `fields.terminalId` |
| `public_jwk` | From the signer's `key generate` output — `{ kty, crv, x }` only; the agent never adds or inspects fields |
| `jkt` | From the signer; gateway recomputes and must match |
| `nonce` | From the signer's `pop sign` output (signer-generated) |
| `iat` | From the signer's `pop sign` output |
| `pop_signature` | From the signer's `pop sign` output |
| Scope | `borrower:token` |
| Idempotent | Yes — pass `idempotency_key` when the harness cannot set headers |

**Prerequisite:** step 1 (`register_borrower`) must have created this host's terminal. Pass the **resolved** `terminal_id` from that call (or `SOHO_TERMINAL_ID` / host default) as the signer's `fields.terminalId`. Registering against an unregistered or guessed terminal returns `TERMINAL_NOT_OWNED`.

### If the signer refuses (stop; never "fix" the key store)

Surface the signer's error **code** and stop. Never delete, move, rename, or edit `secret.json`; never edit the signer config or set `SOHOPAY_SIGNER_KEY_ROOTS`.

| Code | Action |
|------|--------|
| `CROSS_BORROWER_KEY` | A key for a different borrower exists at the path. Stop and surface — never delete/move/rename the key file |
| `TERMINAL_MISMATCH` | The key is bound to another terminal. Stop and surface — no destructive "fix" |
| `KEY_INTEGRITY_FAILED` | Stored public ≠ derived. Stop and **escalate to the human as possible tampering** |
| `KEY_PATH_INVALID` | Stop and surface — never edit the signer config (`~/.config/sohopay-signer/config.json`) and never set `SOHOPAY_SIGNER_KEY_ROOTS` to widen roots |
| `KEY_PERSIST_FAILED` | Surface the I/O failure; do not retry blindly |
| `MALFORMED_INPUT` | Fix the call shape (e.g. a wrongly client-supplied `nonce`/`iat`) and retry correctly |
| `INLINE_KEY_REJECTED` | Switch to `--key "$KEY"`; **never** retry with an inline key |

Registering the key does **not** authorize spending. Immediately follow `{SKILL:sohopay-authorize-agent}` — do not wait for a payRequest or a `prepare_x402_payment` 403. Pay-time `AGENT_AUTHORIZATION_REQUIRED` is recovery only. Voucher signing after `VOUCHER_ISSUED`: `{SKILL:sohopay-x402}`.
