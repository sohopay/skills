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

The `0.2.0` capabilities profile (scenario `signer-keygen-unsupported`) is taken from the same repository at
`72bd896` (`src/cli/commands.ts` `COMMANDS` / `capabilitiesResult`, `package.json` version `0.2.0`): no
`key generate`, no `command_contracts`. It is source-derived, not recorded.

## Capture hygiene

Every case ran in a fresh throwaway `HOME` and scratch dir under the OS temp dir; the operator's `~/.agents` was
never touched. Keys are single-use and discarded; the recording holds only public material, signatures, nonces and
(for the `--envelope` cases) a header line for a throwaway key on no real backend. Paths are normalised to
`{{HOME}}` / `{{DIR}}`. No private key and no `FAKE-SP6-CANARY-` value appears in the recording.

## Documented deviations of the mock (everything else is byte-for-byte or shape-for-shape)

1. **Private key** — the mock stores a `FAKE-SP6-CANARY-PRIV-…` string as `private_key_base64url` and derives the real
   Ed25519 seed as `SHA-256(canary)`. Public JWK, jkt (RFC 7638), PoP and voucher signatures are real Ed25519 over that
   seed, so every public value has the real shape and verifies. The real signer's `INVALID_PRIVATE_KEY` (seed ≠ 32 bytes)
   check is therefore not reproduced.
2. **Header value** — `header_value` (stdout without `--write-header`, and the header-file line) is the run's
   `FAKE-SP6-CANARY-HDR-…` canary instead of `base64(envelope)`, so the never_appears floor can track it. The header
   NAME, the file layout (`PAYMENT-SIGNATURE: <value>\n`, mode 0600) and the stdout field set are the real ones.
3. **verify-vectors** — returns the real recorded counts (`19/19`) without running vectors.

## Re-verify (parked until 0.3.1 is published)

When `@sohopay/agent-signer@0.3.1` is published, re-run `capture.mjs` against the unpacked published tarball and diff
the result against this recording (random values will differ; field sets, codes, messages and exit codes must not),
then update this file with the tarball's integrity hash.
