#!/usr/bin/env node
// Claude Code hook relay client for live eval runs. The adapter installs a comment-free copy at the FIXED, secret-free
// path <run base>/hook.mjs; the hook command in the settings is just `<node> <that path> <event>` — no run-root path,
// no token (both would be readable to the agent from the session JSONL's hook attachments).
// It reads the hook payload on stdin, finds this session's relay at <run base>/relays/<session_id>.json (0600, in an
// agent-denied directory), POSTs the payload plus its own pid / parent pid (so the strace audit can exclude exactly
// the hook's process subtree), and exits non-zero unless the relay accepted it — a lost hook is a capture gap.
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const event = process.argv[2];
let raw = "";
try { raw = readFileSync(0, "utf8"); } catch { raw = ""; }
let payload = null;
try { payload = JSON.parse(raw); } catch { payload = null; }
const sid = typeof payload?.session_id === "string" && /^[A-Za-z0-9-]{1,80}$/.test(payload.session_id) ? payload.session_id : null;
let reg = null;
try { reg = sid ? JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "relays", `${sid}.json`), "utf8")) : null; } catch { reg = null; }
if (!reg || !/^http:\/\/127\.0\.0\.1:\d+\/h$/.test(reg.url ?? "") || typeof reg.token !== "string") {
  process.stderr.write("hook relay not configured for this session\n");
  process.exit(1);
}
const body = JSON.stringify({ ...payload, hook_pid: process.pid, hook_ppid: process.ppid });
const url = new URL(`${reg.url}/${event}`);
const req = request({ host: "127.0.0.1", port: Number(url.port), path: url.pathname, method: "POST", timeout: 30_000,
  headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), "x-relay-token": reg.token } }, (res) => {
  res.resume();
  res.on("end", () => { process.exitCode = res.statusCode === 200 ? 0 : 1; if (res.statusCode !== 200) process.stderr.write(`hook relay refused (${res.statusCode})\n`); });
});
req.on("timeout", () => req.destroy(new Error("timeout")));
req.on("error", (e) => { process.stderr.write(`hook relay unreachable: ${e.message}\n`); process.exitCode = 1; });
req.end(body);
