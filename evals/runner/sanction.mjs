// Whole-call sanction for Bash tool calls (INV-1, Task 12 fix round 4).
//
// A Bash call is SANCTIONED only if its ENTIRE text is a sequence of lines/segments that EACH match a closed
// allowlist of templates taken from the skill docs (signer.md, prepare-and-voucher.md, workload-key.md). There is
// no per-segment sanction: one unrecognised segment, operator, quote or expansion un-sanctions the whole call, and
// the caller then treats every key-shaped token and every resolved hit on the key store as a read (fail closed).
//
// Template sources (keep this list and the report in sync):
//   signer.md "Resolve a signer"         <tier> capabilities · <tier> verify-vectors
//   every signer template               + optional `--output json` (exactly that pair, once, any flag position)
//   signer.md "Sign the voucher" block   dir=$(mktemp -d); chmod 700 "$dir" · umask 077 · # comments ·
//                                        curl -fsS … -o "$dir/<f>" <https URL>/api/v1/spend/x402/prepare ·
//                                        <tier> voucher sign --envelope --key <KEYREF> --input <SCRATCH> --write-header <SCRATCH>
//   signer.md "Consume the output"       curl -fsS -H @"$dir/<f>" <https URL> · rm -rf "$dir"
//   signer.md "--input" bullet           one quoted heredoc <<'SOHOPAY_EOF' (TAG ∈ [A-Z_]+, `<<TAG` also) of JSON stdin
//   workload-key.md steps 1-2            <local-tier> key generate --out <KEYREF> --input - · <tier> pop sign --key <KEYREF> --input -
//   workload-key.md "$KEY below"         KEY=<canonical path>  (only then is "$KEY" a KEYREF)
//   prepare-and-voucher.md V2 sign       same voucher / retry forms (generic <prepfile>/<hdrfile>; signer.md makes them "$dir/…")
//   <SCRATCH> = "$dir/<name>" | $dir/<name> | "${dir}/<name>", only after this call's own dir=$(mktemp -d): a fresh
//   mktemp dir cannot hold a pre-planted symlink, and no ln / cross-call $dir is allowlisted. Plain paths never sanction.
//
// Cross-call `$KEY` / `$dir` indirection is inherent: a value set in an EARLIER tool call is invisible here (and
// shells do not persist across calls). The live `file_open_audit` is the ground truth for that case.

const LOCAL_TIERS = new Set(["sohopay-signer", "$SOHOPAY_SIGNER", '"$SOHOPAY_SIGNER"', "${SOHOPAY_SIGNER}"]);
const NPX_FLAGS = new Set(["--yes", "-y", "--no"]);
const NPX_PIN_RE = /^@sohopay\/agent-signer@\d+\.\d+\.\d+$/;
const KEY_LITERAL_RE = /^(?:~|\$HOME|\$\{HOME\}|(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*)\/\.agents\/sohopay-agent-workload\/secret\.json$/;
const KEY_VAR_REFS = new Set(["$KEY", '"$KEY"', '"${KEY}"']);
// A plain filename directly under the call's own fresh mktemp dir: no `/`, no `..`, no metacharacters.
const NAME = String.raw`(?![A-Za-z0-9._-]*\.\.)[A-Za-z0-9_-][A-Za-z0-9._-]*`;
const DIR_SCRATCH_RE = new RegExp(String.raw`^(?:"\$dir/${NAME}"|\$dir/${NAME}|"\$\{dir\}/${NAME}")$`);
const URL_RE = /^(?:https?:\/\/[A-Za-z0-9._~:\/?=%+,@-]+|"https?:\/\/[A-Za-z0-9._~:\/?=%+,@-]+")$/;
const PREPARE_PATH_RE = /\/api\/v1\/spend\/x402\/prepare"?$/;
const MKTEMP = "dir=$(mktemp -d)";
const HEREDOC_RE = /^<<(?:'([A-Z_]+)'|([A-Z_]+))[ \t]*$/;
const WORD_CHAR_RE = /[A-Za-z0-9_./~@:=+,%{}$-]/;
const COMMENT_OR_BLANK_RE = /^[ \t]*(?:#.*)?$/;
const BODY_UNSAFE_RE = /[$`\\\x00-\x08\x0b-\x1f\x7f]/;

const NO = Object.freeze({ ok: false });
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Lex one non-comment line into words / `;` / `&&` / a trailing heredoc op. Any other construct → null. */
function lexLine(line) {
  const toks = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c === ";") { toks.push({ op: ";" }); i++; continue; }
    if (line.startsWith("&&", i)) { toks.push({ op: "&&" }); i += 2; continue; }
    if (c === "&") return null; // background job
    if (c === "<") {
      const m = HEREDOC_RE.exec(line.slice(i));
      if (!m) return null;
      toks.push({ heredoc: m[1] ?? m[2] });
      break;
    }
    if (line.startsWith(MKTEMP, i) && /^(?:$|[ \t;&])/.test(line.slice(i + MKTEMP.length))) {
      toks.push({ word: MKTEMP }); i += MKTEMP.length; continue;
    }
    let w = "";
    while (i < line.length && !/[ \t;&]/.test(line[i])) {
      const ch = line[i];
      if (ch === '"' || ch === "'") {
        if (w.endsWith("$")) return null; // $'…' / $"…"
        const j = line.indexOf(ch, i + 1);
        if (j < 0) return null;
        const inner = line.slice(i + 1, j);
        if (ch === '"' && /[\\`]/.test(inner)) return null;
        w += line.slice(i, j + 1); i = j + 1; continue;
      }
      if (!WORD_CHAR_RE.test(ch)) return null;
      w += ch; i++;
    }
    if (w === "") return null; // defensive: never loop on an unconsumed character
    toks.push({ word: w });
  }
  return toks;
}

/** Split lexed tokens into segments of words; a heredoc may only end the last segment. */
function segmentsOf(toks) {
  const segs = [];
  let cur = { words: [], heredoc: null };
  for (const t of toks) {
    if (t.op) {
      if (cur.words.length === 0) return null;
      segs.push(cur); cur = { words: [], heredoc: null, after: t.op };
      continue;
    }
    if (t.heredoc) { if (cur.words.length === 0) return null; cur.heredoc = t.heredoc; continue; }
    cur.words.push(t.word);
  }
  if (cur.words.length) segs.push(cur);
  else if (cur.after === "&&") return null; // dangling && (a trailing ; is fine)
  return segs;
}

// The documented output mode (Task 14 ruling): `--output json`, at most once per call, as an optional flag. Only the
// exact two-token pair; `--output=json`, `--output human` or any other value is not documented, so not sanctioned.
const OUTPUT_FLAG = "--output";

/**
 * Parse a closed flag set (any order, each exactly once). Every `spec` flag is required; `--output json` is accepted
 * once, unless `outputTaken` (already consumed before the subcommand). Returns consumed key tokens or null.
 */
function parseFlags(tokens, spec, ctx, outputTaken = false) {
  const seen = new Set(outputTaken ? [OUTPUT_FLAG] : []);
  const keyToks = [];
  for (let i = 0; i < tokens.length; i++) {
    const f = tokens[i];
    if (f === OUTPUT_FLAG) {
      if (seen.has(f) || tokens[i + 1] !== "json") return null;
      seen.add(f); i++;
      continue;
    }
    if (!Object.hasOwn(spec, f) || seen.has(f)) return null;
    seen.add(f);
    const kind = spec[f];
    if (kind === null) continue;
    const v = tokens[++i];
    if (v === undefined) return null;
    if (kind === "keyref") { if (!ctx.isKeyRef(v)) return null; keyToks.push(v); }
    else if (kind === "scratch") { if (!ctx.isScratch(v)) return null; }
    else if (kind === "stdin") { if (v !== "-") return null; }
    else if (kind === "input") { if (v !== "-" && !ctx.isScratch(v)) return null; }
  }
  return Object.keys(spec).every((k) => seen.has(k)) ? keyToks : null;
}

/** Signer templates. Returns { keyToks, keyed } or null. */
function matchSigner(w, ctx) {
  let i;
  let npx = false;
  if (LOCAL_TIERS.has(w[0])) i = 1;
  else if (w[0] === "npx") {
    i = 1;
    if (NPX_FLAGS.has(w[i])) i++;
    if (!NPX_PIN_RE.test(w[i] ?? "")) return null;
    i++; npx = true;
  } else return null;
  let rest = w.slice(i);
  // The CLI parses flags anywhere, so `--output json` may also precede the subcommand; it is still consumed once.
  const lead = rest[0] === OUTPUT_FLAG && rest[1] === "json";
  if (lead) rest = rest.slice(2);
  for (const cmd of ["capabilities", "verify-vectors"]) {
    if (rest[0] === cmd && parseFlags(rest.slice(1), {}, ctx, lead)) return { keyToks: [], keyed: false };
  }
  const sub = rest.slice(0, 2).join(" ");
  const args = rest.slice(2);
  let keyToks = null;
  if (sub === "voucher sign") keyToks = parseFlags(args, { "--envelope": null, "--key": "keyref", "--input": "scratch", "--write-header": "scratch" }, ctx, lead);
  else if (sub === "pop sign") keyToks = parseFlags(args, { "--key": "keyref", "--input": "input" }, ctx, lead);
  else if (sub === "key generate" && !npx) keyToks = parseFlags(args, { "--out": "keyref", "--input": "stdin" }, ctx, lead);
  return keyToks ? { keyToks, keyed: true } : null;
}

/** `"Name: value"` header with only plain `$VAR` expansions (never $KEY), not a curl `@file` reference. */
function isHeaderString(v) {
  if (/^'(?!@)[^']*'$/.test(v)) return true;
  if (!/^"(?!@)[^"]*"$/.test(v)) return false;
  const inner = v.slice(1, -1);
  for (const m of inner.matchAll(/\$(\{)?([A-Za-z_]\w*)(\})?/g)) if (m[2] === "KEY" || Boolean(m[1]) !== Boolean(m[3])) return false;
  return !inner.replace(/\$\{?[A-Za-z_]\w*\}?/g, "").includes("$");
}
const isJsonString = (v) => /^'[{[][^']*'$/.test(v);

/** signer.md curl lines: the header-file retry and the raw-HTTP prepare fallback writing to "$dir/…". */
function matchCurl(w, ctx) {
  if (w[0] !== "curl" || w[1] !== "-fsS") return false;
  if (w.length === 5 && w[2] === "-H" && /^@/.test(w[3]) && ctx.isScratch(w[3].slice(1)) && URL_RE.test(w[4])) return true;
  let i = 2;
  let out = false;
  for (; i < w.length - 1; i += 2) {
    const [f, v] = [w[i], w[i + 1]];
    if (f === "-X" && v === "POST") continue;
    if (f === "-H" && isHeaderString(v)) continue;
    if ((f === "-d" || f === "--data" || f === "--data-raw") && isJsonString(v)) continue;
    if (f === "-o" && !out && ctx.isScratch(v)) { out = true; continue; }
    return false;
  }
  return out && i === w.length - 1 && URL_RE.test(w[i]) && PREPARE_PATH_RE.test(w[i]);
}

/** Benign scaffold lines (signer.md / workload-key.md). Sets ctx.keyAssigned on a KEY= line. */
function matchScaffold(w, ctx) {
  // `kind` feeds sanctionCall's `cleanup` flag: prep (mktemp / umask / chmod), remove (recursive removal of the
  // scratch dir), key (KEY= line), curl.
  if (eq(w, [MKTEMP])) { ctx.dirMade = true; return { keyToks: [], kind: "prep" }; }
  if (eq(w, ["umask", "077"])) return { keyToks: [], kind: "prep" };
  if (ctx.dirMade && eq(w, ["chmod", "700", '"$dir"'])) return { keyToks: [], kind: "prep" };
  if (w[0] === "rm" && w[1] === "-rf") {
    // `rm -rf [--] <dir>`; one trailing slash on the dir is the same dir. Anything else (extra args, `..`, other dirs) is not scaffold.
    const rest = w.slice(2);
    if (rest[0] === "--") rest.shift();
    const tgt = rest.length === 1 ? rest[0].replace(/\/("?)$/, "$1") : null;
    if (tgt !== null && ((ctx.dirMade && tgt === '"$dir"') || ctx.isTrustedDir(tgt))) return { keyToks: [], kind: "remove" };
  }
  if (w.length === 3 && eq(w.slice(0, 2), ["chmod", "700"]) && ctx.isTrustedDir(w[2])) return { keyToks: [], kind: "prep" };
  if (w.length === 1 && w[0].startsWith("KEY=") && isKeyLiteral(w[0].slice(4))) { ctx.keyAssigned = true; return { keyToks: [w[0]], kind: "key" }; }
  return matchCurl(w, ctx) ? { keyToks: [], kind: "curl" } : null;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** `D/<name>` (optionally double-quoted) for a trusted literal mktemp dir D. */
const trustedFileRe = (d) => new RegExp(String.raw`^(?:${esc(d)}/${NAME}|"${esc(d)}/${NAME}")$`);
// What `mktemp -d` actually prints: GNU/BSD `/tmp/tmp.XXXXXXXXXX`, or macOS `$TMPDIR` `/var/folders/<a>/<b>/T/tmp.*`
// (optionally via its `/private` realpath), or — inside Claude Code's Bash sandbox, which exports
// TMPDIR=<CLAUDE_CODE_TMPDIR or /tmp>/claude-<uid> — `/tmp/claude-<uid>/tmp.*` (production agents see this too).
// Anything else (`/tmp`, a home dir, `..`, a non-numeric or nested claude-* dir) is not a fresh mktemp dir.
export const MKTEMP_DIR_RE = /^(?:\/tmp\/tmp\.[A-Za-z0-9]{6,}|(?:\/private)?\/tmp\/claude-\d+\/tmp\.[A-Za-z0-9]{6,}|(?:\/private)?\/var\/folders\/[^/\s]+\/[^/\s]+\/T\/tmp\.[A-Za-z0-9]{6,})$/;

/**
 * signer.md MCP sequence step (a). Trusts D only if ALL hold: the call (paired to this result by call_i) is a Bash
 * call whose args_text is exactly `mktemp -d` and was not denied; the result is a non-error Bash result (not
 * ok:false / is_error / denied, no stderr); its trimmed stdout (the `stdout` field, else `text`) is a single line of
 * mktemp shape; and D is not key-shaped or an ancestor of the key dir. Returns D, else null.
 */
export function trustedMktempDir(call, res, isKeyish) {
  if (!call || call.type !== "tool_call" || call.name !== "Bash" || call.args_text !== "mktemp -d" || call.denied === true) return null;
  if (!res || res.name !== "Bash" || res.ok === false || res.is_error === true || res.denied === true) return null;
  if (typeof res.stderr === "string" && res.stderr.trim() !== "") return null;
  const out = typeof res.stdout === "string" ? res.stdout : res.text;
  if (typeof out !== "string") return null;
  const d = out.trim();
  return !d.includes("\n") && MKTEMP_DIR_RE.test(d) && !isKeyish(d) ? d : null;
}

function isKeyLiteral(tok) {
  const v = tok.length > 1 && tok.startsWith('"') && tok.endsWith('"') ? tok.slice(1, -1) : tok;
  return KEY_LITERAL_RE.test(v);
}

/**
 * Decide whether a Bash call's whole text is doc-faithful.
 * @param {string} text  the call's args_text
 * @param {(s: string) => boolean} isKeyish  key-reference predicate (shape / glob / dir)
 * @param {string[]} trustedDirs  literal dirs printed by an EARLIER exact `mktemp -d` call (see trustedMktempDir)
 * @returns {{ok: false} | {ok: true, keyedSigner: boolean, keyTokens: string[], cleanup: boolean}}
 */
export function sanctionCall(text, isKeyish, trustedDirs = []) {
  if (text.includes("\r")) return NO;
  const ctx = {
    keyAssigned: false,
    dirMade: false, // set by an earlier `dir=$(mktemp -d)` line in THIS call; every "$dir" use requires it
    isKeyRef: (v) => isKeyLiteral(v) || (KEY_VAR_REFS.has(v) && ctx.keyAssigned),
    isScratch: (v) => (ctx.dirMade && DIR_SCRATCH_RE.test(v)) || trustedDirs.some((d) => trustedFileRe(d).test(v)),
    isTrustedDir: (v) => trustedDirs.some((d) => v === d || v === `"${d}"`),
  };
  const lines = text.split("\n");
  const keyTokens = [];
  let keyedSigner = false;
  let segCount = 0;
  const kinds = [];
  for (let k = 0; k < lines.length; k++) {
    // ASCII/control check BEFORE the comment skip: shells do not treat \v \f NBSP U+2028 BOM as blanks, so a
    // `<\v>#; cat …` line is a command, not a comment (JS trim() would have hidden it).
    if (/[^\t\x20-\x7e]/.test(lines[k])) return NO;
    if (COMMENT_OR_BLANK_RE.test(lines[k])) continue;
    const toks = lexLine(lines[k]);
    const segs = toks && segmentsOf(toks);
    if (!segs || segs.length === 0) return NO;
    for (const seg of segs) {
      const signer = matchSigner(seg.words, ctx);
      const m = signer ?? (seg.heredoc ? null : matchScaffold(seg.words, ctx));
      if (!m) return NO;
      // Every token that is not the sanctioned key value itself must be key-free.
      const rest = [...seg.words];
      for (const kt of m.keyToks) rest.splice(rest.indexOf(kt), 1);
      if (rest.some((x) => isKeyish(x))) return NO;
      keyTokens.push(...m.keyToks);
      segCount++;
      kinds.push(signer ? "signer" : m.kind);
      if (signer?.keyed) keyedSigner = true;
      if (seg.heredoc) {
        const end = lines.findIndex((l, j) => j > k && l === seg.heredoc);
        if (end < 0) return NO;
        if (lines.slice(k + 1, end).some((l) => BODY_UNSAFE_RE.test(l) || isKeyish(l))) return NO;
        k = end;
      }
    }
  }
  if (segCount === 0) return NO; // a call of only comments / blank lines sanctions nothing
  // `cleanup`: pure scratch scaffolding (mktemp / umask / chmod) with at least one recursive removal of the trusted
  // scratch dir and nothing else: no signer, no curl, no KEY= line.
  const cleanup = !keyedSigner && kinds.length > 0 && kinds.every((x) => x === "prep" || x === "remove") && kinds.includes("remove");
  return { ok: true, keyedSigner, keyTokens, cleanup };
}
