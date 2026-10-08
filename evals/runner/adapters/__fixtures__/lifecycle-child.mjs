// Child for cc-lifecycle.test.mjs: registers a world-shaped set of paths plus a process group, prints them, then either
// waits for a signal (`wait`) or throws an uncaught exception (`throw`).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerWorld } from "../cc-lifecycle.mjs";

const [base, tmpRoot, mode] = process.argv.slice(2);
const prefix = mkdtempSync(join(tmpRoot, "agent-home-"));
const runRoot = mkdtempSync(join(base, "sp6-run-"));
mkdirSync(join(base, "relays"), { recursive: true });
const relay = join(base, "relays", "00000000-0000-4000-8000-000000000000.json");
writeFileSync(relay, "{}");
const h = registerWorld({ base, prefix, runRoot });
h.trackPath(relay);
const sleeper = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
h.trackGroup(sleeper.pid);
process.stdout.write(`${JSON.stringify({ prefix, runRoot, relay, sleeper: sleeper.pid })}\n`);
if (mode === "throw") setTimeout(() => { throw new Error("boom (uncaught)"); }, 50);
else setInterval(() => {}, 1000);
