// Final review m8: world lifecycle beyond run()'s `finally`. An interrupted run (Ctrl-C, `node --test` cancelling a
// file, a CI SIGTERM, an uncaught exception) never reaches that `finally`, so it leaked the agent's world
// ($TMPDIR/agent-home-*, with its canary key file), the run root and the hook-relay registry
// (<run base>/relays/<session>.json), and could leave the mock backend and the CLI's process group running.
//
// Every live world is registered here with an owner record (<run base>/owners/<world>.json, 0600, agent-denied:
// {pid, createdAt, paths}). On SIGINT / SIGTERM / SIGHUP the registered worlds are torn down synchronously (process
// groups and pids SIGKILLed, paths removed) and the signal is re-raised with the default action; on `exit` (which also
// fires after an uncaught exception) the same teardown runs. At adapter start, sweepStale() removes what an earlier,
// harder kill (SIGKILL, power loss) left behind: worlds whose owner pid is dead and whose record is older than
// STALE_MS, and relay files no live owner references that are older than STALE_MS. It only ever deletes paths of the
// exact shapes this adapter creates.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";

/** Far above a sample's own limit (PINS.RUN_TIMEOUT_MS, 20 min): nothing this old can belong to a running sample. */
export const STALE_MS = 6 * 60 * 60 * 1000;
const OWNERS = "owners";
const RELAYS = "relays";
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

const live = new Map();
let installed = false;

/** Is `pid` a live process (EPERM = alive, owned by someone else)? */
export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

const writeRecord = (e) => writeFileSync(e.recordFile, JSON.stringify({ pid: process.pid, createdAt: e.createdAt, paths: [...e.paths] }), { mode: 0o600 });

/** Tear every registered world down, synchronously (signal / exit context: no awaiting). */
function teardownAll() {
  for (const e of live.values()) {
    for (const g of e.groups) { try { process.kill(-g, "SIGKILL"); } catch { /* group gone */ } }
    for (const p of e.pids) { try { process.kill(p, "SIGKILL"); } catch { /* gone */ } }
    for (const p of e.paths) { try { rmSync(p, { recursive: true, force: true }); } catch (err) { process.stderr.write(`sp6: could not remove ${p}: ${err.message}\n`); } }
    try { rmSync(e.recordFile, { force: true }); } catch { /* best effort on the way out */ }
  }
  live.clear();
}

const handlers = Object.fromEntries(SIGNALS.map((sig) => [sig, () => {
  teardownAll();
  uninstall();
  process.kill(process.pid, sig); // default action now: the process still dies of the signal it was sent
}]));

function install() {
  if (installed) return;
  installed = true;
  for (const sig of SIGNALS) process.on(sig, handlers[sig]);
  process.on("exit", teardownAll);
}
function uninstall() {
  if (!installed) return;
  installed = false;
  for (const sig of SIGNALS) process.off(sig, handlers[sig]);
  process.off("exit", teardownAll);
}

/**
 * Register a world (its prefix and run root) for emergency teardown and write its owner record under `base`.
 * Returns {trackPath, trackPid, trackGroup, release}; `release()` after the normal cleanup removed the paths.
 */
export function registerWorld({ base, prefix, runRoot }) {
  const dir = join(base, OWNERS);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const id = basename(prefix);
  const e = { recordFile: join(dir, `${id}.json`), createdAt: Date.now(), paths: new Set([prefix, runRoot]), pids: new Set(), groups: new Set() };
  live.set(id, e);
  writeRecord(e);
  install();
  return {
    trackPath(p) { e.paths.add(p); writeRecord(e); },
    trackPid(pid) { if (Number.isInteger(pid)) e.pids.add(pid); },
    trackGroup(pid) { if (Number.isInteger(pid)) e.groups.add(pid); },
    release() {
      live.delete(id);
      rmSync(e.recordFile, { force: true });
      if (!live.size) uninstall();
    },
  };
}

/** Only the shapes this adapter creates may be deleted from a (possibly corrupt) owner record. */
function sweepable(p, { base, tmpRoot }) {
  if (typeof p !== "string" || !isAbsolute(p)) return false;
  const name = basename(p);
  if (dirname(p) === tmpRoot && /^agent-home-[A-Za-z0-9]{6}$/.test(name)) return true;
  if (dirname(p) === base && /^sp6-run-[A-Za-z0-9]{6}$/.test(name)) return true;
  return dirname(p) === join(base, RELAYS) && /^[0-9a-f-]{36}\.json$/.test(name);
}

const jsonFiles = (d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => join(d, f)) : []);
const mtimeMs = (f) => { try { return statSync(f).mtimeMs; } catch { return Number.POSITIVE_INFINITY; } };

/**
 * Remove leftovers of dead runs under the run base `base` (and the worlds they own in `tmpRoot`). A world is removed
 * only when its owner pid is dead (or the record is unreadable) AND its record is older than `staleMs`; a relay file
 * only when no live owner references it AND it is older than `staleMs`. Returns the removed paths.
 */
export function sweepStale(base, { now = Date.now(), staleMs = STALE_MS, isAlive = pidAlive, tmpRoot = realpathSync(tmpdir()) } = {}) {
  const removed = [];
  const keep = new Set();
  for (const file of jsonFiles(join(base, OWNERS))) {
    let rec = null;
    try { rec = JSON.parse(readFileSync(file, "utf8")); } catch { rec = null; }
    const paths = Array.isArray(rec?.paths) ? rec.paths : [];
    const age = now - (Number.isFinite(rec?.createdAt) ? rec.createdAt : mtimeMs(file));
    const ownerLive = Number.isInteger(rec?.pid) && (rec.pid === process.pid || isAlive(rec.pid));
    if (ownerLive || age < staleMs) { for (const p of paths) keep.add(p); continue; }
    for (const p of paths) {
      if (!sweepable(p, { base, tmpRoot }) || !existsSync(p)) continue;
      rmSync(p, { recursive: true, force: true });
      removed.push(p);
    }
    rmSync(file, { force: true });
    removed.push(file);
  }
  for (const file of jsonFiles(join(base, RELAYS))) {
    if (keep.has(file) || !sweepable(file, { base, tmpRoot }) || now - mtimeMs(file) < staleMs) continue;
    rmSync(file, { force: true });
    removed.push(file);
  }
  return removed;
}
