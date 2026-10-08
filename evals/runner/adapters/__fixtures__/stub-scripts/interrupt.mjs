// Stub "model" (final review m8): reports where the adapter put the agent's world, then hangs so the test can interrupt
// the harness process mid-sample.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export const costUsd = 0.01;

export default async function interrupt(agent, ctx) {
  writeFileSync(join(ctx.recordDir, "where.json"), JSON.stringify({ home: ctx.home }));
  await new Promise(() => setInterval(() => {}, 1000));
}
