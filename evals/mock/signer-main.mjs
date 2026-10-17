// Process entry for the mock `sohopay-signer` (mirrors src/cli/index.ts: read stdin only when an argument is "-",
// write stdout then stderr, set the exit code). The run config is a JSON file named by SP6_MOCK_RUN; install.mjs
// bakes that into a per-run wrapper so the agent's own environment carries nothing mock-specific.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { makeContext, needsStdin, run } from "./signer-core.mjs";

function readStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

/**
 * A globally installed @sohopay/agent-signer whose dependency tree is incomplete (the `@noble/curves` it imports is
 * missing): the real-shaped way an installed signer fails to answer `capabilities`. Laid out like an npm global
 * prefix (`<root>/lib/node_modules/@sohopay/agent-signer/dist/...`); returns the bin entry to execute.
 */
export function brokenInstallEntry(root) {
  const pkg = join(root, "lib", "node_modules", "@sohopay", "agent-signer");
  const entry = join(pkg, "dist", "cli", "index.js");
  if (!existsSync(entry)) {
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(join(pkg, "package.json"), `${JSON.stringify({ name: "@sohopay/agent-signer", version: "0.3.1", type: "module", bin: { "sohopay-signer": "dist/cli/index.js" } }, null, 2)}\n`);
    writeFileSync(join(pkg, "dist", "keys.js"), 'import { ed25519 } from "@noble/curves/ed25519";\nexport const curve = ed25519;\n');
    writeFileSync(entry, '#!/usr/bin/env node\nimport { curve } from "../keys.js";\nexport default curve;\n');
  }
  return entry;
}

/** Run one CLI invocation against the configured scenario. */
export function main() {
  const argv = process.argv.slice(2);
  const cfgPath = process.env.SP6_MOCK_RUN;
  const config = cfgPath ? JSON.parse(readFileSync(cfgPath, "utf8")) : null;
  if (config?.signer?.answers === false) {
    // Node itself reports the broken install (its own trace and version line); nothing is synthesised here.
    const r = spawnSync(process.execPath, [brokenInstallEntry(config.broken_install_root ?? dirname(cfgPath)), ...argv], { stdio: "inherit" });
    process.exitCode = r.status ?? 1;
    return;
  }
  const ctx = makeContext(config, { env: process.env, cwd: process.cwd(), argv });
  const stdin = needsStdin(argv) ? readStdin() : "";
  const result = run(argv, stdin, ctx);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
