// Run the signer core (signer-child.mjs) in a child process under the SAME OS sandbox filesystem policy the agent's
// Bash gets, so the kernel — not a JS check-then-open — decides every path the signer touches (T15 fix R2-1):
//   macOS → sandbox-exec with a generated Seatbelt profile: reads allowed except denyRead (re-allowed: allowRead + the
//           signer's own code), writes allowed only under the write roots, minus denyWrite / denyRead; no network.
//   Linux → bwrap: / read-only, write roots bound read-write, denyWrite re-bound read-only, denyRead hidden (tmpfs /
//           /dev/null), allowRead re-bound; all namespaces unshared (no network). Under strace (-f -y) when available,
//           so the child's opens are recorded (the host has no other way to see them).
// No sandbox, or a sandbox that does not start the child, is reported — the caller refuses; never an unsandboxed run.
import { spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLoose } from "./realpath-loose.mjs";

const MOCK_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const CHILD = join(MOCK_DIR, "signer-child.mjs");

/** Which OS sandbox this host can run the signer under. */
export function sandboxSupport(platform = process.platform) {
  if (platform === "darwin") return existsSync("/usr/bin/sandbox-exec") ? { kind: "sandbox-exec", path: "/usr/bin/sandbox-exec" } : { kind: null, reason: "no /usr/bin/sandbox-exec" };
  if (platform === "linux") {
    const bw = (process.env.PATH ?? "/usr/bin:/bin").split(delimiter).map((d) => join(d, "bwrap")).find((p) => existsSync(p));
    return bw ? { kind: "bwrap", path: bw } : { kind: null, reason: "bwrap not installed" };
  }
  return { kind: null, reason: `no OS sandbox for ${platform}` };
}

const canon = (p) => resolveLoose(p);
const sbpl = (p) => JSON.stringify(p); // SBPL string literals take the same escapes as JSON for these paths
const ancestors = (p) => { const out = []; let c = ""; for (const s of p.split("/").filter(Boolean)) { c += `/${s}`; out.push(c); } return out; };

/**
 * Seatbelt profile mirroring the agent's sandbox. Later rules win, so re-allows come after denies.
 * @param {{writeRoots:string[], denyRead:string[], denyWrite:string[], allowRead:string[]}} p  canonical paths
 */
export function seatbeltProfile({ writeRoots, denyRead, denyWrite, allowRead }) {
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
  const a = ["--die-with-parent", "--new-session", "--unshare-all", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc"];
  for (const w of writeRoots.map(canon).filter(isDir)) a.push("--bind", w, w);
  for (const d of denyWrite.map(canon).filter(isDir)) a.push("--ro-bind", d, d);
  for (const d of denyRead.map(canon).filter(ex)) a.push(...(isDir(d) ? ["--tmpfs", d] : ["--ro-bind", "/dev/null", d]));
  for (const r of [...allowRead, MOCK_DIR].map(canon).filter(isDir)) a.push("--ro-bind", r, r);
  a.push("--chdir", cwd);
  return a;
}

/**
 * Run one signer invocation in the sandboxed child.
 * @returns {Promise<{ok:true, reply:object, trace:string|null} | {ok:false, error:string}>}
 */
export function runSandboxed(support, { policy, cwd, request, strace = null, seam = {} }) {
  if (!support.kind) return Promise.resolve({ ok: false, error: support.reason });
  let argv;
  if (support.kind === "sandbox-exec") {
    const profile = seam.brokenProfile ? "(version 1)(this is not a profile" : seatbeltProfile(policy);
    argv = [seam.sandboxCommand ?? support.path, "-p", profile, process.execPath, CHILD];
  } else {
    argv = [seam.sandboxCommand ?? support.path, ...(seam.brokenProfile ? ["--no-such-flag"] : []), ...bwrapArgs({ ...policy, cwd }), process.execPath, CHILD];
    if (strace) argv = [...strace.argv, ...argv];
  }
  return new Promise((done) => {
    const c = spawn(argv[0], argv.slice(1), { cwd, env: { HOME: policy.home, PATH: "/usr/bin:/bin" }, stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    c.stdout.on("data", (d) => out.push(d));
    c.stderr.on("data", (d) => err.push(d));
    c.once("error", (e) => done({ ok: false, error: `sandbox did not start: ${e.message}` }));
    c.once("close", (code) => {
      let reply = null;
      try { reply = JSON.parse(Buffer.concat(out).toString("utf8")); } catch { reply = null; }
      if (!reply || !reply.result) return done({ ok: false, error: `sandboxed signer produced no reply (exit ${code}): ${Buffer.concat(err).toString("utf8").trim().slice(0, 300)}` });
      done({ ok: true, reply, trace: strace && existsSync(strace.file) ? readFileSync(strace.file, "utf8") : null });
    });
    c.stdin.end(JSON.stringify(request));
  });
}
