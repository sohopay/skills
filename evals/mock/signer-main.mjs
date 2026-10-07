// Process entry for the mock `sohopay-signer` (mirrors src/cli/index.ts: read stdin only when an argument is "-",
// write stdout then stderr, set the exit code). The run config is a JSON file named by SP6_MOCK_RUN; install.mjs
// bakes that into a per-run wrapper so the agent's own environment carries nothing mock-specific.
import { readFileSync } from "node:fs";
import { makeContext, needsStdin, run } from "./signer-core.mjs";

function readStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

/** Run one CLI invocation against the configured scenario. */
export function main() {
  const argv = process.argv.slice(2);
  const cfgPath = process.env.SP6_MOCK_RUN;
  const config = cfgPath ? JSON.parse(readFileSync(cfgPath, "utf8")) : null;
  const ctx = makeContext(config, { env: process.env, cwd: process.cwd(), argv });
  const stdin = needsStdin(argv) ? readStdin() : "";
  const result = run(argv, stdin, ctx);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
