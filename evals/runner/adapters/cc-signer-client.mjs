#!/usr/bin/env node
// @sohopay/agent-signer CLI entry, as installed into a live-eval workspace. The adapter copies this file to
// <prefix>/lib/node_modules/@sohopay/agent-signer/dist/cli/index.js with the ENDPOINT placeholder replaced by
// the signer host's 127.0.0.1 URL. It forwards argv / stdin / cwd / env and replays stdout, stderr and the exit code
// exactly, so the agent sees the real CLI contract while the run config stays out of its reach.
import { readFileSync } from "node:fs";
import { request } from "node:http";

const ENDPOINT = "__SIGNER_ENDPOINT__";
const argv = process.argv.slice(2);
const needsStdin = argv.some((t) => t === "-" || t === "--input=-" || t === "--key=-");
let stdin = "";
if (needsStdin) { try { stdin = readFileSync(0, "utf8"); } catch { stdin = ""; } }

const url = new URL(ENDPOINT);
if (url.hostname !== "127.0.0.1") {
  process.stderr.write("sohopay-signer: invalid local endpoint\n");
  process.exit(1);
}
const body = JSON.stringify({ argv, stdin, cwd: process.cwd(), env: { ...process.env } });
const req = request({ host: "127.0.0.1", port: Number(url.port), path: "/exec", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, (res) => {
  const chunks = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => {
    let r;
    try { r = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { r = { stdout: "", stderr: "sohopay-signer: internal error\n", exitCode: 1 }; }
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    process.exitCode = Number.isInteger(r.exitCode) ? r.exitCode : 1;
  });
});
req.on("error", (e) => { process.stderr.write(`sohopay-signer: ${e.message}\n`); process.exitCode = 1; });
req.end(body);
