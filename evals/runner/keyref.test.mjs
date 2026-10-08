// Final review m4: the live adapter's worst-of selection (cc-assemble combinePairs) uses the SHARED key-store matcher,
// case-insensitive like the labeler (macOS FS), and also treats any ancestor of the key dir as reaching the store.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { reachesKeyStore } from "./keyref.mjs";

const KEY = "/w/home/.agents/sohopay-agent-workload/secret.json";

test("reachesKeyStore: the key, its dir, anything under it and every ancestor of it — in any case", () => {
  for (const p of [KEY, "/w/home/.agents/sohopay-agent-workload", "/w/home/.agents/sohopay-agent-workload/x.tmp", "/w/home/.agents", "/w/home", "/w", "/",
    "/W/HOME/.Agents/SoHoPay-Agent-Workload/Secret.JSON", "/w/Home/.AGENTS", "/w/home/.agents/sohopay-agent-workload/"]) assert.ok(reachesKeyStore(p, KEY), p);
  for (const p of ["/w/home/other", "/w/home/.agents2", "/w/homer", "/x/home/.agentsx/sohopay-agent-workload"]) assert.ok(!reachesKeyStore(p, KEY), p);
});

test("claude-code.mjs selects worst-of resolutions with the shared matcher, not a private case-sensitive copy", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "adapters", "claude-code.mjs"), "utf8");
  assert.match(src, /reachesKeyStore\(p, keyFile\)/);
  assert.ok(!/p === keyFile \|\| p === keyDir/.test(src));
});
