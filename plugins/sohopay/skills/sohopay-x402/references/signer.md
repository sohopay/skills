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
3. `npx --no @sohopay/agent-signer`

Each candidate gets a **10 s** timeout; a timeout or spawn failure is a **miss** — try the
next. Worst case is ~30 s. A candidate **answers** iff: `<signer> capabilities` exits 0, its
stdout parses as JSON, and `signer_protocol === "sohopay-signer/1"`. If `capabilities`
reports embedded vectors, run `<signer> verify-vectors` once and require exit 0 — a
**nonzero exit is a miss** (try the next candidate, not a hard stop). When `implementation`
is `@sohopay/agent-signer`, also require `implementation_version >= 0.2.0` (the version that
emits the curl-ready header line).

If **no** candidate answers → **`SIGNER_UNAVAILABLE`**: stop and report to the operator.
Never hand-sign, never WebSearch for crypto, never `pip install` / `npm install` a crypto lib.

### Sign the voucher (one call)

Call `prepare_x402_payment` (carrying the borrower token and `Idempotency-Key` header; see
the prepare recipe in `{SKILL:sohopay-x402}` for details), write its response to a
private temp dir, then invoke the signer:

```
dir=$(mktemp -d); chmod 700 "$dir"
umask 077
# prepare_x402_payment HTTP call itself, write response straight to disk byte-for-byte.
curl -fsS … -o "$dir/prep.json" {MERCHANT_BASE_URL}/api/v1/prepare_x402_payment
<signer> voucher sign --envelope --key <secret.json path> --input "$dir/prep.json" --write-header "$dir/hdr.txt"
```

- `--input` is the **full** prepare response (`{ voucher, signing, envelope, header_name, … }`),
  written byte-for-byte as received from the prepare call. If the host must use a file-write
  tool instead of curl, it writes the response **byte-for-byte as received — no
  re-serialization**. **Never** interpolate the JSON into a shell string (a quoted heredoc
  `<<'SOHOPAY_EOF'` is a shell-only last resort).
- `--key` is the **opaque** canonical key path onboarding wrote
  (`~/.agents/sohopay-agent-workload/secret.json`). The agent **MUST NOT** read, print,
  parse, copy, or summarize it; the private key **MUST NOT** appear in `argv`, `stdin`, or
  any tool input.
- `--write-header` writes a curl-ready `PAYMENT-SIGNATURE: <value>` line (mode 0600).

### Consume the output and retry

The signer prints JSON on stdout with `signer_protocol`, `payment_id`, `agent_key_jkt`,
`header_name`, `header_value` (and more).

1. Assert `header_name === "PAYMENT-SIGNATURE"`, else stop (`UNEXPECTED_HEADER_NAME`).
2. **Cross-check** against the prepare response: `payment_id` must equal the prepare
   `voucher.paymentId`, and `agent_key_jkt` must equal the prepare `voucher.agentKeyJkt`
   (the backend-registered key's thumbprint). Any mismatch → stop, **no retry**.
3. `header_value` is **opaque** — never decode, edit, re-encode, or echo it (it is a
   replayable credential until expiry). Retry the merchant with the header **file**:

   ```
   curl -fsS -H @"$dir/hdr.txt" {MERCHANT_BASE_URL}
   ```
4. **On any exit from this flow** (success, cross-check mismatch stop, or signer error),
   delete the temp dir: `rm -rf "$dir"`. Both `prep.json` and `hdr.txt` must never be left
   on disk.

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
