// The committed-secrets scan (Task 14 review I1 / N1 / N2): nothing committed under evals/ may look like real key
// material. Shared by committed-secrets.test.mjs (every committed file) and live-ci.mjs (every golden candidate).
//
// Key-shaped tokens: base64 / base64url runs of 43–44 chars (a 32-byte Ed25519 seed, padded or not) or 86–88 chars
// (64-byte material: an expanded private key or a signature), and 64-char hex runs (a 32-byte secret in hex). PEM
// headers are never allowed. A key-shaped token passes only if it carries the FAKE-SP6-CANARY- prefix, or sits in a
// field that is PUBLIC by construction (PUBLIC_FIELDS, each with its reason) AND no enclosing key is secret-ish
// (`secret`, `private`, `d`, `key_material`, …), AND, for a JWK `x`, the JWK carries no `d`.
// JSON files are walked structurally (strings holding embedded JSON are parsed and walked too), so the ancestor rule is
// exact. Model prose (a model_text event's text) passes a token only when the same value sits in an accepted public
// field elsewhere in the same file (final review I1). Other text (signer human output inside a JSON string, .mjs/.md files) is matched on the field name written
// right before the token, and the token's line must not mention a secret-ish name.
const B64_RUN_RE = /(?<![A-Za-z0-9_+/=-])[A-Za-z0-9_+/-]+={0,2}(?![A-Za-z0-9_+/=-])/g;
const HEX64_RE = /(?<![0-9A-Fa-f])[0-9A-Fa-f]{64}(?![0-9A-Fa-f])/g;
const KEY_LENGTHS = new Set([43, 44, 86, 87, 88]);
const PEM_RE = /-----BEGIN [A-Z0-9 ]*-----/;
// Anthropic API keys (`sk-ant-api03-…`, `sk-ant-admin01-…`): flagged in any context, whatever field holds them.
export const ANT_KEY_RE = /sk-ant-[A-Za-z0-9_-]{20,}/;
const CANARY = "FAKE-SP6-CANARY-";
const SECRETISH_RE = /secret|private|^d$|key_material/i;

// Final review I1: derived from what the honest flows emit (mock-honest-flows.mjs through the live adapter: MCP args,
// signer --output json stdout, prepare / merchant responses) and the backend / x402 shapes the skill docs name. MCP args
// and signer stdout are snake_case, vouchers and x402 envelopes camelCase, so each identifier is listed in both.
const PUBLIC_FIELDS = {
  x: "Ed25519 public JWK coordinate (only inside a JWK that carries no d)",
  jkt: "RFC 7638 thumbprint of a public JWK",
  agent_key_jkt: "RFC 7638 thumbprint the signer echoes from the voucher",
  agentKeyJkt: "RFC 7638 thumbprint inside a voucher (public, sent to the merchant)",
  nonce: "PoP nonce the signer mints and the agent sends to the backend in the clear",
  pop_signature: "Ed25519 PoP signature, sent to the backend in the clear (register_agent_workload_key arg)",
  popSignature: "Ed25519 PoP signature (camelCase form)",
  signature: "Ed25519 voucher signature, carried in the public payment envelope",
  payment_id: "keccak256 payment id (0x-hex), public on-chain identifier (prepare response, signer stdout)",
  paymentId: "keccak256 payment id inside a voucher (0x-hex), public",
  merchant_id: "bytes32 merchant registry id (0x-hex), public on-chain",
  merchantId: "bytes32 merchant registry id inside a voucher (0x-hex), public on-chain",
  order_ref: "bytes32 merchant order reference (0x-hex), prepare_x402_payment arg copied from the 402 challenge",
  orderRef: "bytes32 merchant order reference inside a voucher / 402 challenge (0x-hex), public",
  settlement_id: "settlement / payment id polled with get_settlement_status (public)",
  settlementId: "settlement id (camelCase form)",
  job_id: "settlement confirmation job id (public poll key)",
  jobId: "settlement confirmation job id (camelCase form)",
  tx_hash: "on-chain transaction hash (public)",
  txHash: "on-chain transaction hash (camelCase form)",
  expect_hash: "sha256 of a case's expect text (assertions.json)",
  skill_hash: "sha256 of a suite's skill closure (golden meta)",
};

/** Key-shaped tokens in a string, each with its offset. */
function keyShaped(s) {
  const out = [];
  for (const m of s.matchAll(B64_RUN_RE)) {
    const t = m[0];
    // Random key material mixes cases and digits; this keeps word-ish runs (paths, identifiers) out.
    if (KEY_LENGTHS.has(t.length) && /[A-Z]/.test(t) && /[a-z]/.test(t) && /[0-9]/.test(t)) out.push({ t, at: m.index, kind: `${t.length}-char base64` });
  }
  for (const m of s.matchAll(HEX64_RE)) out.push({ t: m[0], at: m.index, kind: "64-char hex" });
  return out;
}
const fieldBefore = (text, at) => {
  const head = text.slice(Math.max(0, at - 48), at);
  const m = /(?:\\?"([A-Za-z_]+)\\?"\s*:\s*\\?"(?:0x)?|(?:^|\\n|\n)([A-Za-z_]+): (?:0x)?)$/.exec(head);
  return m ? m[1] ?? m[2] : null;
};
const lineOf = (text, at) => text.slice(text.lastIndexOf("\n", at) + 1, (text.indexOf("\n", at) + 1 || text.length + 1) - 1);
const tryJson = (s) => { const t = s.trim(); if (!/^[[{]/.test(t)) return undefined; try { return JSON.parse(t); } catch { return undefined; } };

const norm = (t) => { const v = t.replace(/^0x/i, ""); return /^[0-9A-Fa-f]{64}$/.test(v) ? v.toLowerCase() : v; };
const isProse = (parent, key) => key === "text" && parent?.type === "model_text";

/**
 * Flat text (non-JSON): field-name allowlist, and no secret-ish name on the token's line. `ctx.collect` = the first
 * pass, which only records accepted public values (ctx.pub); the second pass reports.
 */
function scanFlat(text, ancestors, ctx) {
  for (const { t, at, kind } of keyShaped(text)) {
    if (t.startsWith(CANARY)) continue;
    const f = fieldBefore(text, at);
    const ok = f && Object.hasOwn(PUBLIC_FIELDS, f) && f !== "x" && !ancestors.some((a) => SECRETISH_RE.test(a)) &&
      !SECRETISH_RE.test(lineOf(text, at).replace(/\b(?:secret\.json|sohopay-agent-workload)\b/g, ""));
    if (ctx.collect) { if (ok) ctx.pub.add(norm(t)); continue; }
    if (!ok) ctx.bad.push(`${t.slice(0, 6)}… (${kind}${f ? ` after ${f}` : ""}${ancestors.length ? ` under ${ancestors.join(".")}` : ""})`);
  }
}

/**
 * Model prose: an id-shaped token passes only when the SAME value sits in an accepted public field elsewhere in the
 * transcript (a model summarising its payment id or jkt). The prose itself never admits a value, and a public-looking
 * label written in prose (`payment_id: …`) does not excuse an unexplained token.
 */
function scanProse(text, ancestors, ctx) {
  if (ctx.collect) return;
  for (const { t, kind } of keyShaped(text)) {
    if (t.startsWith(CANARY) || ctx.pub.has(norm(t))) continue;
    ctx.bad.push(`${t.slice(0, 6)}… (${kind} in model prose at ${ancestors.join(".")}, not a value from any public field)`);
  }
}

/** Structural walk: `ancestors` are the enclosing keys, `parent` the object holding the current value. */
function walk(v, ancestors, parent, ctx) {
  if (Array.isArray(v)) { v.forEach((x) => walk(x, ancestors, null, ctx)); return; }
  if (v && typeof v === "object") { for (const [k, x] of Object.entries(v)) walk(x, [...ancestors, k], v, ctx); return; }
  if (typeof v !== "string") return;
  const key = ancestors[ancestors.length - 1];
  if (isProse(parent, key)) { scanProse(v, ancestors, ctx); return; }
  const embedded = tryJson(v);
  if (embedded !== undefined) { walk(embedded, ancestors, null, ctx); return; }
  // Signer human output: `field: <json>` lines carry structured values (e.g. `public_jwk: {"kty":…,"x":…}`).
  if (v.includes("\n") || /^[A-Za-z_]+: [[{]/.test(v)) {
    const flat = [];
    for (const line of v.split("\n")) {
      const m = /^([A-Za-z_]+): ([[{].*)$/.exec(line);
      const inner = m && tryJson(m[2]);
      if (inner !== undefined && inner !== null) walk(inner, [...ancestors, m[1]], null, ctx);
      else flat.push(line);
    }
    scanFlat(flat.join("\n"), ancestors, ctx);
    return;
  }
  const whole = keyShaped(v);
  if (whole.length === 1 && whole[0].t.length === v.replace(/^0x/, "").length) {
    if (v.startsWith(CANARY)) return;
    const above = ancestors.slice(0, -1);
    const publicField = Object.hasOwn(PUBLIC_FIELDS, key) && !above.some((a) => SECRETISH_RE.test(a));
    const jwkOk = key !== "x" || (parent && parent.kty !== undefined && !("d" in parent));
    if (ctx.collect) { if (publicField && jwkOk) ctx.pub.add(norm(whole[0].t)); return; }
    if (!(publicField && jwkOk)) ctx.bad.push(`${v.slice(0, 6)}… (${whole[0].kind} at ${ancestors.join(".")})`);
    return;
  }
  scanFlat(v, ancestors, ctx);
}

/**
 * A committed file's findings. One path is allowlisted, with its reason: evals/live-workflow.sha256 is the T17 hash pin
 * of the live workflow (a PUBLIC digest of a committed file), accepted only in exact `sha256sum` format.
 */
const PIN_PATH = "evals/live-workflow.sha256";
const PIN_RE = /^[0-9a-f]{64} {2}\.github\/workflows\/evals-live\.yml\n?$/;
export function scanCommitted(rel, text) {
  if (rel === PIN_PATH && PIN_RE.test(text)) return [];
  return scanText(text, { json: rel.endsWith(".json") });
}

/** Offending tokens in one file's text (empty = clean). JSON is walked structurally. */
export function scanText(text, { json = false } = {}) {
  const bad = [];
  if (PEM_RE.test(text)) bad.push("PEM block");
  for (const _ of text.matchAll(new RegExp(ANT_KEY_RE.source, "g"))) bad.push("Anthropic API key (sk-ant-…)");
  const doc = json ? tryJson(text) : undefined;
  if (doc !== undefined) {
    // Two passes: collect every accepted public value first (prose may precede the field that explains it), then report.
    const pub = new Set();
    walk(doc, [], null, { collect: true, pub, bad: [] });
    walk(doc, [], null, { collect: false, pub, bad });
  } else scanFlat(text, [], { collect: false, pub: new Set(), bad });
  return bad;
}
