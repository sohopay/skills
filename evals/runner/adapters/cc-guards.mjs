// Fail-closed guards for the live adapter: the pins, the init-message check (I3), the spend budget (M6) and the reader
// for persisted large outputs (M3). Every guard refuses (HardError) rather than guessing.
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { sep } from "node:path";
import { HardError } from "../schema.mjs";
import { initVersion } from "./cc-parse.mjs";
import { labeledForms } from "../predicates.mjs";

/** Everything a live run is pinned to. A CLI or capture-format bump must change these (and re-record goldens). */
export const PINS = Object.freeze({
  CLI_VERSION: "2.1.292",
  MODEL_ID: "claude-sonnet-5-5",
  MAX_TURNS: 20,
  DEFAULT_SAMPLES: 5,
  BUDGET_USD: 10, // provisional (spec): recalibrate from a measured pilot
  ADAPTER_VERSION: "claude-code/1",
  RUN_TIMEOUT_MS: 20 * 60 * 1000,
  KILL_GRACE_MS: 5000,
});
export const MCP_SERVER = "sohopay";
/** Tools the agent must never be offered (web egress, sub-agents whose sessions are not captured, deferred-tool search). */
export const DENIED_TOOLS = Object.freeze(["WebFetch", "WebSearch", "Agent", "Task", "ToolSearch"]);

/**
 * I3: the stream-json init message must exist and show EXACTLY the pinned CLI and model, dontAsk, none of the denied
 * tools, no MCP tool but the mock's, and exactly one MCP server — `sohopay`, connected. A claude.ai connector, a
 * managed-settings server or any other server would be a non-mock egress path, so it refuses the sample.
 */
export function checkInit(init) {
  const no = (m) => { throw new HardError(`claude-code adapter: init: ${m}`); };
  if (!init || typeof init !== "object") no("no system/init message (cannot confirm the pinned CLI, model, tools and MCP servers)");
  const v = initVersion(init);
  if (v !== PINS.CLI_VERSION) no(`CLI version ${v ?? "missing"} != pinned ${PINS.CLI_VERSION}`);
  if (init.model !== PINS.MODEL_ID) no(`model ${init.model ?? "missing"} != pinned ${PINS.MODEL_ID}`);
  if (init.permissionMode !== "dontAsk") no(`permission mode ${init.permissionMode ?? "missing"} != dontAsk`);
  if (!Array.isArray(init.tools)) no("tools list missing");
  const offered = init.tools.filter((t) => DENIED_TOOLS.includes(t));
  if (offered.length) no(`denied tool(s) still offered: ${offered.join(", ")}`);
  const foreign = init.tools.filter((t) => /^mcp__/.test(t) && !t.startsWith(`mcp__${MCP_SERVER}__`));
  if (foreign.length) no(`non-mock MCP tool(s) offered: ${foreign.join(", ")}`);
  const servers = init.mcp_servers;
  if (!Array.isArray(servers) || servers.length !== 1 || servers[0]?.name !== MCP_SERVER || servers[0]?.status !== "connected") {
    no(`MCP servers must be exactly [${MCP_SERVER}: connected], got ${JSON.stringify(servers ?? null)}`);
  }
}

/** Cumulative spend cap across one runSuites invocation, kept at full precision (M6). */
export function makeBudget(capUsd) {
  if (!(typeof capUsd === "number" && Number.isFinite(capUsd) && capUsd > 0)) throw new HardError(`claude-code adapter: invalid budget cap ${capUsd} (must be a positive number)`);
  let spent = 0;
  let unknown = false;
  return {
    get spent() { return spent; },
    get left() { return capUsd - spent; },
    exhausted() { return unknown || capUsd - spent <= 0; },
    add(cost) { if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) spent += cost; else unknown = true; },
    reason() { return unknown ? "a run reported no per-session cost, so spend cannot be accounted" : `budget cap $${capUsd} reached ($${spent} spent)`; },
  };
}

/** Env names that hold credentials (the harness's own: API key, OAuth, GitHub / Actions / npm tokens, cloud keys…). */
const CREDENTIAL_NAME = /(?:^|_)(?:API_KEY|KEY|TOKEN|SECRET|PASSWORD|PASS|PAT|CREDENTIALS?)$/i;
const CANARY = "FAKE-SP6-CANARY-";

/**
 * T17 C1 (defence in depth): the harness's real secrets — every credential-named env value of at least 16 chars that is
 * not a path, has no whitespace and is not a planted canary. They must never leave in a transcript.
 */
export function harnessSecrets(env = process.env) {
  return Object.entries(env)
    .filter(([k, v]) => typeof v === "string" && CREDENTIAL_NAME.test(k) && v.length >= 16 && !v.startsWith("/") && !/\s/.test(v) && !v.startsWith(CANARY))
    .map(([name, value]) => ({ name, value }));
}

/** Every string in a JSON-shaped value (object keys included). */
function strings(v, out = []) {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.push(k); strings(x, out); }
  return out;
}

/**
 * Is any harness secret anywhere in the transcript (every field, `secrets` included), in any encoding the never_appears
 * floor uses? Returns {name, form} — never the value — or null.
 */
export function harnessLeak(t, secrets) {
  if (!secrets.length) return null;
  const hay = strings(t);
  for (const { name, value } of secrets) {
    const hit = labeledForms(value).find(([, f]) => hay.some((s) => s.includes(f)));
    if (hit) return { name, form: hit[0] };
  }
  return null;
}

/**
 * Cut every harness secret out of a message (adapter errors may quote CLI stderr), in every encoding the never_appears
 * floor uses — raw, base64 / base64url ± padding, hex either case, base64 embedded at offsets 0–2 and 16-char windows.
 * Longest forms go first, so a whole value is replaced before its windows.
 */
export function redactSecrets(s, secrets) {
  let out = String(s);
  for (const { name, value } of secrets) {
    const forms = labeledForms(value).map(([, f]) => f).sort((a, b) => b.length - a.length);
    for (const f of forms) out = out.split(f).join(`[REDACTED:${name}]`);
  }
  return out;
}

/**
 * M3 / N5: read a persisted tool output at capture time. Only a regular file (lstat: no symlink) at
 * HOME/.claude/projects/<slug>/tool-results/<name> — where Claude Code saves them — whose realpath stays there, and
 * which is at least the size the CLI recorded, is accepted; anything else is an adapter error.
 */
export function persistedReader(home) {
  const root = realpathSync(home);
  const SHAPE = /^\.claude\/projects\/[^/]+\/tool-results\/[^/]+$/;
  return (path, expectedSize) => {
    let st;
    try { st = lstatSync(path); } catch { throw new HardError(`persisted output ${path} is missing`); }
    if (st.isSymbolicLink() || !st.isFile()) throw new HardError(`persisted output ${path} is a symlink or not a regular file`);
    const real = realpathSync(path);
    if (!real.startsWith(root + sep) || !SHAPE.test(real.slice(root.length + 1))) throw new HardError(`persisted output ${path} is not under HOME/.claude/projects/<slug>/tool-results/`);
    const body = readFileSync(real);
    if (Number.isFinite(expectedSize) && body.length < expectedSize) throw new HardError(`persisted output ${path} is shorter (${body.length} B) than the CLI recorded (${expectedSize} B)`);
    return body.toString("utf8");
  };
}
