## Protocol V2 agent workload key

Required before Protocol V2 x402 (`prepare_x402_payment` → `VOUCHER_ISSUED`). Without a registered key, prepare returns `X402_AGENT_KEY_NOT_REGISTERED`. Tool ships with MCP catalog **v5** ([sohopay-mcp-server#94](https://github.com/sohopay/sohopay-mcp-server/issues/94)); backend alignment [sohopay-backend#1144](https://github.com/sohopay/sohopay-backend/issues/1144).

**Key ownership:** the **agent** (client runtime) generates and holds the Ed25519 workload keypair. SohoPay / MCP never see the private key. Do **not** ask the MCP host to keygen or store the private key. Lifecycle alias: `onboard_sohopay_agent` → tool name `register_agent_workload_key`.

**Fixed local path** (look here first on pay — do not grep all AgentStores / other chats):

```text
~/.agents/sohopay-agent-workload/secret.json
```

or Cursor agent-store: `<store>/files/sohopay-agent-workload/secret.json` with `{ private_key_base64url, public_jwk, jkt, terminal_id, borrower_id }`. Reuse only when **both** `borrower_id` (this borrower) **and** `jkt` / `voucher.agentKeyJkt` match. If the file is missing or `borrower_id` belongs to a different borrower, generate a fresh Ed25519 keypair for the current borrower — do not register another borrower's key. Voucher recipe: `{SKILL:sohopay-x402}` § Protocol V2 sign recipe.

**Prerequisite:** step 1 (`register_borrower`) must have created this host's terminal. Sign PoP over the **resolved** `terminal_id` from that call (or `SOHO_TERMINAL_ID` / host default). Registering a key against an unregistered or guessed terminal returns `TERMINAL_NOT_OWNED`.

### Steps (once per terminal)

1. Generate an Ed25519 keypair locally. Persist the private key only at the fixed path above.
2. Build a public JWK `{ kty: "OKP", crv: "Ed25519", x }` — **never** include private material (`d` is rejected).
3. Compute `jkt` (RFC 7638 JWK thumbprint of `public_jwk`).
4. Create a single-use `nonce` and `iat` (unix seconds).
5. Sign PoP over canonicalize(`{ borrowerId, terminalId, jkt, nonce, iat }`) with the workload private key → `pop_signature`.
6. Call `register_agent_workload_key` → `POST /api/v1/agents/{terminal_id}/keys`.

| Field | Detail |
|-------|--------|
| `borrower_id` | Canonical borrower UUID (`whoami.borrower_id ?? whoami.principal_id`) |
| `terminal_id` | Must match the terminal from `register_borrower`. Omit to use `SOHO_TERMINAL_ID` or the host default — then sign PoP over that same resolved value |
| `public_jwk` | `{ kty: "OKP", crv: "Ed25519", x }` only — no `d` |
| `jkt` | RFC 7638 thumbprint; gateway recomputes and must match |
| `nonce` | Single-use PoP nonce (agent-generated) |
| `iat` | Unix seconds; gateway enforces skew |
| `pop_signature` | Ed25519 signature over the PoP payload |
| Scope | `borrower:token` |
| Idempotent | Yes — pass `idempotency_key` when the harness cannot set headers |

Register once per terminal during onboarding (step 5). On later pays, reuse the same key only when `borrower_id` and `jkt` match. Voucher signing after `VOUCHER_ISSUED`: `{SKILL:sohopay-x402}`.

Registering the key does **not** authorize spending. Immediately follow `{SKILL:sohopay-authorize-agent}` — do not wait for a payRequest or a `prepare_x402_payment` 403. Pay-time `AGENT_AUTHORIZATION_REQUIRED` is recovery only.
