// Relay for Claude Code's PreToolUse / PostToolUse / PostToolUseFailure / PermissionDenied hooks. At each call
// boundary (capture time, in the hermetic world) it resolves the call's path arguments and snapshots the key store.
//
// M2: the relay binds a random 127.0.0.1 port and accepts only requests carrying its token in `x-relay-token`. The
// token lives only in a 0600 header file in the run root (denied to the agent) that the hook command passes with
// `curl -H @<file>` — it is never on any argv. Anything else gets a 404 and records nothing.
// I4: every failure — malformed payload, no tool_use_id, a resolver or snapshot exception — is a relay error, and any
// relay error or missing record makes the sample an adapter error (captureErrors).
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { HardError } from "../schema.mjs";
import { tokenEquals } from "../../mock/signer-host.mjs";
import { diffSnapshots, snapshotTree } from "../../mock/lib/keystore-snapshot.mjs";
import { argPaths, resolveArgs } from "./cc-paths.mjs";

const defaultResolve = (name, input, cwd, home) => resolveArgs(argPaths(name, input, { cwd, home }));

/**
 * @param {{home:string, paths:{relayHdr:string}}} w
 * @param {{storeRoot:string, baseline:Map<string,string>}} keyCtx
 * @param {{resolve?: Function}} [opts]  resolver override (tests)
 */
export async function startHookRelay(w, keyCtx, { resolve = defaultResolve } = {}) {
  const token = randomBytes(32).toString("hex");
  writeFileSync(w.paths.relayHdr, `x-relay-token: ${token}\n`, { mode: 0o600 });
  const hooks = new Map();
  const errors = [];
  let last = keyCtx.baseline;
  const observe = () => { const snap = snapshotTree(keyCtx.storeRoot); const d = diffSnapshots(last, snap); last = snap; return d; };
  const handle = (event, raw) => {
    const at = Date.now();
    let p;
    try { p = JSON.parse(raw); } catch { errors.push(`malformed payload for ${event}`); return; }
    if (!p || typeof p.tool_use_id !== "string" || p.tool_use_id === "") { errors.push(`${event} payload without tool_use_id (${p?.tool_name ?? "?"})`); return; }
    const id = p.tool_use_id;
    const rec = hooks.get(id) ?? {};
    if (event === "denied") rec.denied = true;
    else {
      const cwd = typeof p.cwd === "string" && p.cwd ? p.cwd : w.home;
      try {
        rec[event] = { at, pairs: resolve(String(p.tool_name ?? ""), p.tool_input ?? {}, cwd, w.home), diffs: observe(), cwd };
      } catch (e) { errors.push(`${event} capture failed for ${id}: ${e.message}`); return; }
    }
    hooks.set(id, rec);
  };
  const server = createServer((req, res) => {
    const m = /^\/h\/(pre|post|denied)$/.exec(req.url ?? "");
    if (req.method !== "POST" || !m || !tokenEquals(req.headers["x-relay-token"], token)) { res.writeHead(404); return res.end(); }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { handle(m[1], Buffer.concat(chunks).toString("utf8")); res.writeHead(200); res.end(); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}/h`, token, hooks, errors,
    finalDiffs: () => { try { return observe(); } catch (e) { errors.push(`final key-store snapshot failed: ${e.message}`); return []; } },
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/** `-p` silently ignores an invalid settings file (deny rules, sandbox and hooks with it): no hook at all is a refusal. */
export function checkHooksApplied(items, relay) {
  const calls = items.filter((c) => c.kind === "call");
  if (calls.length > 0 && !calls.some((c) => relay.hooks.get(c.id)?.pre || relay.hooks.get(c.id)?.denied)) {
    throw new HardError("claude-code adapter: no tool hook ever fired — the --settings file was not applied (sandbox / deny rules cannot be trusted)");
  }
}

/**
 * I4: everything that makes a capture incomplete. A denied call needs its denial; every other call needs a PreToolUse
 * record, and an answered one a PostToolUse(-Failure) record too. Relay errors come first.
 */
export function captureErrors(items, relay) {
  const out = relay.errors.map((e) => `hook relay error: ${e}`);
  const results = new Map(items.filter((x) => x.kind === "result").map((r) => [r.id, r]));
  for (const c of items.filter((x) => x.kind === "call")) {
    const h = relay.hooks.get(c.id) ?? {};
    const r = results.get(c.id);
    if (h.denied || r?.denialKind) continue;
    if (!h.pre) out.push(`capture gap: ${c.id} has no PreToolUse record`);
    else if (r && !h.post) out.push(`capture gap: ${c.id} has no PostToolUse record`);
  }
  return out;
}
