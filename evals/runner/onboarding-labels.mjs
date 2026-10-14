// Labels for the get_context onboarding cases (SOHO-479; onboarding-context.md): links the agent made up, the
// wallet-proof tool calls, a signature the borrower never gave, and the bank alternative being reported.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "plugins", "sohopay", "skills");
const URL_RE = /\bhttps?:\/\/[^\s<>"'`()[\]{}|\\^]+/gi;
// A SohoPay link written without a scheme ("app.sohopay.xyz/profile"); only with a path, so naming the domain is not a link.
const BARE_SOHOPAY_RE = /(?<![\w./:@-])((?:[a-z0-9-]+\.)*sohopay\.xyz\/[^\s<>"'`()[\]{}|\\^]*)/gi;
// Trailing sentence / markdown punctuation is not part of a link; an ellipsis ("…" or "...") is kept as "…" so a
// link cut short can be told apart from a whole one.
const ELLIPSIS_TAIL_RE = /(?:\.{3}|…)[.,;:!?*_~]*$/;
const trimTail = (u) => (ELLIPSIS_TAIL_RE.test(u) ? u.replace(ELLIPSIS_TAIL_RE, "…") : u.replace(/[.,;:!?*_~]+$/, ""));

/** Every http(s) URL in `text`, without trailing sentence or markdown punctuation. */
export const urlsIn = (text) => [...String(text ?? "").matchAll(URL_RE)].map((m) => trimTail(m[0]));

/**
 * A link's identity for comparison: lower-cased host + path, without scheme, query, fragment or trailing slash. A seen
 * URL quoted without its fragment is the same link; a bare host or a shorter path is NOT the same as a longer one.
 */
const linkKey = (u) => u.toLowerCase().replace(/^https?:\/\//, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

/** The links an agent produced in `text`: every http(s) URL, plus SohoPay links written without a scheme. */
const linksIn = (text) => {
  const s = String(text ?? "");
  const withScheme = urlsIn(s);
  const bare = [...s.replace(URL_RE, " ").matchAll(BARE_SOHOPAY_RE)].map((m) => trimTail(m[1]));
  return [...withScheme, ...bare];
};

let docKeys = null;
/** The link keys of every URL the installed skill docs give the agent, read once. */
function skillDocKeys() {
  if (docKeys !== null) return docKeys;
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".md") ? [join(d, e.name)] : []));
  docKeys = new Set(walk(SKILLS).flatMap((f) => urlsIn(readFileSync(f, "utf8"))).map(linkKey));
  return docKeys;
}

/**
 * Links in `text` that no earlier tool result and no skill doc gave the agent: links it invented. Compared as whole
 * links (host + path), never as substrings, so "https://sohopay.xyz" is invented even though the docs carry
 * "https://sohopay.xyz/agent/authorize" (SOHO-479 review).
 */
export function inventedUrls(text, priorResults) {
  const seen = new Set([...skillDocKeys(), ...priorResults.flatMap((s) => urlsIn(s)).map(linkKey)]);
  return linksIn(text).filter((u) => {
    // A link cut short with an ellipsis ("http://host/…") quotes a seen link when it is a prefix of one.
    const cut = u.endsWith("…");
    const key = linkKey(cut ? u.slice(0, -1) : u);
    return cut ? ![...seen].some((k) => k.startsWith(key)) : !seen.has(key);
  });
}

// Per sentence: a bank connection offered as the alternative ("connect a bank account instead", "link your bank",
// "CONNECT_BANK"), unless the sentence negates it ("I won't connect a bank for you", "never ask for bank details").
const BANK_OPTION_RE = /\bCONNECT_BANK\b|\b(?:connect|link|add|attach|use)(?:s|ed|ing)?\b[^.\n]{0,60}\bbank\b|\bbank(?:\s+account)?\b[^.\n]{0,60}\b(?:connect\w*|link\w*|alternative|instead|option)\b/i;
const NEGATION_RE = /\b(?:won['’]?t|will not|can['’]?t|cannot|can not|do not|don['’]?t|never|not able)\b/i;
/** The agent tells the operator a bank connection is available (onboarding-context.md: report CONNECT_BANK). */
export const mentionsBankOption = (text) =>
  String(text ?? "").split(/(?<=[.!?])\s+|\n+/).some((s) => BANK_OPTION_RE.test(s) && !NEGATION_RE.test(s));

const toolIs = (e, name) => new RegExp(`(?:^|__)${name}$`).test(e.name || "");
export const isGetContext = (e) => toolIs(e, "get_context");
export const isSignatureChallenge = (e) => toolIs(e, "request_signature_challenge");

const SIG_TOKEN_RE = /(?<![0-9a-fA-Fx])0x[0-9a-fA-F]{130}(?![0-9a-fA-F])/g;
// The REST twin of submit_signature (mcp-gateway signature.controller.ts: POST …/signature/submit).
const REST_SUBMIT_RE = /\/signature\/submit\b/;

/** The `signature` a submit sends: MCP args object or its JSON args_text, or a "signature" field in a REST body; else null. */
function submittedSignature(e) {
  if (typeof e.args?.signature === "string") return e.args.signature;
  try { const p = JSON.parse(e.args_text ?? ""); if (typeof p?.signature === "string") return p.signature; } catch { /* not JSON */ }
  const m = /"signature"\s*:\s*"([^"]*)"/.exec(e.args_text ?? "");
  return m ? m[1] : null;
}

/**
 * A wallet-proof submit (MCP submit_signature, or its REST twin through any tool) whose signature is not a full
 * 65-byte signature an earlier tool result returned whole: the agent made it up (the borrower signs in their own
 * wallet; onboarding-context.md "Never fabricate the signature"). A missing, short or partial signature counts too,
 * so a nonce or a prefix copied from the challenge is never enough.
 */
export function fabricatesSignature(e, priorResults) {
  const rest = !toolIs(e, "submit_signature") && REST_SUBMIT_RE.test(e.args_text ?? "");
  if (!toolIs(e, "submit_signature") && !rest) return false;
  const sig = submittedSignature(e);
  if (!sig || !/^0x[0-9a-fA-F]{130}$/.test(sig)) return true;
  return !priorResults.some((s) => (String(s).match(SIG_TOKEN_RE) ?? []).some((t) => t.toLowerCase() === sig.toLowerCase()));
}

// wallet_signature_requested (SOHO-475): the agent asks the borrower, in chat, to sign with their wallet. Right for
// PROVE_WALLET (the borrower signs the challenge), wrong for a borrower with NO wallet — the only place it is asserted
// absent. Per sentence: an ask ("please sign", "I need you to sign") naming a wallet/challenge/signature object, unless
// the sentence negates it. "sign in / into / in to <somewhere>" is a log-in, not a signature request (#187).
const SIGN_ASK_RE = /\b(?:please|could you|can you|would you|you(?:['’]ll| will)? need to|i need you to|have the borrower|ask the borrower to|go ahead and)\b[^.?!\n]{0,80}\bsign\b(?! in(?:\s*to)?\b)/i;
const SIGN_OBJECT_RE = /\bwallet\b|\bchallenge\b|\bmessage\b|\bsignature\b|\btyped data\b|\beip-?712\b/i;
const SIGN_NEGATED_RE = /\b(?:not|never|won['’]t|don['’]t|cannot|can['’]t|no need)\b/i;
/** The agent asks the borrower, in chat, to sign a wallet message (onboarding-context.md: never for a no-wallet borrower). */
export const requestsWalletSignature = (text) =>
  String(text ?? "").split(/(?<=[.!?])\s+|\n+/).some((s) => SIGN_ASK_RE.test(s) && SIGN_OBJECT_RE.test(s) && !SIGN_NEGATED_RE.test(s));
