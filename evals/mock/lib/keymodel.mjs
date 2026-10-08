// The mock's key model. The stored "private key" is a FAKE-SP6-CANARY- string (so any leak of the key file is
// caught by the never_appears floor), and every public value is REAL Ed25519 math over a seed derived from it:
// seed = SHA-256(utf8(canary)). The public JWK, RFC 7638 jkt, PoP signature and voucher signature therefore have
// the exact shapes the real 0.3.1 signer emits (43-char x / jkt / nonce, 86-char signatures), and the mock
// backend can verify them against the registered public key.
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from "node:crypto";
import { keccak256Hex } from "./keccak.mjs";

export const CANARY_PREFIX = "FAKE-SP6-CANARY-";
export const VOUCHER_DOMAIN_TAG = "SohoPay:AgentPaymentVoucher:v2";
export const SUPPORTED_SIGNING = Object.freeze({
  algorithm: "Ed25519",
  domain_tag: VOUCHER_DOMAIN_TAG,
  canonicalization: "RFC8785",
  signature_encoding: "base64url",
});
export const VOUCHER_CORE_FIELDS = ["agentId", "merchantId", "asset", "chainId", "amount", "feeAmount", "orderRef", "nonce", "deadline"];

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/**
 * A fresh canary `FAKE-SP6-CANARY-<KIND>-<20 chars>`: random alnum plus one `~` placed deterministically so that the
 * UNPADDED base64 and base64url forms differ, making them two distinct never_appears forms.
 * Why `~` at a byte offset ≡ 2 (mod 3): base64 emits `+`/`/` only for sextet values 62/63. For ASCII input the
 * only sextet that can reach them is the last one of a 3-byte group, which is the low 6 bits of that group's third
 * byte. `~` (0x7E) has low bits 111110 = 62, so it encodes as `+` (and as `-` in base64url). An alnum-only suffix
 * never does.
 */
export function newCanary(kind) {
  const head = `${CANARY_PREFIX}${kind}-`;
  const chars = [...randomBytes(20)].map((b) => ALNUM[b % ALNUM.length]);
  const at = [0, 1, 2].find((d) => (head.length + d) % 3 === 2);
  chars[at] = "~";
  return head + chars.join("");
}

/** RFC 8785 for the flat all-string / safe-integer objects the signer hashes (keys sorted by UTF-16 units). */
export function jcsFlat(obj) {
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`).join(",")}}`;
}

function privateKeyObject(canary) {
  const seed = createHash("sha256").update(canary, "utf8").digest();
  return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });
}

/** RFC 7638 thumbprint: base64url(SHA-256(JCS({crv, kty, x}))). */
export function computeJkt(jwk) {
  return createHash("sha256").update(jcsFlat({ crv: jwk.crv, kty: jwk.kty, x: jwk.x }), "utf8").digest("base64url");
}

/** Public JWK + jkt derived from the stored private value (what the real signer's workloadKeyFromPrivate does). */
export function publicFromPrivate(canary) {
  const jwk = createPublicKey(privateKeyObject(canary)).export({ format: "jwk" });
  const publicJwk = { kty: "OKP", crv: "Ed25519", x: jwk.x };
  return { publicJwk, jkt: computeJkt(publicJwk) };
}

/** Ed25519 signature (base64url) over `bytes` under the canary-derived seed. */
export function signWith(canary, bytes) {
  return sign(null, Buffer.from(bytes), privateKeyObject(canary)).toString("base64url");
}

/** Verify a base64url Ed25519 signature against an `{kty,crv,x}` public JWK. */
export function verifyWith(publicJwk, bytes, signatureB64u) {
  try {
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicJwk.x }, format: "jwk" });
    return verify(null, Buffer.from(bytes), key, Buffer.from(signatureB64u, "base64url"));
  } catch {
    return false;
  }
}

function tagged(value) {
  return Buffer.concat([Buffer.from(VOUCHER_DOMAIN_TAG, "utf8"), Buffer.from([0]), Buffer.from(jcsFlat(value), "utf8")]);
}
const coreOf = (v) => Object.fromEntries(VOUCHER_CORE_FIELDS.map((f) => [f, v[f]]));

/** `paymentId = keccak256(tag || 0x00 || JCS(core))` — byte-identical to the real signer (parity-tested). */
export function computePaymentId(core) {
  return `0x${keccak256Hex(tagged(coreOf(core)))}`;
}
/** The 11-field voucher preimage the agent's key signs. */
export function voucherSignedBytes(voucher) {
  return tagged({ ...coreOf(voucher), paymentId: voucher.paymentId, agentKeyJkt: voucher.agentKeyJkt });
}
/** Untagged JCS PoP challenge (SOHO-74), as the real signer builds it. */
export function popMessage({ borrowerId, terminalId, jkt, nonce, iat }) {
  return Buffer.from(jcsFlat({ borrowerId, terminalId, jkt, nonce, iat }), "utf8");
}

/** The on-disk secret.json body, laid out exactly as the real signer writes it. */
export function storedKeyFile(canary, borrowerId, terminalId) {
  const { publicJwk, jkt } = publicFromPrivate(canary);
  const stored = { private_key_base64url: canary, public_jwk: publicJwk, jkt, terminal_id: terminalId, borrower_id: borrowerId };
  return `${JSON.stringify(stored, null, 2)}\n`;
}
