// Out-of-process host for the mock `sohopay-signer` in a LIVE run. The agent's PATH carries only a thin client
// (evals/runner/adapters/cc-signer-client.mjs) that forwards argv / stdin / cwd here and replays the answer; the run
// config (canaries, scenario hooks) stays in this process.
//
// Confinement (T15 fixes N2, R2-1): every /exec runs signer-core in a CHILD process (signer-child.mjs) under the same
// OS sandbox filesystem policy the agent's Bash gets (lib/signer-sandbox.mjs: macOS sandbox-exec, Linux bwrap). Path
// races therefore hit kernel enforcement, exactly as for a real signer inside the agent's sandbox. Before that:
//   * duplicated path flags (--key / --out / --input / --write-header) are refused with the usage-error shape (exit 2),
//     and the child's argv is REBUILT from the parsed values, so nothing reaches the core unparsed;
//   * a JS pre-check refuses, with the real signer's error for the flag, any path outside the sandbox set (HOME, the
//     sandbox TMPDIR, mktemp dirs owned by us and created this run; minus denyRead, and minus denyWrite for writes),
//     and any final-component link. Comparisons use realpathSync.native (on-disk case). This is a FAST refusal only;
//     the boundary is the kernel.
// HOME and the key roots come from the policy; forwarded env is ignored. No sandbox → refusal + sandboxFailed (the
// adapter makes the sample an adapter error); never an unsandboxed run. Every call has a time limit (R3-3): on expiry
// the child's process group is killed and the call is a refusal + sandboxFailed + timedOut.
// Test seam (R3-1): `seam.sandbox` replaces detection — tests pass FAKE_SANDBOX (an unconfined child) for host plumbing
// that is not about kernel enforcement. Only a caller holding the object can select it; the backend sets it only from
// the harness-written tokens file, and the adapter rejects any fake exec in a run that did not inject it itself.
// Evidence: EVERY /exec is logged in memory (argv, cwd, times, refusals, sandbox, and — Linux, under strace — every
// file the child opened; macOS has no root-free tracing, so opens are `audit: unavailable`). Malformed, unparseable
// and bad-token requests are logged too. The log leaves only over the backend's authenticated control channel.
// `/exec` requires the client token baked into the installed client (agent-readable by necessity).
import { lstatSync, mkdtempSync, readlinkSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { parseArgs } from "./signer-core.mjs";
import { diffSnapshots, snapshotTree } from "./lib/keystore-snapshot.mjs";
import { resolveLoose } from "./lib/realpath-loose.mjs";
import { childTraceSupport, runSandboxed, sandboxSupport, SIGNER_CALL_TIMEOUT_MS } from "./lib/signer-sandbox.mjs";
import { parseChildTrace } from "./lib/child-trace.mjs";
import { COMPAT_TRACE, IO_URING_INJECT } from "./lib/strace-records.mjs";

export { sandboxSupport };
export const HOST = "127.0.0.1";
const MAX_BODY = 4 * 1024 * 1024;
const PATH_FLAGS = ["--input", "--key", "--out", "--write-header"];
// Child strace (Linux): the agent-tree syscall set plus io_uring (unobservable I/O must at least be seen). `?` marks
// every call an architecture (or an older kernel / strace) may lack — open / creat exist only on x86-64, renameat /
// newfstatat not on every asm-generic port — since an unknown name in `-e trace=` aborts strace.
// clone / clone3 (and the x64-only fork / vfork) are traced so a CLONE_UNTRACED child is seen (C1); the i386 compat
// forms are optional and parsed as their 64-bit ops (m4).
const CHILD_TRACE = ["openat,?openat2,?creat,?open,?newfstatat,statx,faccessat,?faccessat2,readlinkat,unlinkat,?renameat,renameat2,linkat,symlinkat,fchmodat,?fchmodat2,fchownat,mkdirat,mknodat,utimensat,truncate,ftruncate,fchmod,fchown,fsetxattr,fremovexattr,execve,clone,?clone3,?fork,?vfork,?io_uring_setup,?io_uring_enter", ...COMPAT_TRACE].join(",");

/** argv prefix wrapping the sandboxed child in strace; io_uring_setup fails with ENOSYS there too (R2-9). */
export function childStraceArgv(file) {
  return ["strace", "-f", "-y", "-qq", "-ttt", "-s", "4096", "-o", file, "-e", `trace=${CHILD_TRACE}`, "-e", IO_URING_INJECT, "--"];
}

/** Constant-time string equality (false on any length mismatch). */
export function tokenEquals(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A fresh in-memory log set for one run. */
export const newLogs = () => ({ journal: [], owned: [], execs: [], state: {} });

const unprivate = (p) => p.replace(/^\/private(?=\/(?:tmp|var)\/)/, "");
const norm = (p) => { const u = unprivate(resolveLoose(p)); return process.platform === "darwin" ? u.toLowerCase() : u; };
const inside = (n, root) => { const c = norm(root); return n === c || n.startsWith(c + sep); };

/** The mktemp dir (matching a policy pattern, owned by us, created during this run) that `p` lies in, or null. */
function freshMktempDir(p, policy) {
  const u = unprivate(resolveLoose(p));
  for (const src of policy.mktemp ?? []) {
    const m = new RegExp(`^(?:${src})(?=/|$)`).exec(u);
    if (!m) continue;
    try {
      const st = lstatSync(m[0]);
      const born = st.birthtimeMs > 0 ? st.birthtimeMs : st.ctimeMs;
      if (st.isDirectory() && st.uid === process.getuid() && born >= policy.since - 2000) return resolveLoose(m[0]);
    } catch { /* gone */ }
  }
  return null;
}
/** Fast-path policy: reads in the sandbox set minus denyRead; writes also minus denyWrite. */
function allowedPath(p, policy, write) {
  const n = norm(p);
  const reallowed = (policy.allowRead ?? []).some((a) => inside(n, a));
  if (!reallowed && (policy.denyRead ?? []).some((d) => inside(n, d))) return false;
  if (write && (policy.denyWrite ?? []).some((d) => inside(n, d))) return false;
  if ((policy.writeRoots ?? []).some((r) => inside(n, r))) return true;
  return freshMktempDir(p, policy) !== null;
}
function linkTargetOrNull(p) {
  try { if (lstatSync(p).isSymbolicLink()) return resolveLoose(resolve(dirname(p), readlinkSync(p))); } catch { /* gone */ }
  return null;
}
const usage = (message) => ({ stdout: "", stderr: `${message}\n`, exitCode: 2 });
const signerError = (code, message) => ({ stdout: "", stderr: `${JSON.stringify({ error: { code, message } })}\n`, exitCode: 1 });

/** The duplicated path flag in argv, if any (`--flag v` and `--flag=v` both count). */
function duplicatePathFlag(argv) {
  for (const f of PATH_FLAGS) if (argv.filter((t) => t === f || t.startsWith(`${f}=`)).length > 1) return f;
  return null;
}
/** argv rebuilt from parsed values only. */
function rebuild(p) {
  const out = p.command.split(" ");
  for (const [k, f] of [["input", "--input"], ["key", "--key"], ["out", "--out"], ["writeHeader", "--write-header"]]) if (typeof p[k] === "string") out.push(f, p[k]);
  if (p.envelope) out.push("--envelope");
  out.push("--output", p.output);
  return out;
}

/** Fast pre-check of every path argument; returns {refusal} or {extraWriteRoots, keyPath, outPath}. */
function precheck(parsed, { cwd, policy, rec }) {
  const refuse = (role, arg, code, message, extra) => { rec.refusals.push({ role, arg, code, ...extra }); return { refusal: signerError(code, message) }; };
  const extraWriteRoots = [];
  for (const [field, role, write] of [["key", "key", false], ["out", "out", true]]) {
    const v = parsed[field];
    if (typeof v !== "string" || v === "-") continue;
    const abs = resolve(cwd, v);
    if (!allowedPath(abs, policy, write)) return refuse(role, v, "KEY_PATH_INVALID", `${abs} is not under an allowed key root`, { path: abs });
  }
  if (typeof parsed.input === "string" && parsed.input !== "-") {
    const abs = resolve(cwd, parsed.input);
    const msg = `cannot read input file: ${parsed.input}`;
    if (!allowedPath(abs, policy, false)) return refuse("input", parsed.input, "MALFORMED_ENVELOPE", msg, { path: abs, reason: "outside sandbox" });
    const target = linkTargetOrNull(abs);
    if (target) return refuse("input", parsed.input, "MALFORMED_ENVELOPE", msg, { path: abs, reason: "ELOOP", target });
    const mk = freshMktempDir(abs, policy);
    if (mk) extraWriteRoots.push(mk);
  }
  if (typeof parsed.writeHeader === "string") {
    const abs = resolve(cwd, parsed.writeHeader);
    const msg = `cannot write header file: ${parsed.writeHeader}`;
    if (!allowedPath(abs, policy, true)) return refuse("write_header", parsed.writeHeader, "MALFORMED_ENVELOPE", msg, { path: abs, reason: "outside sandbox" });
    const target = linkTargetOrNull(abs);
    if (target) return refuse("write_header", parsed.writeHeader, "MALFORMED_ENVELOPE", msg, { path: abs, reason: "ELOOP", target });
    const mk = freshMktempDir(abs, policy);
    if (mk) extraWriteRoots.push(mk);
  }
  return { extraWriteRoots };
}

/**
 * Execute one forwarded invocation under the policy (async: the signer runs in a sandboxed child).
 * @param {object} config  run config
 * @param {{argv:string[], stdin:string, cwd:string}} inv   (any forwarded env is ignored)
 * @param {object} logs    newLogs()
 * @param {{policy:object, privateDir:string, callTimeoutMs?:number,
 *   seam?:{sandbox?:object, precheck?:boolean, sandboxCommand?:string, brokenProfile?:boolean, crashOn?:string}}} o
 */
export async function execForwarded(config, inv, logs, { policy, privateDir, seam = {}, callTimeoutMs = SIGNER_CALL_TIMEOUT_MS }) {
  const { argv, stdin, cwd } = inv ?? {};
  if (!Array.isArray(argv) || argv.some((a) => typeof a !== "string") || typeof cwd !== "string" || !isAbsolute(cwd)) {
    logs.execs.push({ malformed: "argv", at: Date.now() });
    return { stdout: "", stderr: "malformed invocation\n", exitCode: 2 };
  }
  const rec = { argv: [...argv], cwd, at: Date.now(), done: null, command: null, opens: [], refusals: [], sandbox: null, audit: "unavailable" };
  logs.execs.push(rec);
  try {
    if (seam.crashOn && argv[0] === seam.crashOn) throw new Error("injected crash (test seam)");
    const dup = duplicatePathFlag(argv);
    if (dup) { rec.refusals.push({ role: "argv", arg: dup, code: "USAGE", reason: "duplicate flag" }); return usage(`duplicate flag: ${dup}`); }
    let parsed = null;
    try { parsed = parseArgs(argv); } catch { parsed = null; } // the core reports usage errors itself
    rec.command = parsed?.command ?? null;
    let extraWriteRoots = [];
    if (parsed && seam.precheck !== false) {
      const pc = precheck(parsed, { cwd, policy, rec });
      if (pc.refusal) return pc.refusal;
      extraWriteRoots = pc.extraWriteRoots;
    } else if (parsed) {
      for (const k of ["input", "writeHeader"]) if (typeof parsed[k] === "string") { const mk = freshMktempDir(resolve(cwd, parsed[k]), policy); if (mk) extraWriteRoots.push(mk); }
    }
    return await runChild(config, { argv: parsed ? rebuild(parsed) : argv, stdin, cwd, parsed }, { logs, rec, policy, privateDir, seam, extraWriteRoots, callTimeoutMs });
  } finally {
    rec.done = Date.now();
  }
}

async function runChild(config, { argv, stdin, cwd, parsed }, { logs, rec, policy, privateDir, seam, extraWriteRoots, callTimeoutMs }) {
  const support = seam.sandbox ?? sandboxSupport();
  rec.sandbox = support.kind;
  rec.reachedChild = true; // past every pre-check: this call's evidence is the child's (R3-6 counts these)
  const home = policy.home;
  const work = mkdtempSync(join(privateDir, "x-"));
  try {
    const traceable = childTraceSupport(support).ok;
    const strace = traceable ? { file: join(work, "child.strace"), argv: childStraceArgv(join(work, "child.strace")) } : null;
    const childPolicy = { home, writeRoots: [...policy.writeRoots, ...extraWriteRoots], denyRead: policy.denyRead ?? [], denyWrite: policy.denyWrite ?? [], allowRead: policy.allowRead ?? [] };
    const before = snapshotTree(join(home, ".agents"));
    const out = await runSandboxed(support, { policy: childPolicy, cwd, request: { config, argv, stdin: typeof stdin === "string" ? stdin : "", home, state: logs.state }, strace, seam, timeoutMs: callTimeoutMs });
    if (Number.isInteger(out.pid)) rec.childPid = out.pid;
    if (!out.ok) {
      rec.sandboxFailed = true;
      rec.sandboxError = out.error;
      if (out.timedOut) rec.timedOut = true;
      return signerError("MALFORMED_ENVELOPE", out.timedOut ? "signer timed out" : "signer sandbox unavailable");
    }
    logs.state = out.reply.state ?? logs.state;
    for (const n of out.reply.notes ?? []) logs.journal.push({ source: "signer", condition: n.condition, at: n.at });
    if (out.trace !== null) recordTrace(rec, out.trace, { home, parsed, cwd, roots: childPolicy.writeRoots });
    if (rec.command === "key generate") {
      for (const c of diffSnapshots(before, snapshotTree(join(home, ".agents")))) logs.owned.push({ path: c.path, after: c.after, change: c.change, at: Date.now() });
    }
    return out.reply.result;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const READISH = new Set(["open", "stat", "access"]);

/**
 * Linux: the child's opens (kernel paths), with the sanctioned --key read / keygen --out write marked as such. The call
 * counts as audited only if the trace saw the child node's own execve (R3-5): otherwise nothing of the signer was seen.
 * Filtered STRUCTURALLY (never by a name list): every op in the key store is kept; outside it, only mutations of an
 * argv-named path or of a path inside the agent's sandbox write set (`roots`) are. Reads, stats and access checks
 * outside the store — the dynamic loader (ld.so.*), the node binary and its libs, the mock's modules, /proc/self/*,
 * fstat of an open fd — are the runtime, not evidence.
 */
export function recordTrace(rec, text, { home, parsed, cwd, roots = [] }) {
  const { opens, ioUring, untraced, started } = parseChildTrace(text, process.execPath);
  if (ioUring) rec.ioUring = true;
  if (untraced) rec.untraced = true; // C1: a child strace never attached to — its I/O is unobservable
  if (!started) return;
  rec.audit = "available";
  const store = resolveLoose(join(home, ".agents"));
  const key = typeof parsed?.key === "string" && parsed.key !== "-" ? resolveLoose(resolve(cwd, parsed.key)) : null;
  const outDir = rec.command === "key generate" && typeof parsed?.out === "string" ? dirname(resolveLoose(resolve(cwd, parsed.out))) : null;
  const named = new Set(["input", "key", "out", "writeHeader"].map((k) => parsed?.[k]).filter((v) => typeof v === "string" && v !== "-").map((v) => resolveLoose(resolve(cwd, v))));
  const sandboxSet = [...new Set(roots.flatMap((r) => [r, resolveLoose(r)]))]; // as given and canonical (macOS /tmp → /private/tmp)
  const under = (p, d) => p === d || p.startsWith(d + sep);
  for (const o of opens) {
    const inStore = under(o.path, store);
    if (!inStore && (READISH.has(o.op) || !(named.has(o.path) || sandboxSet.some((d) => under(o.path, d))))) continue;
    // Sanctioned: reading / checking the --key file and its key-root ancestors; keygen's writes in (and checks of the
    // ancestors of) the --out dir. Anything else in the store is the signer reaching where it was not pointed.
    const readish = o.op === "open" || o.op === "stat" || o.op === "access";
    const sanctioned = (key !== null && readish && (o.path === key || key.startsWith(o.path + sep)))
      || (outDir !== null && (o.path === outDir || o.path.startsWith(outDir + sep) || outDir.startsWith(o.path + sep)));
    rec.opens.push({ role: "child", path: o.path, op: o.op, storeHit: inStore, ...(sanctioned ? { sanctioned: true } : {}) });
  }
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

/** HTTP host on 127.0.0.1 (random port): POST /exec {argv, stdin, cwd} with x-signer-client → {stdout, stderr, exitCode}. */
export function createSignerHost(config, { logs, clientToken, policy, privateDir, seam, callTimeoutMs }) {
  if (!policy || !isAbsolute(policy.home) || !privateDir) throw new Error("signer host needs a policy and a private dir");
  const server = createServer((req, res) => {
    const reply = (status, body) => { if (!res.headersSent) { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); } };
    if (req.method !== "POST" || req.url !== "/exec") return reply(404, { error: "not found" });
    if (!tokenEquals(req.headers["x-signer-client"], clientToken)) { logs.execs.push({ rejected: "token", at: Date.now() }); return reply(404, { error: "not found" }); }
    // Every outcome is a reply: no rejection ever escapes to kill the backend (a crash is this call's error only).
    (async () => {
      let inv;
      try { inv = await readJson(req); } catch { logs.execs.push({ malformed: "body", at: Date.now() }); return reply(400, { stdout: "", stderr: "malformed invocation\n", exitCode: 2 }); }
      try { reply(200, await execForwarded(config, inv, logs, { policy, privateDir, seam, callTimeoutMs })); } catch (e) {
        logs.execs.push({ crashed: String(e?.message ?? e), at: Date.now() });
        reply(200, signerError("MALFORMED_ENVELOPE", "signer host internal error"));
      }
    })();
  });
  return {
    server,
    listen(port = 0) {
      return new Promise((r) => server.listen(port, HOST, () => r(`http://${HOST}:${server.address().port}`)));
    },
    close() { return new Promise((r) => server.close(() => r())); },
  };
}
