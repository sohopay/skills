// Run the signer core (signer-child.mjs) in a child process under the SAME OS sandbox filesystem policy the agent's
// Bash gets, so the kernel — not a JS check-then-open — decides every path the signer touches (T15 fix R2-1):
//   macOS → sandbox-exec with a generated Seatbelt profile: reads allowed except denyRead (re-allowed: allowRead + the
//           signer's own code), writes allowed only under the write roots, minus denyWrite / denyRead; no network.
//   Linux → bwrap: / read-only, write roots bound read-write, denyWrite re-bound read-only, denyRead hidden (tmpfs /
//           /dev/null), allowRead re-bound; all namespaces unshared (no network). Under strace (-f -y) when available,
//           so the child's opens are recorded (the host has no other way to see them).
// No sandbox, or a sandbox that does not start the child, is reported — the caller refuses; never an unsandboxed run.
//
// R3-1 test seam: FAKE_SANDBOX runs the child UNCONFINED. Detection (`sandboxSupport`) never returns it and no env var
// or CLI flag selects it: a caller must pass the object itself (the signer host's `seam.sandbox`, set only by tests and
// by the adapter's `testSeams`, which runSuites refuses). SP6_SIMULATE_NO_SANDBOX=1 can only force detection to
// "unavailable" — every signer call then fails closed — which is how a host without bwrap (the merge gate) is
// simulated locally.
// R3-3: every call has a time limit; the child leads its own process group and the whole group is killed on expiry.
// R3-4: a path with a control character is never put into a Seatbelt profile (fail closed).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLoose } from "./realpath-loose.mjs";

const MOCK_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const CHILD = join(MOCK_DIR, "signer-child.mjs");
/** Default per-call limit for the sandboxed signer child (a real signer call takes well under a second). */
export const SIGNER_CALL_TIMEOUT_MS = 20_000;
/** TEST-ONLY: the child runs unconfined. Never returned by detection; only ever passed in as this object. */
export const FAKE_SANDBOX = Object.freeze({ kind: "fake", reason: "test-only: unconfined signer child" });

/** The namespace / mount prefix production passes to bwrap (bwrapArgs starts with exactly this). */
const BWRAP_BASE = Object.freeze(["--die-with-parent", "--new-session", "--unshare-all", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc"]);
/** Limit for the functional bwrap probe (a working bwrap starts `true` in well under a second). */
export const BWRAP_PROBE_TIMEOUT_MS = 5_000;
const probeCache = new Map();

/**
 * R4-2: a bwrap binary can exist yet be unable to create namespaces (e.g. Ubuntu 24.04's AppArmor userns restriction).
 * Run it once, with the same namespace flags production uses, on `true`; anything but a clean exit 0 = unavailable.
 * Cached per binary path (only for the real spawner, so tests with stub binaries are never cross-polluted).
 */
export function probeBwrap(path, run = spawnSync) {
  if (run === spawnSync && probeCache.has(path)) return probeCache.get(path);
  const r = run(path, [...BWRAP_BASE, "true"], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", timeout: BWRAP_PROBE_TIMEOUT_MS });
  const why = r.error ? r.error.code ?? r.error.message : r.signal ? `killed by ${r.signal}` : r.status !== 0 ? `exit ${r.status}` : null;
  const stderr = String(r.stderr ?? "").trim().split("\n")[0]?.slice(0, 200);
  const out = why === null ? { ok: true, reason: null } : { ok: false, reason: `bwrap present but its functional probe failed (${why}${stderr ? `: ${stderr}` : ""})` };
  if (run === spawnSync) probeCache.set(path, out);
  return out;
}

/** Which OS sandbox this host can run the signer under (never the fake). */
export function sandboxSupport(platform = process.platform, env = process.env, run = spawnSync) {
  if (env.SP6_SIMULATE_NO_SANDBOX === "1") return { kind: null, reason: "simulated: no OS sandbox (SP6_SIMULATE_NO_SANDBOX=1)" };
  if (platform === "darwin") return existsSync("/usr/bin/sandbox-exec") ? { kind: "sandbox-exec", path: "/usr/bin/sandbox-exec" } : { kind: null, reason: "no /usr/bin/sandbox-exec" };
  if (platform === "linux") {
    const bw = (env.PATH ?? "/usr/bin:/bin").split(delimiter).map((d) => join(d, "bwrap")).find((p) => existsSync(p));
    if (!bw) return { kind: null, reason: "bwrap not installed" };
    const probe = probeBwrap(bw, run);
    return probe.ok ? { kind: "bwrap", path: bw } : { kind: null, reason: probe.reason }; // fail closed
  }
  return { kind: null, reason: `no OS sandbox for ${platform}` };
}

/** Can the signer child's opens be traced here (Linux: bwrap under strace)? The single source for host and adapter. */
export function childTraceSupport(support = sandboxSupport(), run = spawnSync) {
  if (support.kind !== "bwrap") return { ok: false, reason: support.kind ? `no root-free child trace under ${support.kind}` : support.reason };
  if (run("strace", ["-V"], { stdio: "ignore" }).status !== 0) return { ok: false, reason: "strace not installed" };
  return { ok: true, reason: null };
}

const canon = (p) => resolveLoose(p);
const CONTROL = /[\x00-\x1f\x7f]/;
/** Is `p` unsafe to put into a Seatbelt string literal (any C0 control character or DEL)? */
export const unsafeSandboxPath = (p) => CONTROL.test(p);
// SBPL string literals take JSON's quote / backslash escapes, but Seatbelt does not decode `\u00XX`, so a C0 character
// would leave its rule silently ineffective (R3-4). Such a path is refused, never escaped.
const sbpl = (p) => {
  if (unsafeSandboxPath(p)) throw new Error(`sandbox path contains a control character: ${JSON.stringify(p)}`);
  return JSON.stringify(p);
};
const ancestors = (p) => { const out = []; let c = ""; for (const s of p.split("/").filter(Boolean)) { c += `/${s}`; out.push(c); } return out; };

/**
 * Seatbelt profile mirroring the agent's sandbox. Later rules win, so re-allows come after denies. Throws on a path
 * that cannot be represented (control characters).
 * @param {{writeRoots:string[], denyRead:string[], denyWrite:string[], allowRead:string[]}} p  canonical paths
 */
export function seatbeltProfile({ writeRoots, denyRead, denyWrite, allowRead }) {
  for (const p of [...writeRoots, ...denyRead, ...denyWrite, ...allowRead]) sbpl(p); // check the raw spellings too
  const sub = (ps) => ps.map((p) => `(subpath ${sbpl(p)})`).join(" ");
  const reads = [...allowRead, MOCK_DIR].map(canon);
  const lines = ["(version 1)", "(allow default)", "(deny network*)", "(deny file-write*)", `(allow file-write* (literal "/dev/null") ${sub(writeRoots.map(canon))})`];
  if (denyWrite.length) lines.push(`(deny file-write* ${sub(denyWrite.map(canon))})`);
  if (denyRead.length) lines.push(`(deny file-read* ${sub(denyRead.map(canon))})`, `(deny file-write* ${sub(denyRead.map(canon))})`);
  lines.push(`(allow file-read* ${sub(reads)})`);
  // Node's module resolver lstat()s every ancestor of the code it loads: metadata only, never contents or listings.
  lines.push(`(allow file-read-metadata ${[...new Set(reads.flatMap(ancestors))].map((p) => `(literal ${sbpl(p)})`).join(" ")})`);
  return lines.join("\n");
}

/** bwrap arguments mirroring the agent's sandbox (order matters: later mounts shadow earlier ones). */
export function bwrapArgs({ writeRoots, denyRead, denyWrite, allowRead, cwd }) {
  const ex = (p) => { try { lstatSync(p); return true; } catch { return false; } };
  const isDir = (p) => { try { return lstatSync(p).isDirectory(); } catch { return false; } };
  const a = [...BWRAP_BASE];
  for (const w of writeRoots.map(canon).filter(isDir)) a.push("--bind", w, w);
  for (const d of denyWrite.map(canon).filter(isDir)) a.push("--ro-bind", d, d);
  for (const d of denyRead.map(canon).filter(ex)) a.push(...(isDir(d) ? ["--tmpfs", d] : ["--ro-bind", "/dev/null", d]));
  for (const r of [...allowRead, MOCK_DIR].map(canon).filter(isDir)) a.push("--ro-bind", r, r);
  a.push("--chdir", cwd);
  return a;
}

/** argv for one call under `support`, or throws when the policy cannot be expressed. */
function childArgv(support, { policy, cwd, strace, seam }) {
  if (support.kind === "fake") return [process.execPath, CHILD];
  if (support.kind === "sandbox-exec") {
    const profile = seam.brokenProfile ? "(version 1)(this is not a profile" : seatbeltProfile(policy);
    return [seam.sandboxCommand ?? support.path, "-p", profile, process.execPath, CHILD];
  }
  const argv = [seam.sandboxCommand ?? support.path, ...(seam.brokenProfile ? ["--no-such-flag"] : []), ...bwrapArgs({ ...policy, cwd }), process.execPath, CHILD];
  return strace ? [...strace.argv, ...argv] : argv;
}

const killGroup = (pid) => { try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ } };

/**
 * Run one signer invocation in the sandboxed child.
 * @returns {Promise<{ok:true, reply:object, trace:string|null, pid:number} | {ok:false, error:string, pid?:number, timedOut?:boolean}>}
 */
export function runSandboxed(support, { policy, cwd, request, strace = null, seam = {}, timeoutMs = SIGNER_CALL_TIMEOUT_MS }) {
  if (!support.kind) return Promise.resolve({ ok: false, error: support.reason });
  let argv;
  try { argv = childArgv(support, { policy, cwd, strace, seam }); } catch (e) { return Promise.resolve({ ok: false, error: `sandbox policy refused: ${e.message}` }); }
  return new Promise((done) => {
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; done(r); } };
    // detached: the child leads its own process group, so a timeout kills the wrapper and everything under it.
    const c = spawn(argv[0], argv.slice(1), { cwd, env: { HOME: policy.home, PATH: "/usr/bin:/bin" }, stdio: ["pipe", "pipe", "pipe"], detached: true });
    const out = [];
    const err = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(c.pid);
      // A group SIGKILL closes the pipes; should 'close' still not arrive, answer anyway (the call is refused).
      setTimeout(() => finish({ ok: false, timedOut: true, pid: c.pid, error: `timed out after ${timeoutMs} ms (process group killed)` }), 2000).unref();
    }, timeoutMs);
    c.stdout.on("data", (d) => out.push(d));
    c.stderr.on("data", (d) => err.push(d));
    c.stdin.on("error", () => { /* the child may die before reading its request; reported via close */ });
    c.once("error", (e) => { clearTimeout(timer); finish({ ok: false, error: `sandbox did not start: ${e.message}` }); });
    c.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return finish({ ok: false, timedOut: true, pid: c.pid, error: `timed out after ${timeoutMs} ms (process group killed)` });
      let reply = null;
      try { reply = JSON.parse(Buffer.concat(out).toString("utf8")); } catch { reply = null; }
      if (!reply || !reply.result) return finish({ ok: false, pid: c.pid, error: `sandboxed signer produced no reply (exit ${code}): ${Buffer.concat(err).toString("utf8").trim().slice(0, 300)}` });
      finish({ ok: true, pid: c.pid, reply, trace: strace && existsSync(strace.file) ? readFileSync(strace.file, "utf8") : null });
    });
    c.stdin.end(JSON.stringify(request));
  });
}
