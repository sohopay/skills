// T15 fix round 1: the hook relay authenticates (M2) and fails closed (I4); persisted large outputs are read in full
// from inside the workspace or the sample is refused (M3).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HardError } from "../schema.mjs";
import { captureErrors, persistedReader, startHookRelay } from "./claude-code.mjs";
import { installHookWrapper } from "./cc-world.mjs";

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "cc-relay-")));
after(() => rmSync(ROOT, { recursive: true, force: true }));
const HOME = join(ROOT, "home");
mkdirSync(join(HOME, ".agents"), { recursive: true });
const W = { home: HOME };
const REG = (n) => join(ROOT, "reg", `${n}.json`);
const KEYCTX = { storeRoot: join(HOME, ".agents"), baseline: new Map() };
const pre = (id) => JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "cat ~/notes.txt" }, tool_use_id: id, cwd: HOME });
const post = (url, event, body, headers = {}) => fetch(`${url}/${event}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

test("M2: the relay token lives only in a 0600 registry file; requests without it, or with a guessed one, record nothing", async () => {
  const r = await startHookRelay(W, KEYCTX, { registryFile: REG("m2") });
  try {
    const reg = JSON.parse(readFileSync(REG("m2"), "utf8"));
    assert.equal(statSync(REG("m2")).mode & 0o777, 0o600);
    assert.match(reg.token, /^[0-9a-f]{64}$/);
    assert.equal(reg.url, r.url);
    assert.ok(!r.url.includes(r.token), "the token is not in the URL (hence not in any argv)");
    assert.equal((await post(r.url, "pre", pre("toolu_1"))).status, 404);
    assert.equal((await post(r.url, "denied", pre("toolu_1"), { "x-relay-token": "0".repeat(64) })).status, 404);
    assert.equal(r.hooks.size, 0);
    assert.deepEqual(r.errors, [], "forged attempts are not even relay errors (they cannot DoS the run)");
    assert.equal((await post(r.url, "pre", pre("toolu_1"), { "x-relay-token": r.token })).status, 200);
    assert.ok(r.hooks.get("toolu_1").pre);
  } finally { await r.close(); }
});

test("I4: malformed payloads, a missing tool_use_id and a resolver exception are relay errors", async () => {
  const r = await startHookRelay(W, KEYCTX, { registryFile: REG("i4"), resolve: () => { throw new Error("boom"); } });
  try {
    const h = { "x-relay-token": r.token };
    await post(r.url, "pre", "{not json", h);
    await post(r.url, "pre", JSON.stringify({ tool_name: "Bash", tool_input: {} }), h);
    await post(r.url, "post", pre("toolu_2"), h);
    assert.equal(r.errors.length, 3, JSON.stringify(r.errors));
    assert.match(r.errors.join("\n"), /malformed/);
    assert.match(r.errors.join("\n"), /tool_use_id/);
    assert.match(r.errors.join("\n"), /boom/);
  } finally { await r.close(); }
});

test("I4: captureErrors — every answered call needs Pre and Post (or a denial); relay errors and gaps are listed", () => {
  const items = [
    { kind: "call", id: "a", name: "Bash" }, { kind: "result", id: "a" },
    { kind: "call", id: "b", name: "WebFetch" }, { kind: "result", id: "b", denialKind: "permission-rule" },
    { kind: "call", id: "c", name: "Read" }, { kind: "result", id: "c" },
    { kind: "call", id: "d", name: "Bash" }, // never answered (turn cap): Pre suffices
  ];
  const relay = { errors: [], hooks: new Map([["a", { pre: {}, post: {} }], ["b", { denied: true }], ["c", { pre: {} }], ["d", { pre: {} }]]) };
  assert.deepEqual(captureErrors(items, relay), ["capture gap: c has no PostToolUse record"]);
  relay.hooks.set("c", { pre: {}, post: {} });
  assert.deepEqual(captureErrors(items, relay), []);
  relay.errors.push("malformed payload");
  assert.deepEqual(captureErrors(items, relay), ["hook relay error: malformed payload"]);
});

test("M3: a persisted output is read in full from inside the workspace; outside or missing is an adapter error", () => {
  const f = join(HOME, ".claude", "projects", "p", "tool-results", "t.txt");
  mkdirSync(join(HOME, ".claude", "projects", "p", "tool-results"), { recursive: true });
  writeFileSync(f, "full output\n");
  const read = persistedReader(HOME);
  assert.equal(read(f), "full output\n");
  assert.equal(read(f, 12), "full output\n");
  assert.throws(() => read(f, 13), (e) => e instanceof HardError && /shorter/.test(e.message), "N5: shorter than persistedOutputSize");
  const link = join(HOME, ".claude", "projects", "p", "tool-results", "link.txt");
  symlinkSync(f, link);
  assert.throws(() => read(link), (e) => e instanceof HardError && /symlink|tool-results/.test(e.message), "N5: a symlink is refused (lstat)");
  writeFileSync(join(HOME, "notes.txt"), "n");
  assert.throws(() => read(join(HOME, "notes.txt")), (e) => e instanceof HardError && /tool-results/.test(e.message), "N5: only HOME/.claude/projects/<slug>/tool-results/");
  assert.throws(() => read(join(ROOT, "relay.hdr")), HardError);
  assert.throws(() => read(join(HOME, "missing.txt")), HardError);
  assert.throws(() => read(`${HOME}/../relay.hdr`), HardError);
});

/** Run the installed hook wrapper like Claude Code does: a command with the hook payload on stdin. */
function runWrapper(wrapper, event, payload) {
  return new Promise((done) => {
    const c = spawn(process.execPath, [wrapper, event], { stdio: ["pipe", "pipe", "pipe"] });
    let err = "";
    c.stderr.on("data", (d) => { err += d; });
    c.on("close", (code) => done({ code, err, pid: c.pid }));
    c.stdin.end(JSON.stringify(payload));
  });
}

test("N1: the hook wrapper has a fixed, secret-free path; it finds the relay via the session id in a denied registry and reports its pid", async () => {
  const base = join(ROOT, "base");
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const wrapper = installHookWrapper(base);
  assert.equal(wrapper, join(base, "hook.mjs"));
  assert.ok(!/[0-9a-f]{32}|sp6-run-|relay\.hdr/.test(readFileSync(wrapper, "utf8")), "no token or run-root path in the wrapper");
  const registryFile = join(base, "relays", "sess-1.json");
  const r = await startHookRelay(W, KEYCTX, { registryFile });
  try {
    assert.equal(statSync(registryFile).mode & 0o777, 0o600);
    const res = await runWrapper(wrapper, "pre", { session_id: "sess-1", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "true" }, tool_use_id: "toolu_w", cwd: HOME });
    assert.equal(res.code, 0, res.err);
    assert.ok(r.hooks.get("toolu_w").pre);
    assert.ok(r.hookPids.has(res.pid), "the hook's own pid is reported over the authenticated relay");
  } finally { await r.close(); }
});

// Linux CI (run 37747714088, keygen-routes-to-signer: "capture gap: … has no PreToolUse record"): every createWorld
// re-wrote the ONE shared <run base>/hook.mjs in place (truncate, then write) while `node --test` ran other files'
// samples in parallel against the same base — a hook node that loaded the file in that window ran an empty (exit 0,
// nothing relayed) or truncated module, and the call's PreToolUse was lost. A concurrent reader must only ever see
// the whole wrapper.
test("the shared hook wrapper is installed atomically: concurrent installs never expose a truncated or empty wrapper to a hook", async () => {
  const base = join(ROOT, "base-atomic");
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const wrapper = installHookWrapper(base);
  const want = readFileSync(wrapper, "utf8");
  const ino = statSync(wrapper).ino;
  assert.equal(statSync(installHookWrapper(base)).ino, ino, "an identical wrapper is left in place, not rewritten");
  writeFileSync(wrapper, "// an older wrapper\n", { mode: 0o700 });
  installHookWrapper(base);
  assert.equal(readFileSync(wrapper, "utf8"), want, "a different wrapper is replaced");
  assert.equal(statSync(wrapper).mode & 0o777, 0o700);
  assert.deepEqual(readdirSync(base).filter((n) => n !== "hook.mjs"), [], "no temp file left behind");
  // Another test process installing into the same base while hooks load the wrapper; between installs it swaps an
  // older (complete) wrapper in by rename, so every install has to replace the file.
  const STALE = "// an older wrapper\n";
  const installer = new URL("./cc-world.mjs", import.meta.url).href;
  const src = `import { installHookWrapper } from ${JSON.stringify(installer)}; import { renameSync, writeFileSync } from "node:fs";
    for (let i = 0; i < 300; i++) { writeFileSync(${JSON.stringify(`${wrapper}.old`)}, ${JSON.stringify(STALE)}); renameSync(${JSON.stringify(`${wrapper}.old`)}, ${JSON.stringify(wrapper)}); for (let k = 0; k < 3; k++) installHookWrapper(${JSON.stringify(base)}); }`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", src], { stdio: "ignore" });
  let exited = false;
  const done = new Promise((r) => child.once("exit", (code) => { exited = true; r(code); }));
  const seen = new Set();
  while (!exited) {
    const body = readFileSync(wrapper, "utf8");
    seen.add(body === want ? "whole" : body === STALE ? "older" : `partial (${body.length} bytes)`);
    await new Promise((r) => setImmediate(r));
  }
  assert.equal(await done, 0);
  assert.deepEqual([...seen].filter((s) => s.startsWith("partial")), [], "a hook never loads a truncated or empty wrapper");
  assert.equal(readFileSync(wrapper, "utf8"), want);
});

test("N7: the wrapper fails (non-zero, like curl -f) when the relay rejects it — so a lost hook is a capture gap, never silent", async () => {
  const base = join(ROOT, "base2");
  mkdirSync(join(base, "relays"), { recursive: true, mode: 0o700 });
  const wrapper = installHookWrapper(base);
  const r = await startHookRelay(W, KEYCTX, { registryFile: join(base, "relays", "real.json") });
  try {
    writeFileSync(join(base, "relays", "forged.json"), JSON.stringify({ url: r.url, token: "0".repeat(64) }), { mode: 0o600 });
    const bad = await runWrapper(wrapper, "pre", { session_id: "forged", tool_use_id: "toolu_f", tool_name: "Bash", tool_input: {} });
    assert.equal(bad.code, 1);
    const none = await runWrapper(wrapper, "pre", { session_id: "missing", tool_use_id: "toolu_m", tool_name: "Bash", tool_input: {} });
    assert.equal(none.code, 1);
    assert.equal(r.hooks.size, 0);
  } finally { await r.close(); }
});
