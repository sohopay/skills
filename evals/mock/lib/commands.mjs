// Command bodies, mirroring @sohopay/agent-signer@0.3.1 src/cli/commands.ts, key-generate.ts, io.ts, io-schema.ts.
// Output field sets, field order, error codes and messages are the real ones; only the key material differs
// (see keymodel.mjs) and `header_value` is the run's FAKE-SP6-CANARY-HDR- value instead of base64(envelope).
import { closeSync, openSync, readFileSync, writeFileSync, chmodSync, renameSync, mkdirSync, fsyncSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { SignerError, UsageError } from "./errors.mjs";
import { loadKeyFile, validateKeyPath } from "./keypath.mjs";
import {
  SUPPORTED_SIGNING, VOUCHER_CORE_FIELDS, computeJkt, computePaymentId, popMessage, publicFromPrivate, signWith, voucherSignedBytes,
} from "./keymodel.mjs";

export const SIGNER_PROTOCOL = "sohopay-signer/1";
export const IMPLEMENTATION = "@sohopay/agent-signer";
export const VERSION = "0.3.1";
export const COMMANDS = ["voucher sign", "payment-id", "key jkt", "key generate", "pop sign", "verify-vectors", "capabilities"];
const COMMAND_CONTRACTS = { "key generate": "workload-keygen/1", "pop sign": "pop-sign/1" };
// The real 0.2.0 advertisement: no key generate, no command_contracts (git 72bd896 src/cli/commands.ts).
const COMMANDS_020 = ["voucher sign", "payment-id", "key jkt", "pop sign", "verify-vectors", "capabilities"];

/** `capabilities` — 0.3.1, or the real 0.2.0 shape for a signer that lacks the keygen contract. */
export function capabilitiesResult(profile) {
  if (profile === "0.2.0") {
    return { signer_protocol: SIGNER_PROTOCOL, implementation: IMPLEMENTATION, implementation_version: "0.2.0", algorithms: ["Ed25519"], commands: COMMANDS_020 };
  }
  return {
    signer_protocol: SIGNER_PROTOCOL, implementation: IMPLEMENTATION, implementation_version: VERSION,
    algorithms: ["Ed25519"], commands: COMMANDS, command_contracts: COMMAND_CONTRACTS,
  };
}

/** io.ts readInput: absent --input is a usage error; unreadable / non-JSON is MALFORMED_ENVELOPE. */
export function readInput(source, stdin, cwd) {
  if (source === undefined) throw new UsageError("this command requires --input <file|->");
  let raw;
  if (source === "-") raw = stdin;
  else {
    try { raw = readFileSync(resolve(cwd, source), "utf8"); } catch { throw new SignerError("MALFORMED_ENVELOPE", `cannot read input file: ${source}`); }
  }
  try { return JSON.parse(raw); } catch { throw new SignerError("MALFORMED_ENVELOPE", "input is not valid JSON"); }
}

const INPUT_ALLOW = { "pop sign": { top: ["fields"], fields: ["borrowerId", "terminalId", "jkt"] }, "key generate": { top: ["borrower_id", "terminal_id"] } };
const outside = (obj, allow) => Object.keys(obj).filter((k) => !allow.includes(k));
/** io-schema.ts assertInputSchema (INV-ioschema). */
export function assertInputSchema(command, input) {
  const spec = INPUT_ALLOW[command];
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new SignerError("MALFORMED_INPUT", `${command} input must be an object`);
  const extraTop = outside(input, spec.top);
  if (extraTop.length > 0) throw new SignerError("MALFORMED_INPUT", `${command}: unexpected input field(s): ${extraTop.join(", ")}`);
  if (spec.fields) {
    const f = input.fields;
    if (f === null || typeof f !== "object" || Array.isArray(f)) throw new SignerError("MALFORMED_INPUT", `${command} requires a \`fields\` object`);
    const extra = outside(f, spec.fields);
    if (extra.length > 0) throw new SignerError("MALFORMED_INPUT", `${command}: unexpected field(s): ${extra.join(", ")}`);
  }
}

/** `payment-id`: `{ core } → { payment_id }`. */
export function paymentIdResult(input) {
  const core = input?.core;
  if (core === null || typeof core !== "object") throw new SignerError("MALFORMED_ENVELOPE", "payment-id requires a `core` object");
  assertCoreStrings(core);
  return { payment_id: computePaymentId(core) };
}

/** `key jkt`: public JWK → thumbprint; inline private material is rejected. */
export function keyJktResult(input) {
  const record = input ?? {};
  const block = record.public_jwk !== undefined ? { public_jwk: record.public_jwk } : record.key;
  if (block && typeof block === "object" && block.private_key_base64url !== undefined) {
    throw new SignerError("INLINE_KEY_REJECTED", "key jkt does not accept inline private key material; pass public_jwk");
  }
  if (block === null || typeof block !== "object") throw new SignerError("MALFORMED_ENVELOPE", "key block must be an object");
  if (block.public_jwk === undefined) throw new SignerError("MALFORMED_ENVELOPE", "key jkt requires public_jwk or a key with private/public material");
  return { agent_key_jkt: computeJkt(assertPublicJwk(block.public_jwk)) };
}

function assertPublicJwk(v) {
  if (v === null || typeof v !== "object") throw new SignerError("INVALID_PUBLIC_JWK", "public JWK must be an object");
  if ("d" in v) throw new SignerError("PRIVATE_KEY_MATERIAL_REJECTED", "JWK must not contain private key material (d)");
  if (v.kty !== "OKP" || v.crv !== "Ed25519" || typeof v.x !== "string" || v.x.length === 0) {
    throw new SignerError("INVALID_PUBLIC_JWK", "expected an Ed25519 OKP public JWK with a non-empty x");
  }
  return { kty: "OKP", crv: "Ed25519", x: v.x };
}

function assertCoreStrings(core) {
  for (const f of VOUCHER_CORE_FIELDS) {
    if (typeof core[f] !== "string") throw new SignerError("VOUCHER_FIELD_NOT_STRING", `voucher field "${f}" must be a string, got ${typeof core[f]}`);
  }
}

const str = (rec, k) => {
  const v = rec[k];
  if (typeof v !== "string" || v.length === 0) throw new SignerError("MALFORMED_INPUT", `key generate requires a non-empty string \`${k}\``);
  return v;
};
const publicMaterial = (s) => ({ public_jwk: s.public_jwk, jkt: s.jkt, borrower_id: s.borrower_id, terminal_id: s.terminal_id });

/** storage.ts writeSecretFileAtPath: temp file → fsync → 0600 → rename over the O_EXCL placeholder. */
function writeSecretFileAtPath(path, stored) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.secret.${process.pid}.${Date.now()}.tmp`);
  const fd = openSync(tmp, "w", 0o600);
  try { writeFileSync(fd, `${JSON.stringify(stored, null, 2)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

/** key-generate.ts: ensure-mode — never overwrites; an existing file is verified (borrower, terminal, integrity). */
export function keyGenerateResult(input, outPath, ctx) {
  if (outPath === undefined) throw new SignerError("MALFORMED_INPUT", "key generate requires --out <path>");
  const rec = input ?? {};
  const borrowerId = str(rec, "borrower_id");
  const terminalId = str(rec, "terminal_id");
  let existing;
  try { existing = loadKeyFile(validateKeyPath(outPath, "read", ctx)); } catch (e) { if (e.code !== "KEY_PATH_INVALID") throw e; }
  if (existing) {
    if (existing.borrower_id !== borrowerId) throw new SignerError("CROSS_BORROWER_KEY", "a key for a different borrower exists at this path");
    if (existing.terminal_id !== terminalId) throw new SignerError("TERMINAL_MISMATCH", "the stored key is bound to a different terminal");
    const derived = publicFromPrivate(existing.private_key_base64url);
    if (derived.jkt !== existing.jkt || derived.publicJwk.x !== existing.public_jwk?.x) {
      throw new SignerError("KEY_INTEGRITY_FAILED", "stored public material does not match the private key");
    }
    return { ...publicMaterial(existing), created: false };
  }
  const writePath = validateKeyPath(outPath, "ensure", ctx);
  const priv = ctx.privateKey();
  const { publicJwk, jkt } = publicFromPrivate(priv);
  const stored = { private_key_base64url: priv, public_jwk: publicJwk, jkt, terminal_id: terminalId, borrower_id: borrowerId };
  try { closeSync(openSync(writePath, "wx", 0o600)); } catch (e) {
    if (e.code === "EEXIST") return keyGenerateResult(input, outPath, ctx);
    throw new SignerError("KEY_PERSIST_FAILED", `cannot create ${writePath}`);
  }
  try { writeSecretFileAtPath(writePath, stored); } catch { throw new SignerError("KEY_PERSIST_FAILED", "cannot persist the workload key"); }
  return { ...publicMaterial(stored), created: true };
}

/** pop sign: binds borrower/terminal/jkt to the key file, mints its own nonce + iat (never the caller's). */
export function popSignResult(input, keyFileSource, ctx) {
  const fields = input?.fields;
  if (fields === null || fields === undefined || typeof fields !== "object") throw new SignerError("MALFORMED_INPUT", "pop sign requires a `fields` object");
  if (keyFileSource === undefined) throw new SignerError("MALFORMED_INPUT", "pop sign requires --key <path>");
  const { borrowerId, terminalId, jkt } = fields;
  if (typeof borrowerId !== "string" || typeof terminalId !== "string" || typeof jkt !== "string") {
    throw new SignerError("MALFORMED_INPUT", "pop sign fields require string borrowerId, terminalId, jkt");
  }
  const stored = loadKeyFile(validateKeyPath(keyFileSource, "read", ctx));
  if (stored.borrower_id !== borrowerId) throw new SignerError("CROSS_BORROWER_KEY", "fields.borrowerId does not match the key file");
  if (stored.terminal_id !== terminalId) throw new SignerError("TERMINAL_MISMATCH", "fields.terminalId does not match the key file");
  if (stored.jkt !== jkt) throw new SignerError("AGENT_KEY_JKT_MISMATCH", "fields.jkt does not match the key file");
  const nonce = randomBytes(32).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const pop_signature = signWith(stored.private_key_base64url, popMessage({ borrowerId, terminalId, jkt, nonce, iat }));
  return { signer_protocol: SIGNER_PROTOCOL, implementation: IMPLEMENTATION, implementation_version: VERSION, pop_signature, nonce, iat, algorithm: "Ed25519" };
}

function resolveSigningKey(record, keyFileSource, ctx) {
  if (record.key !== undefined) throw new SignerError("INLINE_KEY_REJECTED", "inline key material is not accepted; use --key <path>");
  if (keyFileSource === undefined) throw new SignerError("MALFORMED_INPUT", "signing requires --key <path>");
  const stored = loadKeyFile(validateKeyPath(keyFileSource, "read", ctx));
  if (typeof stored.private_key_base64url !== "string") throw new SignerError("MALFORMED_ENVELOPE", "signing key is missing private_key_base64url");
  return stored;
}

/** voucher.ts signVoucher guards: scheme allowlist, paymentId recompute, jkt binding. */
function signVoucher(voucher, signing, stored) {
  if (signing) {
    for (const k of ["algorithm", "domain_tag", "canonicalization", "signature_encoding"]) {
      if (signing[k] !== undefined && signing[k] !== SUPPORTED_SIGNING[k]) {
        throw new SignerError("SIGNING_SCHEME_NOT_ALLOWED", `server proposed ${k}="${signing[k]}"; this SDK signs only "${SUPPORTED_SIGNING[k]}"`);
      }
    }
  }
  assertCoreStrings(voucher);
  if (computePaymentId(voucher).toLowerCase() !== String(voucher.paymentId).toLowerCase()) {
    throw new SignerError("PAYMENT_ID_MISMATCH", "voucher.paymentId does not match the hash of its core");
  }
  const { jkt } = publicFromPrivate(stored.private_key_base64url);
  if (jkt !== voucher.agentKeyJkt) throw new SignerError("AGENT_KEY_JKT_MISMATCH", "voucher.agentKeyJkt does not match the signing key's thumbprint");
  return signWith(stored.private_key_base64url, voucherSignedBytes(voucher));
}

/** `voucher sign` (no --envelope). */
export function voucherSignResult(input, keyFileSource, ctx) {
  const record = input ?? {};
  const voucher = record.voucher;
  if (voucher === null || typeof voucher !== "object") throw new SignerError("MALFORMED_ENVELOPE", "voucher sign requires a `voucher` object");
  const stored = resolveSigningKey(record, keyFileSource, ctx);
  const signature = signVoucher(voucher, record.signing, stored);
  return {
    signer_protocol: SIGNER_PROTOCOL, implementation: IMPLEMENTATION, implementation_version: VERSION,
    payment_id: voucher.paymentId, agent_key_jkt: voucher.agentKeyJkt, signature, algorithm: "Ed25519",
  };
}

/** `voucher sign --envelope`: fills ONLY paymentPayload.payload.signature; never re-signs a filled envelope. */
export function voucherSignEnvelopeResult(input, keyFileSource, ctx) {
  const record = input ?? {};
  const voucher = record.voucher;
  if (voucher === null || typeof voucher !== "object") throw new SignerError("MALFORMED_ENVELOPE", "voucher sign --envelope requires a `voucher` object");
  const prep = record.envelope;
  if (prep === null || typeof prep !== "object") throw new SignerError("MALFORMED_ENVELOPE", "voucher sign --envelope requires an `envelope` object");
  const headerName = record.header_name;
  if (typeof headerName !== "string" || headerName.length === 0) throw new SignerError("MALFORMED_ENVELOPE", "voucher sign --envelope requires a non-empty string `header_name`");
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(headerName)) throw new SignerError("MALFORMED_ENVELOPE", "header_name is not a valid HTTP header name");
  const payload = prep.paymentPayload?.payload;
  if (payload === null || typeof payload !== "object") throw new SignerError("MALFORMED_ENVELOPE", "input envelope is missing paymentPayload.payload");
  if (payload.signature !== undefined && payload.signature !== null) throw new SignerError("MALFORMED_ENVELOPE", "input envelope already carries a signature");
  const embedded = payload.voucher?.paymentId;
  if (typeof embedded !== "string") throw new SignerError("MALFORMED_ENVELOPE", "input envelope is missing paymentPayload.payload.voucher.paymentId");
  if (embedded !== voucher.paymentId) throw new SignerError("PAYMENT_ID_MISMATCH", "voucher paymentId does not match the envelope's embedded voucher");
  const stored = resolveSigningKey(record, keyFileSource, ctx);
  const signature = signVoucher(voucher, record.signing, stored);
  const envelope = structuredClone(prep);
  envelope.paymentPayload.payload.signature = signature;
  return {
    signer_protocol: SIGNER_PROTOCOL, implementation: IMPLEMENTATION, implementation_version: VERSION,
    payment_id: voucher.paymentId, agent_key_jkt: voucher.agentKeyJkt, signature, algorithm: "Ed25519",
    envelope, header_name: headerName, header_value: ctx.headerValue(),
  };
}
