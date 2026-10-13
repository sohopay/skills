#!/usr/bin/env node
// @sohopay/agent-signer CLI entry, as installed into a live-eval workspace. The adapter copies this file to
// <prefix>/lib/node_modules/@sohopay/agent-signer/dist/cli/index.js (comment lines stripped) with the ENDPOINT and
// CLIENT placeholders filled in. It forwards argv / stdin / cwd and an env ALLOWLIST (HOME and SOHOPAY_* — never API
// keys or tokens) and replays stdout, stderr and the exit code exactly.
import { readFileSync } from "node:fs";
import { request } from "node:http";

const ENDPOINT = "__SIGNER_ENDPOINT__";
const CLIENT = "__SIGNER_CLIENT__";
const argv = process.argv.slice(2);
let stdin = "";
if (argv.some((t) => t === "-" || t === "--input=-" || t === "--key=-")) { try { stdin = readFileSync(0, "utf8"); } catch { stdin = ""; } }
const env = {};
for (const [k, v] of Object.entries(process.env)) if (k === "HOME" || /^SOHOPAY_[A-Z0-9_]+$/.test(k)) env[k] = v;
const url = new URL(ENDPOINT);
// 127.0.0.1, or the mock's advertised host (SP6_MOCK_HOST: one DNS label, plain http, no path) — nothing else.
const loopback = url.hostname === "127.0.0.1";
if (url.protocol !== "http:" || url.pathname !== "/" || !(loopback || /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(url.hostname))) { process.stderr.write("sohopay-signer: invalid local endpoint\n"); process.exit(1); }
// Inside Claude Code's Linux sandbox (its own netns) the advertised host is reachable only through the sandbox's egress
// proxy: send an absolute-URI request to it. Loopback stays direct (the macOS / unsandboxed path).
const proxyVar = process.env.http_proxy || process.env.HTTP_PROXY;
const proxy = !loopback && proxyVar ? new URL(proxyVar) : null;
const body = JSON.stringify({ argv, stdin, cwd: process.cwd(), env });
const target = proxy
  ? { host: proxy.hostname, port: Number(proxy.port || 80), path: `http://${url.host}/exec` }
  : { host: url.hostname, port: Number(url.port), path: "/exec" };
const req = request({ ...target, method: "POST", headers: { host: url.host, "content-type": "application/json", "content-length": Buffer.byteLength(body), "x-signer-client": CLIENT } }, (res) => {
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
