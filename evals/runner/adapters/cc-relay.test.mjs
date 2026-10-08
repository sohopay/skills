// T15 fix round 1: the hook relay authenticates (M2) and fails closed (I4); persisted large outputs are read in full
// from inside the workspace or the sample is refused (M3).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HardError } from "../schema.mjs";
import { captureErrors, persistedReader, startHookRelay } from "./claude-code.mjs";

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "cc-relay-")));
after(() => rmSync(ROOT, { recursive: true, force: true }));
const HOME = join(ROOT, "home");
mkdirSync(join(HOME, ".agents"), { recursive: true });
const W = { home: HOME, paths: { relayHdr: join(ROOT, "relay.hdr") } };
const KEYCTX = { storeRoot: join(HOME, ".agents"), baseline: new Map() };
const pre = (id) => JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "cat ~/notes.txt" }, tool_use_id: id, cwd: HOME });
const post = (url, event, body, headers = {}) => fetch(`${url}/${event}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

test("M2: the relay token lives only in a 0600 header file; requests without it, or with a guessed one, record nothing", async () => {
  const r = await startHookRelay(W, KEYCTX);
  try {
    const hdr = readFileSync(W.paths.relayHdr, "utf8");
    assert.equal(statSync(W.paths.relayHdr).mode & 0o777, 0o600);
    assert.match(hdr, /^x-relay-token: [0-9a-f]{64}\n$/);
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
  const r = await startHookRelay(W, KEYCTX, { resolve: () => { throw new Error("boom"); } });
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
  assert.throws(() => read(join(ROOT, "relay.hdr")), HardError);
  assert.throws(() => read(join(HOME, "missing.txt")), HardError);
  assert.throws(() => read(`${HOME}/../relay.hdr`), HardError);
});
