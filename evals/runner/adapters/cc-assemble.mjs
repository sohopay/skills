// Assemble one live run into the normalized transcript (schema.mjs is the authority on the shape).
// Pure: every input is plain data the adapter captured (parsed session items, hook-time path resolutions and
// key-store diffs, the post-run re-resolution, the mock journal, the sandbox audit). Ordering contract:
//   … tool_call(X) · tool_result(X) · input_condition* · file_op* · file_open_audit* · … · stop
// i.e. side effects observed during a call are merged right after that call's result (recorder.mjs is the
// reference), effects observed between calls go right before the next call, and everything else goes before the
// terminal stop — never after it, never dropped.
import { HardError } from "../schema.mjs";
import { deniedIds, stopReason } from "./cc-parse.mjs";

const GLOB_CHARS_RE = /[*?[]|\{[^}]*,/; // same rule as schema.mjs pairMultiplicityErrors

/**
 * Combine one call's resolutions taken at different times into its resolved_paths. Per non-glob argument
 * occurrence the WORST observation wins: a resolution that reaches the key store beats one that does not (a
 * symlink planted after, or swapped back before, any single observation still surfaces). Globs keep the union.
 * @param {Array<{arg:string, path:string}>[]} observations  ordered [post-call, pre-call, post-run]
 * @param {(p:string)=>boolean} sensitive
 */
export function combinePairs(observations, sensitive) {
  const lists = observations.filter(Array.isArray);
  if (lists.length === 0) return undefined;
  const byArg = new Map();
  for (const [t, list] of lists.entries()) {
    const seen = new Map();
    for (const p of list) {
      const n = seen.get(p.arg) ?? 0;
      seen.set(p.arg, n + 1);
      if (!byArg.has(p.arg)) byArg.set(p.arg, []);
      const slots = byArg.get(p.arg);
      if (GLOB_CHARS_RE.test(p.arg)) { (slots[0] ??= new Set()).add(p.path); continue; }
      (slots[n] ??= []).push({ t, path: p.path });
    }
  }
  const out = [];
  for (const [arg, slots] of byArg) {
    if (GLOB_CHARS_RE.test(arg)) { for (const path of [...(slots[0] ?? [])].sort()) out.push({ arg, path }); continue; }
    for (const obs of slots) {
      if (!obs || obs.length === 0) continue;
      const hit = obs.find((o) => sensitive(o.path));
      out.push({ arg, path: (hit ?? obs[0]).path });
    }
  }
  return out;
}

/** Which call an effect observed at `at` belongs to: the call whose [start, end] window holds it, else the first
 * call ending after it. `prefer(call)` breaks ties between overlapping (parallel) windows. */
function attribute(at, windows, prefer) {
  const inside = windows.filter((w) => at >= w.start && at <= w.end);
  const pick = inside.find(prefer) ?? inside[0];
  if (pick) return pick.id;
  const after = windows.filter((w) => w.end >= at).sort((a, b) => a.end - b.end)[0];
  return after ? after.id : null;
}

function fileOpOf(d) {
  const verb = d.change === "create" && typeof d.after === "string" && d.after.startsWith("symlink|") ? "symlink" : d.change;
  return { type: "file_op", verb, path: d.path, source: "keystore-audit" };
}

/**
 * @param {object} o
 * @param {object[]} o.items          parseSession() output
 * @param {object|null} o.result      stream-json result message
 * @param {object} [o.exit]           {code, signal, timedOut}
 * @param {Map<string, object>} o.hooks  tool_use_id → {pre?:{at, pairs, diffs}, post?:{at, pairs, diffs}, denied?:boolean}
 * @param {Map<string, object[]>} o.postRun  tool_use_id → pairs re-resolved after the run
 * @param {object[]} o.journal        mock journal entries {condition, source, tool?, at}
 * @param {object[]} o.lateDiffs      key-store changes seen after the last hook (final snapshot) {change, path, after}
 * @param {object[]} o.audit          strace audit events {path, op, at, callId?} (callId set: already attributed)
 * @param {(p:string)=>boolean} o.sensitive  does a resolved path reach the key store (worst-of choice)
 * @param {object} o.base             {case_id, suite, meta, secrets, sensitive_paths}
 * @param {object[]} [o.owned]        signer-host log: key-store post-states `key generate` itself produced
 * @param {object[]} [o.signerExecs]  signer-host log: one entry per /exec {argv, at, done, opens[], refusals[]}
 */
export function assemble(o) {
  const { items, result, exit, hooks, postRun, journal, audit, sensitive, base, owned = [], signerExecs = [] } = o;
  // Key-store changes are exempt only when their post-state is exactly one `key generate` produced (M5: a
  // background write landing during that keygen is indistinguishable — documented residual).
  const notOwned = (d) => !(d.after !== null && owned.some((w) => w.path === d.path && w.after === d.after));
  const lateDiffs = o.lateDiffs.filter(notOwned);
  const denied = deniedIds(result);
  for (const [id, h] of hooks) if (h.denied) denied.add(id);
  const calls = new Map();
  const resultTs = new Map();
  for (const it of items) {
    if (it.kind === "call") calls.set(it.id, it);
    else if (it.kind === "result") {
      if (!calls.has(it.id)) throw new HardError(`session: tool_result for unknown tool_use_id ${it.id}`);
      resultTs.set(it.id, it.ts);
      if (it.denialKind) denied.add(it.id);
    }
  }
  const windows = [...calls.values()].map((c) => ({
    id: c.id, name: c.name,
    start: hooks.get(c.id)?.pre?.at ?? c.ts ?? 0,
    end: hooks.get(c.id)?.post?.at ?? resultTs.get(c.id) ?? Number.POSITIVE_INFINITY,
  }));
  const afterResult = new Map(); // id → extra events merged right after that call's result
  const beforeCall = new Map();  // id → effects observed between the previous call and this one
  const tail = [];
  const queue = (map, id, e) => { if (!map.has(id)) map.set(id, []); map.get(id).push(e); };

  for (const j of journal) {
    const id = attribute(j.at, windows, (w) => (j.source === "backend" ? w.name.endsWith(`__${j.tool}`) : w.name === "Bash"));
    const e = { type: "input_condition", label: j.condition, rank: 0, at: j.at };
    if (id) queue(afterResult, id, e); else tail.push(e);
  }
  for (const [id, h] of hooks) {
    if (!calls.has(id)) continue;
    for (const d of (h.pre?.diffs ?? []).filter(notOwned)) queue(beforeCall, id, fileOpOf(d));
    for (const d of (h.post?.diffs ?? []).filter(notOwned)) queue(afterResult, id, { ...fileOpOf(d), rank: 1, at: h.post.at });
  }
  for (const a of audit) {
    const id = "callId" in a ? (calls.has(a.callId) ? a.callId : null) : attribute(a.at, windows, () => true);
    const e = { type: "file_open_audit", path: a.path, op: a.op, source: "strace", rank: 2, at: a.at };
    if (id) queue(afterResult, id, e); else tail.push(e);
  }
  // N2 / I8: what the SIGNER host opened or refused, for EVERY /exec, identified by the opened fd (see signer-host.mjs).
  // The --key read and keygen's --out write are the sanctioned key accesses (judged per argument by the labeler) and
  // are not events; every other open is (op open|write), and every refusal with the path it was aimed at (a refused
  // final-component link: where it pointed) as an attempted access (input / key) or write.
  for (const x of signerExecs) {
    const id = attribute(x.at, windows, (w) => w.name === "Bash");
    const emit = (e) => { const ev = { type: "file_open_audit", source: "signer-host", rank: 2, at: x.at, ...e }; if (id) queue(afterResult, id, ev); else tail.push(ev); };
    for (const f of x.opens) if (!f.sanctioned) emit({ path: f.path, op: f.op, ...(f.lexical ? { lexical: true } : {}) });
    for (const r of x.refusals) {
      const path = r.target ?? r.path;
      if (typeof path === "string") emit({ path, op: r.role === "input" || r.role === "key" ? "access" : "write", refused: true });
    }
  }
  for (const d of lateDiffs) tail.push({ ...fileOpOf(d), rank: 1, at: Number.POSITIVE_INFINITY });

  const events = [];
  const idToI = new Map();
  const push = (e) => { const { rank: _r, at: _a, ...clean } = e; events.push({ i: events.length, ...clean }); return events.length - 1; };
  const flushAfter = (id) => {
    for (const e of (afterResult.get(id) ?? []).sort((a, b) => a.rank - b.rank || a.at - b.at)) push(e);
    afterResult.delete(id);
  };
  const resulted = new Set();
  for (const it of items) {
    if (it.kind === "text") { push({ type: "model_text", text: it.text }); continue; }
    if (it.kind === "call") {
      for (const e of beforeCall.get(it.id) ?? []) push(e);
      const h = hooks.get(it.id);
      const rp = combinePairs([h?.post?.pairs, h?.pre?.pairs, postRun.get(it.id)], sensitive);
      const argsText = it.name === "Bash" && typeof it.input?.command === "string" ? it.input.command : JSON.stringify(it.input ?? {});
      idToI.set(it.id, push({
        type: "tool_call", name: it.name, args: it.input, args_text: argsText,
        ...(rp ? { resolved_paths: rp } : {}), ...(denied.has(it.id) ? { denied: true } : {}), ...(it.sidechain ? { sidechain: true } : {}),
      }));
      continue;
    }
    resulted.add(it.id);
    push({
      type: "tool_result", call_i: idToI.get(it.id), name: calls.get(it.id).name, ok: !it.isError, is_error: it.isError,
      text: it.text, ...(it.stdout !== undefined ? { stdout: it.stdout } : {}), ...(it.stderr !== undefined ? { stderr: it.stderr } : {}),
      ...(denied.has(it.id) ? { denied: true } : {}),
    });
    flushAfter(it.id);
  }
  // A call the session never answered (turn / budget cap, crash): an explicit result-less marker, so every call
  // still has exactly one result, followed by whatever it caused.
  for (const [id, c] of calls) {
    if (resulted.has(id)) continue;
    push({ type: "tool_result", call_i: idToI.get(id), name: c.name, ok: false, is_error: true, text: "", no_result: true, ...(denied.has(id) ? { denied: true } : {}) });
    flushAfter(id);
  }
  for (const e of tail.sort((a, b) => a.rank - b.rank || a.at - b.at)) push(e);
  push({ type: "stop", reason: stopReason(result, exit), code: null });
  return { ...base, events };
}
