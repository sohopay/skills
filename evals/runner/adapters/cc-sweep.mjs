// N6: post-run sweep for processes the agent left behind OUTSIDE the CLI's process group (setsid, `set -m` job
// control, a double fork into its own session). After the group kill, any process whose cwd is inside the workspace
// or whose environment carries HOME=<workspace HOME> is sent SIGTERM, then SIGKILL after a grace period.
//   linux  → /proc/<pid>/cwd and /proc/<pid>/environ
//   darwin → `lsof -d cwd -F pn` (cwd of every process) and `ps -E -ww` (environment of the user's own processes)
// Residual (documented): a process started with a scrubbed environment (`env -i`) AND a cwd outside the workspace
// (`cd /`) carries neither mark and survives the sweep.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { sep } from "node:path";

const inside = (p, d) => p === d || p.startsWith(d.endsWith(sep) ? d : d + sep);

/** pids marked by the workspace (cwd under `prefix`, or HOME=`home` in the environment); never this process. */
export function workspaceProcesses({ prefix, home }, platform = process.platform) {
  const out = new Set();
  const realPrefixes = [prefix, prefix.replace(/^\/private(?=\/var\/)/, ""), `/private${prefix}`];
  const cwdMatch = (c) => realPrefixes.some((p) => inside(c, p));
  if (platform === "linux") {
    let names = [];
    try { names = readdirSync("/proc"); } catch { names = []; }
    for (const n of names.filter((x) => /^\d+$/.test(x))) {
      let hit = false;
      try { hit = cwdMatch(readlinkSync(`/proc/${n}/cwd`)); } catch { /* gone or not ours */ }
      if (!hit) { try { hit = readFileSync(`/proc/${n}/environ`, "utf8").split("\0").includes(`HOME=${home}`); } catch { /* not ours */ } }
      if (hit) out.add(Number(n));
    }
  } else if (platform === "darwin") {
    const l = spawnSync("lsof", ["-d", "cwd", "-F", "pn"], { encoding: "utf8", timeout: 20_000 });
    let pid = null;
    for (const line of String(l.stdout ?? "").split("\n")) {
      if (line.startsWith("p")) pid = Number(line.slice(1));
      else if (line.startsWith("n") && pid && cwdMatch(line.slice(1))) out.add(pid);
    }
    const p = spawnSync("ps", ["-E", "-ww", "-o", "pid=,command="], { encoding: "utf8", timeout: 20_000 });
    const mark = `HOME=${home}`;
    for (const line of String(p.stdout ?? "").split("\n")) {
      const m = /^\s*(\d+)\s(.*)$/.exec(line);
      if (m && (m[2].includes(`${mark} `) || m[2].endsWith(mark))) out.add(Number(m[1]));
    }
  }
  out.delete(process.pid);
  return [...out];
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Kill every workspace-marked process: SIGTERM, then SIGKILL after `graceMs`. Returns the pids it signalled. */
export async function sweepWorkspace(ws, { graceMs = 500, platform = process.platform } = {}) {
  const pids = workspaceProcesses(ws, platform);
  for (const pid of pids) { try { process.kill(pid, "SIGTERM"); } catch { /* gone */ } }
  if (pids.length) await new Promise((r) => setTimeout(r, graceMs));
  for (const pid of pids.filter(alive)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  return pids;
}
