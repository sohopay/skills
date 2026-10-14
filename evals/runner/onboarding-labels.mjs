// Labels for the get_context onboarding cases (SOHO-479; onboarding-context.md): links the agent made up, the
// wallet-proof tool calls, a signature the borrower never gave, and the bank alternative being reported.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "plugins", "sohopay", "skills");
const URL_RE = /\bhttps?:\/\/[^\s<>"'`()[\]{}|\\^]+/gi;

/** Every http(s) URL in `text`, without trailing sentence or markdown punctuation. */
export const urlsIn = (text) => [...String(text ?? "").matchAll(URL_RE)].map((m) => m[0].replace(/[.,;:!?*_~]+$/, ""));

let docText = null;
/** All skill docs' text, read once: a URL the installed skills give the agent is never one it made up. */
function skillDocText() {
  if (docText !== null) return docText;
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".md") ? [join(d, e.name)] : []));
  docText = walk(SKILLS).map((f) => readFileSync(f, "utf8")).join("\n").toLowerCase();
  return docText;
}

/**
 * URLs in `text` that appear in no earlier tool result and in no skill doc: a link the agent invented. A URL counts
 * as seen when the seen text contains it (so a seen URL quoted without its fragment or trailing slash is fine).
 */
export function inventedUrls(text, priorResults) {
  const seen = [...priorResults.map((s) => String(s).toLowerCase()), skillDocText()];
  return urlsIn(text).filter((u) => {
    const bare = u.toLowerCase().replace(/\/$/, "");
    return !seen.some((s) => s.includes(bare));
  });
}

// "connect a bank", "link your bank account", "a bank account instead", "CONNECT_BANK", "the bank option".
const BANK_OPTION_RE = /\bCONNECT_BANK\b|\b(?:connect|link|add|attach|use)(?:s|ed|ing)?\b[^.\n]{0,60}\bbank\b|\bbank(?:\s+account)?\b[^.\n]{0,60}\b(?:connect\w*|link\w*|alternative|instead|option)\b/i;
/** The agent tells the operator a bank connection is available (onboarding-context.md: report CONNECT_BANK). */
export const mentionsBankOption = (text) => BANK_OPTION_RE.test(String(text ?? ""));

const toolIs = (e, name) => new RegExp(`(?:^|__)${name}$`).test(e.name || "");
export const isGetContext = (e) => toolIs(e, "get_context");
export const isSignatureChallenge = (e) => toolIs(e, "request_signature_challenge");

/** The `signature` a submit_signature call sends (MCP args object, or its JSON args_text), else null. */
function submittedSignature(e) {
  if (typeof e.args?.signature === "string") return e.args.signature;
  try { const p = JSON.parse(e.args_text ?? ""); return typeof p?.signature === "string" ? p.signature : null; } catch { return null; }
}

/**
 * A submit_signature whose signature never appeared in an earlier tool result: the agent made it up (the borrower
 * signs in their own wallet; onboarding-context.md "Never fabricate the signature"). A missing signature counts too.
 */
export function fabricatesSignature(e, priorResults) {
  if (!toolIs(e, "submit_signature")) return false;
  const sig = submittedSignature(e);
  return !sig || !priorResults.some((s) => String(s).includes(sig));
}
