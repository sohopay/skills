## Route signing to the signer (never hand-roll crypto)

The agent **never** canonicalizes, hashes, Ed25519-signs, or base64-encodes a voucher. It
routes to a runtime **signer** that does, and copies the result opaquely. If no conformant
signer is present, **fail closed** — do not improvise.

**Ordering invariant:** sign runs only after the consent / first-time-merchant gate has
passed — `consent_ok → prepare → sign → retry`. The gate lives in the pay flow
(`{SKILL:sohopay-spend}`); this reference covers only sign → retry.

### Resolve a signer

Try these in order; use the first that **answers**:

1. `$SOHOPAY_SIGNER` (explicit command/path override)
2. `sohopay-signer` on `PATH`
3. `npx --no @sohopay/agent-signer@0.4.0` (exact pin — never a floating tag; **disallowed for `key generate`**, see below)

Each candidate gets a **10 s** timeout; a timeout or spawn failure is a **miss** — try the
next. Worst case is ~30 s. A candidate **answers** iff: `<signer> capabilities --output json` exits 0, its
stdout parses as JSON, and `signer_protocol === "sohopay-signer/1"`. If `capabilities`
reports embedded vectors, run `<signer> verify-vectors --output json` once, as its own Bash call (never chained with a key command), and require exit 0 — a
**nonzero exit is a miss** (try the next candidate, not a hard stop). When `implementation`
is `@sohopay/agent-signer`, also require `implementation_version >= 0.4.0` (the pinned version;
it adds per-terminal keys, and `0.3.0` echoed `header_value` back on stdout under `--write-header`, i.e. a header-leaking
signer — this floor must exclude it, so never accept a version below the pin). If a resolved
signer ever prints `header_value` on stdout, treat it as non-conformant and **STOP** — report a
header-leaking signer and never retry the merchant with it.

If **no** candidate answers → **`SIGNER_UNAVAILABLE`**: stop and report to the operator.
Never hand-sign, never WebSearch for crypto, never `pip install` / `npm install` a crypto lib. The one exception is the pinned signer itself, installed exactly as `{SKILL:sohopay-onboard}` `references/workload-key.md` shows.

**Pin + keygen carve-out (A2).** The npx tier is pinned to the exact version `@sohopay/agent-signer@0.4.0` for all voucher invocations — never a floating tag. True supply-chain integrity arrives with SP3's attested bundle (future: pin the bundle hash). **For `key generate` the npx tier is disallowed entirely** — a secret-writing command runs only on a locally-installed signer (`$SOHOPAY_SIGNER` or `sohopay-signer` on `PATH`). See `{SKILL:sohopay-onboard}` `references/workload-key.md` for the keygen resolution rules and the `SIGNER_KEYGEN_REQUIRES_LOCAL` install path.

### Terminal id (local harnesses)

Each local install has its own terminal, operational agent and key. Before the first
SohoPay call of a session (`get_context`), resolve the signer and run, as its own Bash call:

```
<signer> terminal id --harness <harness> --output json
```

`<harness>` is the harness running you: `claude-code`, `codex`, `cursor`, `hermes` or
`antigravity`. Any other value fails with `INVALID_HARNESS`; do not invent one. stdout is
`{ "terminal_id": "<harness>:<uuid>" }`. The id is stable: the same harness on this machine
gets the same id every session. It requires `command_contracts["terminal id"] === "workload-terminal/1"`
in `capabilities`; an older signer lacks it, so install the pin first (`{SKILL:sohopay-onboard}`
`references/workload-key.md`).

Pass that `terminal_id` verbatim, never a value of your own, to `get_context`, `register_borrower`
or `register_terminal`, and as `--terminal` on `key generate`, `pop sign` and `voucher sign`.
When `get_context` lists `REGISTER_TERMINAL`, call `register_terminal` with the same input you
would give `register_borrower`. Remote-only connectors (ChatGPT, Claude.ai web, a remote
Perplexity connector) run no signer: they omit `terminal_id` and keep the shared default.

### Sign the voucher

First obtain the prepare response; then one signer invocation (the envelope-mode
`voucher sign` call) produces the whole header.

**MCP flow (normal).** Prepare is the **MCP `prepare_x402_payment` tool** (see the prepare
recipe in `{SKILL:sohopay-x402}`); its response is already in context. Shell variables do
not survive between tool calls, so use the **literal** directory that `mktemp` prints:

1. One Bash call: `mktemp -d` — **only** that, nothing before or after it (no signer lookup, no `echo`, no `;` / `&&` / `|`). Only a call that is exactly `mktemp -d` makes its directory a trusted scratch dir. Note the directory it prints — `<dir>` below. Paste that literal path wherever `<dir>` appears; never assign it to a shell variable (`d=/tmp/…; … $d/prep.json`) — only the literal path is recognised as this call's scratch directory.
2. Write the prepare response to `<dir>/prep.json` with the host's **file-write tool**,
   **byte-for-byte as received — no re-serialization**. Never put the JSON in a shell command.
3. One Bash call:

   ```
   <signer> voucher sign --envelope --terminal <terminal_id> --input <dir>/prep.json --write-header <dir>/hdr.txt --output json
   ```

   Paste the terminal id and both paths literally. For example, if `mktemp -d` printed `/tmp/tmp.Ab12Cd`:

   ```
   sohopay-signer voucher sign --envelope --terminal claude-code:5e0c3b1a-7d2f-4c8e-9a41-2b6d8f0e1c37 --input /tmp/tmp.Ab12Cd/prep.json --write-header /tmp/tmp.Ab12Cd/hdr.txt --output json
   ```
4. Retry the merchant with the header file: `curl -fsS -H @<dir>/hdr.txt {MERCHANT_BASE_URL}`
   (see **Consume the output and retry** below).
5. On any exit, delete the directory: `rm -rf <dir>`.

**Raw-HTTP fallback (non-MCP host only).** A host that calls prepare over raw HTTP does it all
in **one** Bash call, response straight to disk byte-for-byte:

```
dir=$(mktemp -d); chmod 700 "$dir"
umask 077
# Raw-HTTP fallback only (non-MCP host), response straight to disk byte-for-byte:
curl -fsS … -o "$dir/prep.json" {API_BASE}/api/v1/spend/x402/prepare
<signer> voucher sign --envelope --terminal <terminal_id> --input "$dir/prep.json" --write-header "$dir/hdr.txt" --output json
```

- `--input` is the **full** prepare response (`{ voucher, signing, envelope, header_name, … }`),
  written byte-for-byte as received from the prepare call (no re-serialization). **Never** interpolate the JSON into a shell string.
- `--terminal` is the `terminal_id` from **Terminal id** above. The signer derives the key file
  from it; the agent never names, reads, prints, parses, copies or summarizes a key file, and the
  private key **MUST NOT** appear in `argv`, `stdin` or any tool input. Nor may it list, `stat` or
  `echo` anything under `~/.agents` (`ls`, `ls -l`, `ls -ld`): the signer checks the key; the agent
  never inspects it. Onboarding (`{SKILL:sohopay-onboard}`) creates the key with
  `key generate --terminal`, and the voucher path reads it with `voucher sign --terminal`.

  An install onboarded before signer 0.4.0 has its key at `~/.agents/sohopay-agent-workload/secret.json`,
  bound to the old shared terminal. Never move, rename, copy, read or delete it, and never pass that
  path: a new session uses `--terminal`.

  Paste the terminal id **literally** after `--terminal` in every keyed command — never through a
  variable. The onboarding commands (`{SKILL:sohopay-onboard}` `references/workload-key.md`), each as
  its own Bash call exactly as shown:

  ```
  sohopay-signer key generate --terminal <terminal_id> --input - --output json <<'SOHOPAY_EOF'
  { "borrower_id": "…", "terminal_id": "<terminal_id>" }
  SOHOPAY_EOF
  ```

  ```
  sohopay-signer pop sign --terminal <terminal_id> --input - --output json <<'SOHOPAY_EOF'
  { "fields": { "borrowerId": "…", "terminalId": "<terminal_id>", "jkt": "…" } }
  SOHOPAY_EOF
  ```
- **Signer spelling:** write the signer exactly as the candidate that answered — `sohopay-signer`,
  `"$SOHOPAY_SIGNER"` or the pinned `npx --no @sohopay/agent-signer@0.4.0`. Never an absolute path
  to the binary (`/usr/local/bin/sohopay-signer`), never a default expansion (`${SOHOPAY_SIGNER:-sohopay-signer}`),
  never `env …` / `command …` in front of it.
- `--write-header` writes a curl-ready `PAYMENT-SIGNATURE: <value>` line (mode 0600).

### Consume the output and retry

With `--write-header`, the signer prints JSON on stdout with `signer_protocol`,
`implementation`, `implementation_version`, `payment_id`, `agent_key_jkt`, `algorithm`,
`header_name` and `header_file` (the path it wrote). Stdout has no `header_value`, no `envelope` and
no `signature`; the credential exists only in the header file.

1. Assert `header_name === "PAYMENT-SIGNATURE"`, else stop (`UNEXPECTED_HEADER_NAME`).
2. **Cross-check** against the prepare response: `payment_id` must equal the prepare
   `voucher.paymentId`, and `agent_key_jkt` must equal the prepare `voucher.agentKeyJkt`
   (the backend-registered key's thumbprint). Any mismatch → stop, **no retry**.
3. The header file is **opaque**: never read, print, decode, edit or copy it. It is a
   replayable credential until expiry. Retry the merchant with the header **file** —
   `curl -fsS -H @<dir>/hdr.txt {MERCHANT_BASE_URL}` in the MCP flow, or in the raw-HTTP
   fallback call:

   ```
   curl -fsS -H @"$dir/hdr.txt" {MERCHANT_BASE_URL}
   ```
4. **On any exit from this flow** (success, cross-check mismatch stop, or signer error),
   delete the temp dir: `rm -rf <dir>` (fallback: `rm -rf "$dir"`). Both `prep.json` and
   `hdr.txt` must never be left on disk.

### If the signer fails

Any **nonzero signer exit**, unparseable stdout, incompatible `signer_protocol`, or a
missing required field → surface the signer's error **code** and **stop before the merchant
retry**. Never fall back to hand-signing; never re-invoke with modified input (the one
exception: `INLINE_KEY_REJECTED`, below). The error codes and their meanings are the SP1
signer contract — do not restate them here.

**Every stop names its code verbatim** in the final message to the operator — the exact
token, e.g. `SIGNER_UNAVAILABLE`, `SIGNER_UNRESOLVED`, `KEY_PATH_INVALID` — never only a
paraphrase ("the signer isn't available").

| Condition | Action |
|-----------|--------|
| No candidate answers | `SIGNER_UNAVAILABLE` → stop, report |
| Nonzero exit / `{"error":{"code",…}}` | Surface the code → stop (no retry, no hand-sign) |
| `INLINE_KEY_REJECTED` | Re-run the **same** command once, as its own Bash call, with `--terminal <terminal_id>` — never retry with an inline key |
| `header_name` ≠ `PAYMENT-SIGNATURE` | `UNEXPECTED_HEADER_NAME` → stop |
| `payment_id` / `agent_key_jkt` mismatch | Stop, no retry |
| Retry fails terminally or voucher expired | **Re-prepare** (new `payment_id`), then sign the fresh envelope — never re-sign a stale one |
