// The 0.3.1 CLI's two failure classes: UsageError (exit 2, plain-text stderr) and SignerError (exit 1,
// `{"error":{"code","message"}}` on stderr). Mirrors src/cli/args.ts UsageError and src/errors.ts SignerError.

export class UsageError extends Error {
  constructor(message) { super(message); this.name = "UsageError"; }
}

export class SignerError extends Error {
  constructor(code, message) { super(message); this.name = "SignerError"; this.code = code; }
}

/** The real message each code carries on the path a scenario forces it from (copied from the 0.3.1 source). */
export const REAL_MESSAGES = {
  CROSS_BORROWER_KEY: "a key for a different borrower exists at this path",
  TERMINAL_MISMATCH: "the stored key is bound to a different terminal",
  KEY_INTEGRITY_FAILED: "stored public material does not match the private key",
  KEY_PATH_INVALID: "key file must be named secret.json",
  KEY_PERSIST_FAILED: "cannot persist the workload key",
  MALFORMED_INPUT: "signing requires --key <path>",
  INLINE_KEY_REJECTED: "inline key material is not accepted; use --key <path>",
};
