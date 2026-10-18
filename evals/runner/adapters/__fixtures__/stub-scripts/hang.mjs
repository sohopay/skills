// Stub "model" (T15 fix I7): starts a background child, then hangs while ignoring SIGTERM. The adapter's timeout
// must kill the whole process group (stub and background child) with SIGKILL after the grace period.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export const costUsd = 0.01;

export default async function hang(agent, ctx) {
  process.on("SIGTERM", () => {});
  const r = agent.bash("sleep 300 >/dev/null 2>&1 & echo $!");
  writeFileSync(join(ctx.recordDir, "pids.json"), JSON.stringify({ stub: process.pid, child: Number(r.stdout.trim()) }));
  await new Promise(() => setInterval(() => {}, 1000));
}
