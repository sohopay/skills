// Live runs 38439359018 / 38448603622 / 38510109321: about 6 x402 samples per run failed "capture gap: <id> has no
// PreToolUse record" (always two ids, never onboarding), and the report carried nothing else to diagnose them.
// (1) A hook whose POST to the relay fails transiently now retries, and the relay dedupes the retry, so a retry never
//     re-observes (and so never overwrites) the key-store diffs of the first delivery.
// (2) A capture gap now says what the session itself recorded for that call: tool, parallel siblings, the Post record,
//     and the CLI's own hook attachment (exit code, duration, stderr).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureErrors, startHookRelay } from "./claude-code.mjs";
import { installHookWrapper } from "./cc-world.mjs";
import { sessionHookDiagnostics } from "./cc-parse.mjs";

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "cc-relay-retry-")));
after(() => rmSync(ROOT, { recursive: true, force: true }));
const HOME = join(ROOT, "home");
mkdirSync(join(HOME, ".agents"), { recursive: true });
const W = { home: HOME };
const KEYCTX = { storeRoot: join(HOME, ".agents"), baseline: new Map() };
const body = (id, nonce) => JSON.stringify({ tool_name: "Bash", tool_input: { command: "true" }, tool_use_id: id, cwd: HOME, hook_nonce: nonce });
const send = (r, event, b) => fetch(`${r.url}/${event}`, { method: "POST", headers: { "content-type": "application/json", "x-relay-token": r.token }, body: b });

test("the relay ignores a retried delivery (same hook_nonce): the first observation and its diffs stand", async () => {
  const r = await startHookRelay(W, KEYCTX, { registryFile: join(ROOT, "reg", "dedupe.json") });
  try {
    writeFileSync(join(HOME, ".agents", "planted.txt"), "x");
    assert.equal((await send(r, "pre", body("toolu_d", "n1"))).status, 200);
    const first = r.hooks.get("toolu_d").pre;
    assert.ok(first.diffs.length > 0, "the first delivery observed the key-store change");
    assert.equal((await send(r, "pre", body("toolu_d", "n1"))).status, 200, "a retry is acknowledged");
    assert.equal(r.hooks.get("toolu_d").pre, first, "a retry does not re-observe");
    assert.deepEqual(r.errors, []);
  } finally { await r.close(); rmSync(join(HOME, ".agents", "planted.txt"), { force: true }); }
});

test("a second distinct delivery for the same call keeps the first record and adds the new diffs", async () => {
  const r = await startHookRelay(W, KEYCTX, { registryFile: join(ROOT, "reg", "merge.json") });
  try {
    writeFileSync(join(HOME, ".agents", "a.txt"), "a");
    await send(r, "pre", body("toolu_m", "n1"));
    const { at, diffs } = r.hooks.get("toolu_m").pre;
    writeFileSync(join(HOME, ".agents", "b.txt"), "b");
    await send(r, "pre", body("toolu_m", "n2"));
    const rec = r.hooks.get("toolu_m").pre;
    assert.equal(rec.at, at, "the first delivery's time stands");
    assert.ok(diffs.every((d) => rec.diffs.includes(d)), "the first delivery's diffs are kept");
    assert.ok(rec.diffs.length > diffs.length, "the second delivery's diffs are added");
  } finally { await r.close(); rmSync(join(HOME, ".agents", "a.txt"), { force: true }); rmSync(join(HOME, ".agents", "b.txt"), { force: true }); }
});

/** A stand-in relay at a registry url: `plan(n)` decides the n-th request ("drop" the socket, or a status code). */
async function fakeRelay(name, plan) {
  const base = join(ROOT, `base-${name}`);
  mkdirSync(join(base, "relays"), { recursive: true, mode: 0o700 });
  const wrapper = installHookWrapper(base);
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      const step = plan(seen.length);
      if (step === "drop") return req.socket.destroy();
      res.writeHead(step); res.end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  writeFileSync(join(base, "relays", "s1.json"), JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/h`, token: "t".repeat(64) }), { mode: 0o600 });
  const run = () => new Promise((done) => {
    const c = spawn(process.execPath, [wrapper, "pre"], { stdio: ["pipe", "pipe", "pipe"] });
    let err = "";
    c.stderr.on("data", (d) => { err += d; });
    c.on("close", (code) => done({ code, err }));
    c.stdin.end(JSON.stringify({ session_id: "s1", tool_use_id: "toolu_r", tool_name: "Bash", tool_input: {} }));
  });
  return { seen, run, close: () => new Promise((r) => server.close(() => r())) };
}

test("the hook wrapper retries a dropped delivery with the same hook_nonce, and succeeds", async () => {
  const f = await fakeRelay("drop", (n) => (n === 1 ? "drop" : 200));
  try {
    const res = await f.run();
    assert.equal(res.code, 0, res.err);
    assert.equal(f.seen.length, 2);
    assert.match(f.seen[0].hook_nonce, /^[0-9a-f]{32}$/);
    assert.equal(f.seen[1].hook_nonce, f.seen[0].hook_nonce, "a retry carries the same nonce, so the relay can dedupe it");
  } finally { await f.close(); }
});

test("the hook wrapper does not retry a refusal (404) and still fails, so a lost hook stays a capture gap", async () => {
  const f = await fakeRelay("refuse", () => 404);
  try {
    const res = await f.run();
    assert.equal(res.code, 1);
    assert.equal(f.seen.length, 1);
  } finally { await f.close(); }
});

test("the hook wrapper gives up after its retries and fails", async () => {
  const f = await fakeRelay("down", () => "drop");
  try {
    const res = await f.run();
    assert.equal(res.code, 1);
    assert.equal(f.seen.length, 3);
    assert.match(res.err, /hook relay unreachable/);
  } finally { await f.close(); }
});

const line = (o) => JSON.stringify(o);
const SESSION = [
  line({ type: "assistant", message: { id: "msg_1", content: [{ type: "tool_use", id: "toolu_a", name: "Bash", input: {} }, { type: "tool_use", id: "toolu_b", name: "mcp__sohopay__get_context", input: {} }] } }),
  line({ type: "attachment", attachment: { type: "hook_non_blocking_error", hookEvent: "PreToolUse", toolUseID: "toolu_a", exitCode: 1, durationMs: 30012, stderr: "hook relay unreachable: timeout\n" } }),
  line({ type: "attachment", attachment: { type: "hook_success", hookEvent: "PostToolUse", toolUseID: "toolu_a", exitCode: 0, durationMs: 80, stderr: "" } }),
  line({ type: "attachment", attachment: { type: "hook_success", hookEvent: "Stop", exitCode: 0 } }),
].join("\n");

test("sessionHookDiagnostics reads each call's message and the CLI's own tool-hook records", () => {
  const d = sessionHookDiagnostics(SESSION);
  assert.equal(d.messageOf.get("toolu_a"), "msg_1");
  assert.equal(d.messageOf.get("toolu_b"), "msg_1");
  assert.deepEqual(d.hooksOf.get("toolu_a").map((h) => [h.event, h.type, h.exitCode]), [["PreToolUse", "hook_non_blocking_error", 1], ["PostToolUse", "hook_success", 0]]);
  assert.equal(d.hooksOf.get("toolu_b"), undefined);
});

test("a capture gap carries the session's evidence: tool, parallel siblings, Post record and the CLI hook record", () => {
  const items = [
    { kind: "call", id: "toolu_a", name: "Bash" }, { kind: "call", id: "toolu_b", name: "mcp__sohopay__get_context" },
    { kind: "result", id: "toolu_a" }, { kind: "result", id: "toolu_b" },
  ];
  const relay = { errors: [], hooks: new Map([["toolu_a", { post: {} }]]) };
  const [ea, eb] = captureErrors(items, relay, sessionHookDiagnostics(SESSION));
  assert.match(ea, /^capture gap: toolu_a has no PreToolUse record \(/);
  assert.match(ea, /Bash/);
  assert.match(ea, /parallel with toolu_b/);
  assert.match(ea, /relayed post: yes/);
  assert.match(ea, /PreToolUse hook_non_blocking_error exit 1 30012ms: hook relay unreachable: timeout/);
  assert.match(eb, /^capture gap: toolu_b has no PreToolUse record \(/);
  assert.match(eb, /CLI hook records: none/);
  assert.deepEqual(captureErrors(items, relay), ["capture gap: toolu_a has no PreToolUse record", "capture gap: toolu_b has no PreToolUse record"], "without diagnostics the messages are unchanged");
});
