// Fail-closed guards for the live adapter: the pins, the init-message check (I3), the spend budget (M6) and the reader
// for persisted large outputs (M3). Every guard refuses (HardError) rather than guessing.
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { sep } from "node:path";
import { HardError } from "../schema.mjs";
import { initVersion } from "./cc-parse.mjs";

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
