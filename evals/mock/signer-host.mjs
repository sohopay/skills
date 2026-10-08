// Out-of-process host for the mock `sohopay-signer` in a LIVE run. The agent's PATH carries only a thin client
// (evals/runner/adapters/cc-signer-client.mjs) that forwards argv / stdin / cwd here and replays the answer; the run
// config (canaries, scenario hooks) stays in this process. Semantics are exactly signer-core.mjs run().
//
// Confinement (T15 fix N2): the host is confined exactly like a real signer inside the agent's sandbox. Every path
// argument must resolve inside the run's sandbox set (`policy.roots`: workspace HOME + the sandbox TMPDIR, plus fresh
// mktemp dirs matching `policy.mktemp`) or it is refused with the real signer's error for that flag
// (`cannot read input file: X`, `cannot write header file: X`, KEY_PATH_INVALID for --key / --out). HOME and the key
// roots come from the policy; forwarded env (SOHOPAY_SIGNER_KEY_ROOTS, …) is ignored.
//
// Evidence (I8): the host opens --input / --write-header ITSELF with O_NOFOLLOW (a final-component link is refused,
// never followed) and identifies what it opened by the OPENED fd — fstat dev/ino against the key store's inodes, and
// on Linux /proc/self/fd/N — never by a path realpath'd before or after the open. The signer core then reads /
// writes host-private copies. EVERY /exec is logged in memory (argv, cwd, times, opens, refusals) and leaves this
// process only over the backend's authenticated control channel.
//
// `/exec` requires the client token baked into the installed client (agent-readable by necessity: holding it equals
// running the signer, which the agent may do anyway).
import { closeSync, constants, existsSync, fchmodSync, fstatSync, lstatSync, mkdtempSync, openSync, readdirSync, readFileSync, readlinkSync, readSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { makeContext, parseArgs, run as runSigner } from "./signer-core.mjs";
import { diffSnapshots, snapshotTree } from "./lib/keystore-snapshot.mjs";
import { resolveLoose } from "./lib/realpath-loose.mjs";

export const HOST = "127.0.0.1";
const MAX_BODY = 4 * 1024 * 1024;
const MAX_INPUT = 1024 * 1024;

/** Constant-time string equality (false on any length mismatch). */
export function tokenEquals(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function readJson(req) {
  return new Promise((res, rej) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { rej(new Error("body too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { res(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (e) { rej(e); } });
    req.on("error", rej);
  });
}

/** A fresh in-memory log set for one run. */
export const newLogs = () => ({ journal: [], owned: [], execs: [], state: {} });

const unprivate = (p) => p.replace(/^\/private(?=\/(?:tmp|var)\/)/, "");
/** Is the canonical path p inside the policy's sandbox set (and outside what the sandbox denies within it)? */
function allowed(p, policy) {
  const n = unprivate(p);
  const inside = (r) => { const c = unprivate(resolveLoose(r)); return n === c || n.startsWith(c + sep); };
  if ((policy.deny ?? []).some(inside)) return false;
  if (policy.roots.some(inside)) return true;
  return (policy.mktemp ?? []).some((src) => new RegExp(`^(?:${src})(?:/|$)`).test(n));
}

/** dev:ino → path of everything in the key store (the identity an opened fd is compared against). */
function storeInodes(home) {
  const out = new Map();
  const walk = (p) => {
    let st;
    try { st = lstatSync(p, { bigint: true }); } catch { return; }
    out.set(`${st.dev}:${st.ino}`, p);
    if (st.isDirectory()) for (const n of readdirSync(p)) walk(join(p, n));
  };
  walk(join(home, ".agents"));
  return out;
}

/** What an opened fd IS: dev/ino, its key-store path if it is one, and (Linux) the kernel's path for the fd. */
function fdIdentity(fd, inodes, home) {
  const st = fstatSync(fd, { bigint: true });
  let fdPath = null;
  try { fdPath = readlinkSync(`/proc/self/fd/${fd}`); } catch { fdPath = null; }
  const storePath = inodes.get(`${st.dev}:${st.ino}`) ?? null;
  const path = fdPath ?? storePath;
  return { dev: String(st.dev), ino: String(st.ino), path, storeHit: Boolean(storePath) || (fdPath ?? "").startsWith(join(home, ".agents") + sep) };
}

/** Where a refused final-component link points (observed at refusal time; the link itself was never followed). */
function linkTargetOrNull(p) {
  try { if (lstatSync(p).isSymbolicLink()) return resolveLoose(resolve(dirname(p), readlinkSync(p))); } catch { /* gone */ }
  return null;
}

class Refused extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/**
 * Execute one forwarded invocation under the policy.
 * @param {object} config  run config
 * @param {{argv:string[], stdin:string, cwd:string}} inv   (any forwarded env is ignored)
 * @param {object} logs    newLogs()
 * @param {{policy:{home:string, roots:string[], mktemp?:string[]}, privateDir:string, seam?:{beforeOpen?:Function, afterOpen?:Function}}} o
 */
export function execForwarded(config, inv, logs, { policy, privateDir, seam = {} }) {
  const { argv, stdin, cwd } = inv;
  if (!Array.isArray(argv) || argv.some((a) => typeof a !== "string") || typeof cwd !== "string") {
    return { stdout: "", stderr: "malformed invocation\n", exitCode: 2 };
  }
  const rec = { argv: [...argv], cwd, at: Date.now(), done: null, command: null, opens: [], refusals: [] };
  logs.execs.push(rec);
  const home = policy.home;
  const refuse = (role, arg, code, message, extra = {}) => { rec.refusals.push({ role, arg, code, ...extra }); throw new Refused(code, message); };
  const work = mkdtempSync(join(privateDir, "x-"));
  try {
    let parsed = null;
    try { parsed = parseArgs(argv); } catch { parsed = null; } // usage errors are the signer's to report
    rec.command = parsed?.command ?? null;
    const newArgv = [...argv];
    const swap = (flag, from, to) => {
      for (let k = 0; k < newArgv.length; k++) {
        if (newArgv[k] === flag && newArgv[k + 1] === from) { newArgv[k + 1] = to; return; }
        if (newArgv[k] === `${flag}=${from}`) { newArgv[k] = `${flag}=${to}`; return; }
      }
    };
    const header = parsed ? checkPaths(parsed, { cwd, home, policy, refuse, rec }) : null;
    if (parsed && typeof parsed.input === "string" && parsed.input !== "-") swap("--input", parsed.input, readInputCopy(parsed.input, { cwd, home, policy, refuse, rec, seam, work }));
    if (header) { header.copy = join(work, "hdr.txt"); swap("--write-header", header.arg, header.copy); }
    const before = snapshotTree(join(home, ".agents"));
    const ctx = makeContext({ ...config, journal: null, state_file: null }, { env: { HOME: home }, cwd, argv: newArgv });
    ctx.note = (condition) => logs.journal.push({ source: "signer", condition, at: Date.now() });
    ctx.readState = () => logs.state;
    ctx.writeState = (s) => { logs.state = s; };
    const result = runSigner(newArgv, typeof stdin === "string" ? stdin : "", ctx);
    if (header && existsSync(header.copy) && result.exitCode === 0) placeHeader(header, { home, rec, seam });
    if (header) result.stdout = result.stdout.split(header.copy).join(header.arg);
    // Only `key generate` legitimately changes the key store; its post-states are signer-owned.
    if (rec.command === "key generate") {
      for (const c of diffSnapshots(before, snapshotTree(join(home, ".agents")))) logs.owned.push({ path: c.path, after: c.after, change: c.change, at: Date.now() });
    }
    return result;
  } catch (e) {
    if (e instanceof Refused) return { stdout: "", stderr: `${JSON.stringify({ error: { code: e.code, message: e.message } })}\n`, exitCode: 1 };
    throw e;
  } finally {
    rec.done = Date.now();
    rmSync(work, { recursive: true, force: true });
  }
}

/** Policy checks for --key / --out (sanctioned; the signer core opens them) and --write-header (before signing). */
function checkPaths(parsed, { cwd, policy, refuse, rec }) {
  for (const [field, role] of [["key", "key"], ["out", "out"]]) {
    const v = parsed[field];
    if (typeof v !== "string" || v === "-") continue;
    const abs = resolve(cwd, v);
    if (!allowed(resolveLoose(abs), policy)) refuse(role, v, "KEY_PATH_INVALID", `${abs} is not under an allowed key root`, { path: abs });
    rec.opens.push({ role, arg: v, path: abs, op: role === "key" ? "read" : "write", sanctioned: true });
  }
  if (typeof parsed.writeHeader !== "string") return null;
  const arg = parsed.writeHeader;
  const abs = resolve(cwd, arg);
  const msg = `cannot write header file: ${arg}`;
  if (!allowed(join(resolveLoose(dirname(abs)), abs.slice(dirname(abs).length + 1)), policy)) refuse("write_header", arg, "MALFORMED_ENVELOPE", msg, { path: abs, reason: "outside sandbox" });
  const target = linkTargetOrNull(abs);
  if (target) refuse("write_header", arg, "MALFORMED_ENVELOPE", msg, { path: abs, reason: "ELOOP", target });
  return { arg, abs };
}

/** Open --input ourselves (O_NOFOLLOW), identify the fd, copy it host-privately; returns the copy's path. */
function readInputCopy(arg, { cwd, home, policy, refuse, rec, seam, work }) {
  const msg = `cannot read input file: ${arg}`;
  const abs = resolve(cwd, arg);
  if (!allowed(resolveLoose(abs), policy)) refuse("input", arg, "MALFORMED_ENVELOPE", msg, { path: abs, reason: "outside sandbox" });
  const inodes = storeInodes(home);
  seam.beforeOpen?.("input", abs);
  let fd;
  try { fd = openSync(abs, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (e) {
    refuse("input", arg, "MALFORMED_ENVELOPE", msg, { path: abs, reason: e.code, target: linkTargetOrNull(abs) });
  }
  try {
    seam.afterOpen?.("input", abs);
    const id = fdIdentity(fd, inodes, home);
    rec.opens.push({ role: "input", arg, op: "open", path: id.path ?? abs, lexical: !id.path, storeHit: id.storeHit, dev: id.dev, ino: id.ino });
    const buf = Buffer.alloc(MAX_INPUT);
    const n = readSync(fd, buf, 0, MAX_INPUT, 0);
    const copy = join(work, "input.json");
    writeFileSync(copy, buf.subarray(0, n), { mode: 0o600 });
    return copy;
  } finally { closeSync(fd); }
}

/** Write the header to its real target: O_NOFOLLOW, 0600, identified by the opened fd. */
function placeHeader(header, { home, rec, seam }) {
  const content = readFileSync(header.copy);
  const inodes = storeInodes(home);
  seam.beforeOpen?.("write_header", header.abs);
  let fd;
  try { fd = openSync(header.abs, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600); } catch (e) {
    rec.refusals.push({ role: "write_header", arg: header.arg, code: "MALFORMED_ENVELOPE", path: header.abs, reason: e.code, target: linkTargetOrNull(header.abs) });
    throw new Refused("MALFORMED_ENVELOPE", `cannot write header file: ${header.arg}`);
  }
  try {
    seam.afterOpen?.("write_header", header.abs);
    const id = fdIdentity(fd, inodes, home);
    rec.opens.push({ role: "write_header", arg: header.arg, op: "write", path: id.path ?? header.abs, lexical: !id.path, storeHit: id.storeHit, dev: id.dev, ino: id.ino });
    writeSync(fd, content);
    fchmodSync(fd, 0o600);
  } finally { closeSync(fd); }
}

/** HTTP host on 127.0.0.1 (random port): POST /exec {argv, stdin, cwd} with x-signer-client → {stdout, stderr, exitCode}. */
export function createSignerHost(config, { logs, clientToken, policy, privateDir, seam }) {
  if (!policy || !isAbsolute(policy.home) || !privateDir) throw new Error("signer host needs a policy and a private dir");
  const server = createServer((req, res) => {
    const reply = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.method !== "POST" || req.url !== "/exec" || !tokenEquals(req.headers["x-signer-client"], clientToken)) return reply(404, { error: "not found" });
    readJson(req).then(
      (inv) => reply(200, execForwarded(config, inv, logs, { policy, privateDir, seam })),
      () => reply(400, { stdout: "", stderr: "malformed invocation\n", exitCode: 2 }),
    );
  });
  return {
    server,
    listen(port = 0) {
      return new Promise((r) => server.listen(port, HOST, () => r(`http://${HOST}:${server.address().port}`)));
    },
    close() { return new Promise((r) => server.close(() => r())); },
  };
}
