// Per-ARGUMENT path resolution for the live claude-code adapter (resolved_paths contract, schema.mjs).
// argPaths() is lexical (which tokens of a call can name a file, and in what cwd); resolveArgs() touches the
// filesystem (realpath, dangling-symlink targets, glob expansion) and is run at capture time in the hermetic world.
//
// What a lexer can see: plain words, quotes, `NAME=value` / `export NAME=value` in the same call, `$HOME` / `~`,
// redirect targets, `--flag=value`, `cd <dir>` before later segments, heredoc bodies (skipped: data, not argv).
// What it cannot: `$(...)` / backtick output, variables set by an earlier call, functions, aliases, eval, `pushd`,
// paths built inside an interpreter (`python -c`, `node -e`). Those tokens get no pair; the labeler's text
// over-approximation and the key-store audit cover them.
import { globSync, lstatSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { resolveLoose } from "../../mock/lib/realpath-loose.mjs";

const GLOB_RE = /[*?[]/;
const SEP_OPS = new Set([";", "&&", "||", "|", "&", "|&", "\n"]);
const ASSIGN_RE = /^([A-Za-z_][A-Za-z0-9_]*)=/;
const DECL_WORDS = new Set(["export", "local", "declare", "readonly", "typeset"]);

/**
 * Split a Bash command into segments of words. Each word: { raw, start, parts:[{text, quote}] } where quote is
 * "" (bare), "'" or '"'. Operators separate segments; redirections mark the next word `redir: true`.
 */
export function shellSegments(text) {
  const segs = [];
  let words = [];
  let cur = null;
  let pendingRedir = false;
  const heredocs = [];
  const endWord = (i) => {
    if (!cur) return;
    cur.raw = text.slice(cur.start, i);
    if (pendingRedir) { cur.redir = true; pendingRedir = false; }
    words.push(cur);
    cur = null;
  };
  const endSeg = () => { if (words.length) segs.push(words); words = []; };
  const part = (i, quote) => {
    if (!cur) cur = { start: i, parts: [] };
    const last = cur.parts[cur.parts.length - 1];
    if (last && last.quote === quote) return last;
    const p = { text: "", quote };
    cur.parts.push(p);
    return p;
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\n") {
      endWord(i); endSeg();
      i++;
      for (const tag of heredocs.splice(0)) i = skipHeredoc(text, i, tag);
      continue;
    }
    if (c === " " || c === "\t") { endWord(i); i++; continue; }
    if (c === "#" && !cur) { while (i < text.length && text[i] !== "\n") i++; continue; }
    if (c === "\\" && i + 1 < text.length) { part(i, "").text += text[i + 1]; i += 2; continue; }
    if (c === "'") { const e = text.indexOf("'", i + 1); const end = e < 0 ? text.length : e; part(i, "'").text += text.slice(i + 1, end); i = end + 1; continue; }
    if (c === '"') { const end = closeDouble(text, i); part(i, '"').text += text.slice(i + 1, end); i = end + 1; continue; }
    if (c === "$" && (text[i + 1] === "(" || text[i + 1] === "{")) { const end = closeParen(text, i + 1); part(i, "").text += text.slice(i, end + 1); i = end + 1; continue; }
    if (c === "`") { const e = text.indexOf("`", i + 1); const end = e < 0 ? text.length - 1 : e; part(i, "").text += text.slice(i, end + 1); i = end + 1; continue; }
    const op = /^(?:<<-?|&&|\|\||\|&|>>|>\||<>|[;|&<>])/.exec(text.slice(i));
    if (op) {
      const fdWord = cur && /^\d+$/.test(text.slice(cur.start, i)) ? cur : null;
      if (fdWord) cur = null; else endWord(i);
      const o = op[0];
      i += o.length;
      if (o === "<<" || o === "<<-") {
        const m = /^\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(text.slice(i));
        if (m) { heredocs.push(m[2]); i += m[0].length; }
        continue;
      }
      if (SEP_OPS.has(o)) { endSeg(); continue; }
      if (o === ">" || o === ">>" || o === "<" || o === ">|" || o === "<>") {
        if (text[i] === "&") { i++; while (/[0-9-]/.test(text[i] ?? "")) i++; continue; } // fd dup, no path
        pendingRedir = true;
      }
      continue;
    }
    part(i, "").text += c;
    i++;
  }
  endWord(text.length);
  endSeg();
  return segs;
}
function closeDouble(text, i) {
  for (let j = i + 1; j < text.length; j++) { if (text[j] === "\\") { j++; continue; } if (text[j] === '"') return j; }
  return text.length;
}
function closeParen(text, i) {
  const open = text[i]; const close = open === "(" ? ")" : "}";
  let depth = 0;
  for (let j = i; j < text.length; j++) { if (text[j] === open) depth++; else if (text[j] === close && --depth === 0) return j; }
  return text.length - 1;
}
function skipHeredoc(text, i, tag) {
  while (i < text.length) {
    const nl = text.indexOf("\n", i);
    const line = text.slice(i, nl < 0 ? text.length : nl);
    i = nl < 0 ? text.length : nl + 1;
    if (line.replace(/^\t+/, "") === tag) break;
  }
  return i;
}

/** Expand one word's parts with `vars` (in-call assignments + HOME). Returns null when not statically knowable. */
function expandParts(parts, vars, { tilde }) {
  let out = "";
  let globby = false;
  for (const [k, p] of parts.entries()) {
    if (p.quote === "'") { out += p.text; continue; }
    let t = p.text;
    if (/\$\(|`/.test(t)) return null;
    if (k === 0 && p.quote === "" && tilde && /^~(?=\/|$)/.test(t)) t = vars.HOME + t.slice(1);
    let unknown = false;
    t = t.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, a, b) => {
      const v = vars[a ?? b];
      if (v === undefined) unknown = true;
      return v ?? "";
    });
    if (unknown) return null;
    if (p.quote === "" && GLOB_RE.test(t)) globby = true;
    out += t;
  }
  return { value: out, globby };
}

const looksLikePath = (v) => v.startsWith("/") || v.startsWith("./") || v.startsWith("../") || v === "." || v === ".." || (v.includes("/") && !/^[a-z][a-z0-9+.-]*:\/\//i.test(v));

/**
 * Path-bearing arguments of a Bash command: [{arg, value, cwd, glob, bare}] in order of occurrence.
 * `arg` is the exact substring of `command` (validateTranscript requires it verbatim); `value` the expanded path.
 */
export function bashPathArgs(command, { cwd, home }) {
  const out = [];
  const vars = { HOME: home, PWD: cwd };
  let here = cwd;
  for (const words of shellSegments(command)) {
    let k = 0;
    if (words[0] && DECL_WORDS.has(words[0].raw)) k = 1;
    const isAssign = (w) => ASSIGN_RE.test(w.raw) && w.parts[0]?.quote === "";
    let assignedOnly = true;
    for (let j = 0; j < words.length; j++) {
      const w = words[j];
      if (j < k) continue;
      if (assignedOnly && isAssign(w)) {
        const name = ASSIGN_RE.exec(w.raw)[1];
        const valueParts = sliceParts(w, name.length + 1);
        const e = expandParts(valueParts, vars, { tilde: true });
        if (e) vars[name] = e.value;
        if (e && e.value !== "") push(out, w.raw.slice(name.length + 1), e, here, false);
        continue;
      }
      const cmdWord = assignedOnly;
      assignedOnly = false;
      if (cmdWord && w.raw === "cd" && words.length === j + 2) {
        const e = expandParts(words[j + 1].parts, vars, { tilde: true });
        if (e) { push(out, words[j + 1].raw, e, here, false); here = resolve(here, e.value); vars.PWD = here; }
        break;
      }
      let raw = w.raw;
      let parts = w.parts;
      if (!w.redir && raw.startsWith("-")) {
        const eq = raw.indexOf("=");
        if (eq < 0 || /["']/.test(raw.slice(0, eq))) continue;
        parts = sliceParts(w, eq + 1);
        raw = raw.slice(eq + 1);
        if (raw === "") continue;
      }
      // curl / httpie style `@file` (e.g. `-H @<dir>/hdr.txt`, `-d @body.json`): the path follows the `@`.
      if (raw.startsWith("@") && parts[0]?.quote === "" && raw.length > 1) {
        parts = [{ text: parts[0].text.slice(1), quote: "" }, ...parts.slice(1)];
        raw = raw.slice(1);
      }
      const e = expandParts(parts, vars, { tilde: true });
      if (!e || e.value === "") continue;
      if (w.redir || e.globby || looksLikePath(e.value)) push(out, raw, e, here, false);
      else if (!cmdWord) push(out, raw, e, here, true);
    }
  }
  return out;
}
function push(out, raw, e, cwd, bare) { out.push({ arg: raw, value: e.value, cwd, glob: e.globby, bare }); }
/** The parts of a word after its first `skip` raw characters (for `NAME=value` / `--flag=value`). */
function sliceParts(w, skip) {
  let left = skip;
  const parts = [];
  for (const p of w.parts) {
    if (left <= 0) { parts.push(p); continue; }
    if (p.quote !== "") { parts.push(p); left = 0; continue; }
    if (p.text.length > left) parts.push({ text: p.text.slice(left), quote: "" });
    left -= p.text.length;
  }
  return parts;
}

// Input fields that name a file for Claude Code's own tools.
const TOOL_PATH_FIELDS = {
  Read: ["file_path"], Write: ["file_path"], Edit: ["file_path"], MultiEdit: ["file_path"],
  NotebookEdit: ["notebook_path"], NotebookRead: ["notebook_path"], LS: ["path"], Grep: ["path"], Glob: ["path"],
};
/** The JSON-escaped spelling of a string value, which is how it occurs in args_text = JSON.stringify(input). */
const jsonSpelling = (v) => JSON.stringify(v).slice(1, -1);

/** Path-bearing arguments of any tool call (Bash parses its command; other tools read their path fields). */
export function argPaths(name, input, { cwd, home }) {
  if (name === "Bash") return typeof input?.command === "string" ? bashPathArgs(input.command, { cwd, home }) : [];
  const out = [];
  const tilde = (v) => (/^~(?=\/|$)/.test(v) ? home + v.slice(1) : v);
  for (const f of TOOL_PATH_FIELDS[name] ?? []) {
    const v = input?.[f];
    if (typeof v === "string" && v !== "") out.push({ arg: jsonSpelling(v), value: tilde(v), cwd, glob: false, bare: false });
  }
  if (name === "Glob" && typeof input?.pattern === "string" && input.pattern !== "") {
    const base = typeof input.path === "string" && input.path ? resolve(cwd, tilde(input.path)) : cwd;
    out.push({ arg: jsonSpelling(input.pattern), value: isAbsolute(input.pattern) ? input.pattern : join(base, tilde(input.pattern)), cwd, glob: true, bare: false });
  }
  return out;
}

export { resolveLoose };

/** Resolve path-bearing args to [{arg, path}]: one pair per non-glob arg occurrence, one per glob match. */
export function resolveArgs(args) {
  const pairs = [];
  for (const a of args) {
    const abs = resolve(a.cwd, a.value);
    if (a.bare && !existsLstat(abs)) continue;
    if (a.glob) {
      let matches = [];
      try { matches = globSync(abs); } catch { matches = []; }
      if (matches.length === 0) pairs.push({ arg: a.arg, path: resolveLoose(abs) });
      for (const m of matches.sort()) pairs.push({ arg: a.arg, path: resolveLoose(resolve(a.cwd, m)) });
      continue;
    }
    pairs.push({ arg: a.arg, path: resolveLoose(abs) });
  }
  return pairs;
}
function existsLstat(p) { try { lstatSync(p); return true; } catch { return false; } }
