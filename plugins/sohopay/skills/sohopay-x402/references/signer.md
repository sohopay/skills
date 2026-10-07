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
3. `npx --no @sohopay/agent-signer@0.3.0` (exact pin — never a floating tag; **disallowed for `key generate`**, see below)

Each candidate gets a **10 s** timeout; a timeout or spawn failure is a **miss** — try the
next. Worst case is ~30 s. A candidate **answers** iff: `<signer> capabilities --output json` exits 0, its
stdout parses as JSON, and `signer_protocol === "sohopay-signer/1"`. If `capabilities`
reports embedded vectors, run `<signer> verify-vectors --output json` once and require exit 0 — a
**nonzero exit is a miss** (try the next candidate, not a hard stop). When `implementation`
is `@sohopay/agent-signer`, also require `implementation_version >= 0.2.0` (the version that
emits the curl-ready header line).

If **no** candidate answers → **`SIGNER_UNAVAILABLE`**: stop and report to the operator.
Never hand-sign, never WebSearch for crypto, never `pip install` / `npm install` a crypto lib.

**Pin + keygen carve-out (A2).** The npx tier is pinned to the exact version `@sohopay/agent-signer@0.3.0` for all voucher invocations — never a floating tag. True supply-chain integrity arrives with SP3's attested bundle (future: pin the bundle hash). **For `key generate` the npx tier is disallowed entirely** — a secret-writing command runs only on a locally-installed signer (`$SOHOPAY_SIGNER` or `sohopay-signer` on `PATH`). See `{SKILL:sohopay-onboard}` `references/workload-key.md` for the keygen resolution rules and the `SIGNER_KEYGEN_REQUIRES_LOCAL` install path.

### Sign the voucher

First obtain the prepare response; then one signer invocation (the envelope-mode
`voucher sign` call) produces the whole header.

**MCP flow (normal).** Prepare is the **MCP `prepare_x402_payment` tool** (see the prepare
recipe in `{SKILL:sohopay-x402}`); its response is already in context. Shell variables do
not survive between tool calls, so use the **literal** directory that `mktemp` prints:

1. One Bash call: `mktemp -d`. Note the directory it prints — `<dir>` below.
2. Write the prepare response to `<dir>/prep.json` with the host's **file-write tool**,
   **byte-for-byte as received — no re-serialization**. Never put the JSON in a shell command.
3. One Bash call:

   ```
   <signer> voucher sign --envelope --key <secret.json path> --input <dir>/prep.json --write-header <dir>/hdr.txt --output json
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
<signer> voucher sign --envelope --key <secret.json path> --input "$dir/prep.json" --write-header "$dir/hdr.txt" --output json
```

- `--input` is the **full** prepare response (`{ voucher, signing, envelope, header_name, … }`),
  written byte-for-byte as received from the prepare call (no re-serialization). **Never** interpolate the JSON into a shell string.
- `--key` is the **canonical key path** — the single source of this literal across all skills:
  `~/.agents/sohopay-agent-workload/secret.json`. Onboarding (`{SKILL:sohopay-onboard}`)
  writes the key here via `key generate --out`, and the voucher path reads it via
  `voucher sign --key`. The agent **MUST NOT** read, print, parse, copy, or summarize this
  file; the private key **MUST NOT** appear in `argv`, `stdin`, or any tool input.
- `--write-header` writes a curl-ready `PAYMENT-SIGNATURE: <value>` line (mode 0600).

### Consume the output and retry

The signer prints JSON on stdout with `signer_protocol`, `payment_id`, `agent_key_jkt`,
`header_name`, `header_value` (and more).

1. Assert `header_name === "PAYMENT-SIGNATURE"`, else stop (`UNEXPECTED_HEADER_NAME`).
2. **Cross-check** against the prepare response: `payment_id` must equal the prepare
   `voucher.paymentId`, and `agent_key_jkt` must equal the prepare `voucher.agentKeyJkt`
   (the backend-registered key's thumbprint). Any mismatch → stop, **no retry**.
3. `header_value` is **opaque** — never decode, edit, re-encode, or echo it (it is a
   replayable credential until expiry). Retry the merchant with the header **file** —
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
retry**. Never fall back to hand-signing; never re-invoke with modified input. The error
codes and their meanings are the SP1 signer contract — do not restate them here.

| Condition | Action |
|-----------|--------|
| No candidate answers | `SIGNER_UNAVAILABLE` → stop, report |
| Nonzero exit / `{"error":{"code",…}}` | Surface the code → stop (no retry, no hand-sign) |
| `header_name` ≠ `PAYMENT-SIGNATURE` | `UNEXPECTED_HEADER_NAME` → stop |
| `payment_id` / `agent_key_jkt` mismatch | Stop, no retry |
| Retry fails terminally or voucher expired | **Re-prepare** (new `payment_id`), then sign the fresh envelope — never re-sign a stale one |
