// Key-path validation, mirroring @sohopay/agent-signer@0.3.1 src/cli/key-path.ts + signer-config.ts + storage.ts
// (loadKeyFile): same checks, same order, same KEY_PATH_INVALID / INSECURE_KEY_PERMISSIONS / STORED_KEY_CORRUPT
// messages. `home` / `env` are explicit so the mock never depends on the harness process's own HOME.
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { SignerError } from "./errors.mjs";

const DEFAULT_SUBDIR = [".agents", "sohopay-agent-workload"];
const CONFIG_REL = [".config", "sohopay-signer", "config.json"];
const uid = () => (typeof process.getuid === "function" ? process.getuid() : null);

function invalid(message) { throw new SignerError("KEY_PATH_INVALID", message); }
function lstatOrNull(p) {
  try { return lstatSync(p); } catch (err) { if (err.code === "ENOENT") return null; return invalid(`cannot inspect ${p}`); }
}
function realOrNull(p) { try { return realpathSync(p); } catch { return null; } }

function normalizeRootEntry(entry, source) {
  if (!isAbsolute(entry) || entry.split(/[\\/]/).includes("..")) invalid(`${source} entry ${entry} must be an absolute path without ".." segments`);
  const abs = resolve(entry);
  return realOrNull(abs) ?? abs;
}

function assertConfigFileSecure(path) {
  const l = lstatSync(path);
  if (l.isSymbolicLink()) invalid(`${path} is a symlink`);
  const st = statSync(path);
  if (uid() !== null && st.uid !== uid()) invalid(`${path} is not owned by the current user`);
  if ((st.mode & 0o077) !== 0) invalid(`${path} must be 0600`);
  if ((statSync(join(path, "..")).mode & 0o077) !== 0) invalid(`${path} parent dir must be 0700`);
}

/** Allowed key roots: compiled default + config-file keyRoots, narrowed (never widened) by SOHOPAY_SIGNER_KEY_ROOTS. */
export function resolveKeyRoots(home, env) {
  const configured = new Set();
  const def = join(home, ...DEFAULT_SUBDIR);
  configured.add(realOrNull(def) ?? def);
  const cfgPath = join(home, ...CONFIG_REL);
  if (realOrNull(cfgPath) !== null) {
    assertConfigFileSecure(cfgPath);
    let parsed;
    try { parsed = JSON.parse(readFileSync(cfgPath, "utf8")); } catch { invalid(`${cfgPath} is not valid JSON`); }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) invalid(`${cfgPath} must contain a JSON object`);
    if (parsed.keyRoots !== undefined) {
      if (!Array.isArray(parsed.keyRoots) || parsed.keyRoots.some((r) => typeof r !== "string")) invalid(`${cfgPath} keyRoots must be an array of strings`);
      for (const r of parsed.keyRoots) configured.add(normalizeRootEntry(r, cfgPath));
    }
  }
  const envRaw = env.SOHOPAY_SIGNER_KEY_ROOTS;
  if (envRaw === undefined || envRaw.length === 0) return [...configured];
  const narrowed = [];
  for (const er of envRaw.split(":").filter((s) => s.length > 0).map((r) => normalizeRootEntry(r, "SOHOPAY_SIGNER_KEY_ROOTS"))) {
    if (![...configured].some((cr) => er === cr || er.startsWith(cr + sep))) invalid(`SOHOPAY_SIGNER_KEY_ROOTS entry ${er} is not within a configured root`);
    narrowed.push(er);
  }
  return narrowed;
}

function assertNoSymlinkBelow(root, target) {
  if (target !== root && !target.startsWith(root + sep)) invalid(`${target} is not under ${root}`);
  let cur = root;
  for (const seg of target.slice(root.length).split(sep).filter((s) => s.length > 0)) {
    if (seg === "..") invalid("path must not contain ..");
    cur = cur + sep + seg;
    const st = lstatOrNull(cur);
    if (st === null) return;
    if (st.isSymbolicLink()) invalid(`${cur} is a symlink`);
  }
}

function ensureRootExists(root) {
  if (lstatOrNull(root) !== null) return;
  const missing = [];
  let cur = root;
  while (lstatOrNull(cur) === null) {
    missing.unshift(cur);
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  const anchor = lstatOrNull(cur);
  if (anchor === null || anchor.isSymbolicLink() || !anchor.isDirectory()) invalid(`${cur} is not a usable parent directory`);
  for (const dir of missing) {
    try { mkdirSync(dir, { mode: 0o700 }); } catch { invalid(`cannot create ${dir}`); }
  }
}

function assertOwnerMode(path, denyMask) {
  let st;
  try { st = statSync(path); } catch { return invalid(`${path} cannot be inspected (missing or unreadable)`); }
  if (uid() !== null && st.uid !== uid()) invalid(`${path} is not owned by the current user`);
  if ((st.mode & denyMask) !== 0) invalid(`${path} has too-permissive mode`);
}

function locateRoot(abs, roots) {
  for (let anc = abs; ; anc = dirname(anc)) {
    const real = realOrNull(anc);
    if (real !== null && roots.includes(real)) return { root: real, canonical: real + abs.slice(anc.length) };
    if (dirname(anc) === anc) break;
  }
  for (const r of roots) {
    if (realOrNull(r) !== null) continue;
    if (abs === r || abs.startsWith(r + sep)) return { root: r, canonical: abs };
  }
  return null;
}

/** validateKeyPath(path, "read" | "ensure") → absolute canonical target, or KEY_PATH_INVALID. */
export function validateKeyPath(path, mode, { home, env, cwd }) {
  const abs = resolve(cwd, path);
  if (basename(abs) !== "secret.json") invalid("key file must be named secret.json");
  const found = locateRoot(abs, resolveKeyRoots(home, env));
  if (!found) invalid(`${abs} is not under an allowed key root`);
  const { root, canonical: target } = found;
  if (mode === "ensure") ensureRootExists(root);
  assertNoSymlinkBelow(root, target);
  assertOwnerMode(dirname(target), 0o077);
  if (mode === "read") {
    if (lstatOrNull(target) === null) invalid(`${target} does not exist`);
    assertOwnerMode(target, 0o077);
  } else if (lstatOrNull(target) !== null) {
    invalid(`${target} already exists (ensure mode never overwrites)`);
  }
  return target;
}

/**
 * storage.ts loadKeyFile: permissions first (a loosened file is never parsed), then JSON. TOCTOU-safe: open the file
 * once with O_RDONLY|O_NOFOLLOW, then fstat and read from THAT fd — never stat-then-read by path, so a symlink or a
 * file swapped in at the key path after validateKeyPath's checks can neither redirect the read nor pass the mode gate.
 * O_NOFOLLOW makes a symlink at the final component fail to open (ELOOP), which we refuse as insecure.
 */
export function loadKeyFile(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (err) {
    // A symlink at the key path (TOCTOU plant) refuses to open under O_NOFOLLOW — never follow it to another file.
    if (err.code === "ELOOP" || err.code === "EMLINK") throw new SignerError("INSECURE_KEY_PERMISSIONS", `${path} is a symlink; refusing to load`);
    throw err; // validateKeyPath already ensured existence for a read; surface anything else unchanged
  }
  try {
    const mode = fstatSync(fd).mode & 0o777;
    if (mode & 0o077) throw new SignerError("INSECURE_KEY_PERMISSIONS", `${path} is group/world-accessible (mode ${mode.toString(8)}); refusing to load`);
    try { return JSON.parse(readFileSync(fd, "utf8")); } catch { throw new SignerError("STORED_KEY_CORRUPT", `${path} is not valid JSON`); }
  } finally {
    closeSync(fd);
  }
}
