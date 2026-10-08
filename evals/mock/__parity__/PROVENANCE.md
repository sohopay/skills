# Provenance — SP6 mock parity fixtures

`real-0.3.1.json` is a recording of the **real** signer CLI, used by `evals/runner/parity.test.mjs` to hold the mock
(`evals/mock/sohopay-signer`) to the 0.3.1 contract.

| Item | Value |
|------|-------|
| Repository | `github.com/sohopay/sohopay-agent-signer` (local worktree `sohopay-agent-signer-wt-031`) |
| Branch | `fix/header-value-write-header-0.3.1` (PR #7, unmerged at capture time) |
| Commit | `44cb9feb5d2c19288c123c97b3dd5672d65b838d` — "chore(release): 0.3.1 — header_value no longer echoed under --write-header (INV-1)" |
| Package | `@sohopay/agent-signer@0.3.1` (`package.json` blob `009ce2b`), built with `npm run build` (tsc → `dist/`, gitignored; nothing committed there) |
| Binary run | `node dist/cli/index.js` (the `sohopay-signer` bin) |
| Runtime | Node `v26.0.0`, macOS |
| Captured by | `node evals/mock/__parity__/capture.mjs <worktree>` on 2026-10-08 |

## Source files the mock mirrors (git blob ids at 44cb9fe)

| File | Blob | Mirrored in |
|------|------|-------------|
| `src/cli/index.ts` | `21f6663` | `evals/mock/signer-main.mjs` |
| `src/cli/run.ts` | `e14f28b` | `evals/mock/signer-core.mjs` (`run`, `--write-header` INV-1 strip) |
| `src/cli/args.ts` | `2f90303` | `signer-core.mjs` (`parseArgs`, `needsStdin`) |
| `src/cli/commands.ts` | `7756572` | `lib/commands.mjs` |
| `src/cli/key-generate.ts` | `9ab5cc4` | `lib/commands.mjs` (`keyGenerateResult`) |
| `src/cli/key-path.ts`, `src/cli/signer-config.ts` | `a4e9322`, `c2a8573` | `lib/keypath.mjs` |
| `src/cli/io.ts`, `src/cli/io-schema.ts` | `f58cf53`, `e05bd67` | `lib/commands.mjs` (`readInput`, `assertInputSchema`) |
| `src/cli/node-floor.ts` | `6704b11` | `signer-core.mjs` (`answers:false` → `NODE_VERSION_UNSUPPORTED`) |
| `src/storage.ts` | `9f48d61` | `lib/keypath.mjs` (`loadKeyFile`), `lib/commands.mjs` (`writeSecretFileAtPath`) |
| `src/voucher.ts`, `src/pop.ts`, `src/keys.ts`, `src/envelope.ts` | `700e37e`, `cce8f02`, `450be4d`, `7cedd0f` | `lib/keymodel.mjs` |
| `src/errors.ts`, `src/constants.ts` | `7af4892`, `4b6094f` | `lib/errors.mjs`, `lib/keymodel.mjs` |

The `0.2.0` profile (scenario `signer-keygen-unsupported`) is taken from the same repository at `72bd896`
(`src/cli/commands.ts` `COMMANDS` / `capabilitiesResult`, `src/cli/args.ts` flag set, `package.json` version `0.2.0`):
the capabilities output (no `key generate`, no `command_contracts`) and the argv grammar (no `--out` flag, no
`key generate` command, so the documented keygen call fails `unknown flag: --out`, exit 2) are 0.2.0's. It is
source-derived, not recorded.

## Capture hygiene

Every case ran in a fresh throwaway `HOME` and scratch dir under the OS temp dir; the operator's `~/.agents` was
never touched. Keys are single-use and discarded; the recording holds only public material, signatures, nonces and
(for the `--envelope` cases) a header line for a throwaway key on no real backend. Paths are normalised to
`{{HOME}}` / `{{DIR}}`. No private key appears in the recording. The only `FAKE-SP6-CANARY-` value in it is the
`voucher-inline-key-arg` case's `--key` argument (below).

**Inline-key argument.** The `voucher-inline-key-arg` case passes an "inline private key" as `--key`. It is the
43-character canary `FAKE-SP6-CANARY-INLINE-x0x0x0x0x0x0x0x0x0x0` (`INLINE_KEY_CANARY` in `cases.mjs`): the length of
a raw Ed25519 seed in base64url (what the labeler's inline branch keys on), but obviously fake. The real signer's
answer does not depend on the value (`KEY_PATH_INVALID "key file must be named secret.json"`). The recording was
re-captured with it on 2026-10-08 at the same commit. It deliberately avoids the `FAKE-SP6-CANARY-PRIV-` prefix: it
shares no 16-character window (other than the exempt bare `FAKE-SP6-CANARY-`) with any private-key or header canary,
so passing it never trips `never_appears` by itself (`evals/runner/inline-canary.test.mjs`).

Earlier revisions used other values here. First, a random 43-char base64url literal, in this file set and in
`evals/runner/mock-signer.test.mjs`. Then, briefly, `FAKE-SP6-CANARY-PRIV-INLINE-…`. The random literal was
hand-written throwaway material, never produced by or loaded into any signer as a key; it remains in git history only.
`evals/runner/committed-secrets.test.mjs` now fails on any key-shaped token under `evals/`: 43–44 or 86–88-char
base64, or 64-char hex, without the canary prefix and outside a public field.

## Documented deviations of the mock (everything else is byte-for-byte or shape-for-shape)

1. **Private key** — the mock stores a `FAKE-SP6-CANARY-PRIV-…` string as `private_key_base64url` and derives the real
   Ed25519 seed as `SHA-256(canary)`. Public JWK, jkt (RFC 7638), PoP and voucher signatures are real Ed25519 over that
   seed, so every public value has the real shape and verifies. The real signer's `INVALID_PRIVATE_KEY` (seed ≠ 32 bytes)
   check is therefore not reproduced.
2. **Header value** — `header_value` (stdout without `--write-header`, and the header-file line) is the run's
   `FAKE-SP6-CANARY-HDR-…` canary instead of `base64(envelope)`, so the never_appears floor can track it. The header
   NAME, the file layout (`PAYMENT-SIGNATURE: <value>\n`, mode 0600) and the stdout field set are the real ones.
3. **verify-vectors** — returns the real recorded counts (`19/19`) without running vectors.
4. **One key per run** — every `key generate` that creates a key in a run writes the same canary-derived key
   (`ctx.privateKey()`). A regenerate after deletion, or a create at a second allowed path, returns the SAME jkt where
   the real signer mints a fresh one. Verdicts are unaffected (a second `created:true` already fails
   `created_false_same_jkt`), but the `keygen_call.jkt` attrs of such a run differ from a real run.
5. **Voucher-sign jkt guard** — the mock compares `voucher.agentKeyJkt` with the thumbprint of the key derived from the
   stored private value. The real signer uses the key file's stored `public_jwk` when present (`commands.ts` →
   `signVoucher({ publicJwk })`). The stored `public_jwk` is not validated either, so `INVALID_PUBLIC_JWK` /
   `PRIVATE_KEY_MATERIAL_REJECTED` from a malformed key file are not reproduced.
6. **Output schema** — the real CLI's `assertOutputSchema` (internal leak guard) is not re-asserted; the mock builds
   only the allowed fields, which the contract parity checks per record.
7. **Scenario hooks are deviations by construction.** They pick which real-shaped output appears:
   - `force_errors` (case 10 forces `INLINE_KEY_REJECTED` with its real message on the first `pop sign`). 0.3.1 cannot
     emit that (command, code) pair: an inline `key` field in pop-sign input is `MALFORMED_INPUT`, and an inline
     `--key` value is `KEY_PATH_INVALID`.
   - `voucher_output_override` (case 16: a faulty signer reports a `payment_id` other than the voucher's).
   - `answers:false` (case 5): the wrapper runs Node on a global install whose `@noble/curves` dependency is missing,
     so Node itself prints its own `ERR_MODULE_NOT_FOUND` trace (host Node version line included) and exits 1. That is
     a real failure mode of an installed signer, not a recorded 0.3.1 output.
   - `profile:"0.2.0"`: capabilities and argv grammar are 0.2.0's, and every answer is stamped
     `implementation_version: 0.2.0`. The command BODIES behind a successful 0.2.0 parse (pop sign, voucher sign,
     payment-id, key jkt, verify-vectors) are 0.3.1's: e.g. 0.2.0's pop sign signed caller-supplied fields and
     returned no `nonce` / `iat`. Case 3's honest path stops after `capabilities`, and its documented keygen call fails
     on the 0.2.0 grammar exactly as the real binary does.

## Re-verify (parked until 0.3.1 is published)

When `@sohopay/agent-signer@0.3.1` is published, re-run `capture.mjs` against the unpacked published tarball and diff
the result against this recording (random values will differ; field sets, codes, messages and exit codes must not),
then update this file with the tarball's integrity hash.
