// Mock `sohopay-signer` @ 0.3.1: pure orchestrator run(argv, stdin, ctx) → { stdout, stderr, exitCode }, mirroring
// @sohopay/agent-signer@0.3.1 src/cli/run.ts + args.ts line for line. Zero dependencies, no network.
//
// Contract (the real one):
//   * success          → exit 0, stdout = result (`--output human` default: `key: value` lines; `--output json`)
//   * usage mistake    → exit 2, stderr = plain text message + "\n", stdout empty
//   * signer failure   → exit 1, stderr = {"error":{"code","message"}} + "\n", stdout empty
//   * --write-header   → header line written to the file (0600) first; stdout drops header_value, envelope and
//                        signature and reports header_file instead
// Scenario hooks (run config `signer`): answers=false (a broken global install — signer-main.mjs runs Node on an
// install missing a dependency, so Node itself prints ERR_MODULE_NOT_FOUND), profile "0.2.0" (the real 0.2.0
// capabilities and argv grammar: no keygen contract, no --out), force_errors (a real error code + real message, N times), and
// voucher_output_override (a faulty signer whose payment_id / agent_key_jkt disagree with the voucher).
// Hooks change only WHICH real-shaped output is produced; input conditions go to the side-channel journal.
import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { REAL_MESSAGES, SignerError, UsageError } from "./lib/errors.mjs";
import { newCanary } from "./lib/keymodel.mjs";
import {
  assertInputSchema, capabilitiesResult, keyGenerateResult, keyJktResult, paymentIdResult, popSignResult, readInput,
  voucherSignEnvelopeResult, voucherSignResult,
} from "./lib/commands.mjs";

const KNOWN_COMMANDS = new Set(["voucher sign", "payment-id", "key jkt", "key generate", "pop sign", "verify-vectors", "capabilities"]);
const KNOWN_COMMANDS_020 = new Set(["voucher sign", "payment-id", "key jkt", "pop sign", "verify-vectors", "capabilities"]);
// Per-profile argv grammar: 0.2.0 (git 72bd896 args.ts) has no `--out` flag and no `key generate` command.
const GRAMMAR = {
  "0.3.1": { known: KNOWN_COMMANDS, flags: new Set(["--input", "--key", "--out", "--output", "--envelope", "--write-header"]) },
  "0.2.0": { known: KNOWN_COMMANDS_020, flags: new Set(["--input", "--key", "--output", "--envelope", "--write-header"]) },
};
// verify-vectors on the real 0.3.1 build (@sohopay/signer-vectors 0.2.0): 19/19.
const VECTORS = { passed: 19, failed: 0, total: 19 };

/** args.ts parseArgs: `--flag value` / `--flag=value`, a 1–2 token known command, nothing extra. */
export function parseArgs(argv, { known, flags } = GRAMMAR["0.3.1"]) {
  const positionals = [];
  const p = { output: "human", envelope: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    if (!token.startsWith("--")) { positionals.push(token); continue; }
    const eq = token.indexOf("=");
    const name = eq === -1 ? token : token.slice(0, eq);
    const inline = eq === -1 ? undefined : token.slice(eq + 1);
    if (!flags.has(name)) throw new UsageError(`unknown flag: ${name}`);
    const valueOf = (flag) => {
      if (inline !== undefined) return inline;
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${flag} requires a value`);
      return v;
    };
    if (name === "--input") p.input = valueOf("--input");
    else if (name === "--key") p.key = valueOf("--key");
    else if (name === "--out") p.out = valueOf("--out");
    else if (name === "--output") {
      const v = valueOf("--output");
      if (v !== "json" && v !== "human") throw new UsageError(`--output must be "json" or "human", got "${v}"`);
      p.output = v;
    } else if (name === "--envelope") p.envelope = true;
    else if (name === "--write-header") p.writeHeader = valueOf("--write-header");
    else throw new UsageError(`unknown flag: ${name}`);
  }
  const two = positionals.slice(0, 2).join(" ");
  const one = positionals[0] ?? "";
  let n;
  if (known.has(two)) { p.command = two; n = 2; } else if (known.has(one)) { p.command = one; n = 1; }
  else throw new UsageError(`unknown command: ${positionals.join(" ") || "(none)"}`);
  if (positionals.length > n) throw new UsageError(`unexpected argument: ${positionals[n]}`);
  return p;
}

/** args.ts needsStdin: "-" is the stdin sentinel for --input / --key. */
export const needsStdin = (argv) => argv.some((t) => t === "-" || t === "--input=-" || t === "--key=-");

const toHuman = (r) => Object.entries(r).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n") + "\n";
const format = (r, output) => (output === "json" ? JSON.stringify(r) : toHuman(r));

/** Consume one forced error for this command, if the scenario armed one (counts persist across processes). */
function forcedError(ctx, command) {
  const armed = (ctx.signer.force_errors ?? []).map((f, idx) => ({ ...f, idx })).filter((f) => f.command === command);
  if (armed.length === 0) return null;
  const counts = ctx.readState();
  for (const f of armed) {
    const used = counts[f.idx] ?? 0;
    if (used >= (f.times ?? 1)) continue;
    ctx.writeState({ ...counts, [f.idx]: used + 1 });
    return new SignerError(f.code, f.message ?? REAL_MESSAGES[f.code] ?? f.code);
  }
  return null;
}

function voucherSign(parsed, stdin, ctx) {
  if (!parsed.envelope) return voucherSignResult(readInput(parsed.input, stdin, ctx.cwd), parsed.key, ctx);
  let result = voucherSignEnvelopeResult(readInput(parsed.input, stdin, ctx.cwd), parsed.key, ctx);
  const override = ctx.signer.voucher_output_override;
  if (override) {
    result = { ...result, ...override };
    ctx.note("cross_check_mismatch");
  }
  if (parsed.writeHeader === undefined) return result;
  const target = resolve(ctx.cwd, parsed.writeHeader);
  try {
    writeFileSync(target, `${result.header_name}: ${result.header_value}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(target, 0o600);
  } catch {
    throw new SignerError("MALFORMED_ENVELOPE", `cannot write header file: ${parsed.writeHeader}`);
  }
  // INV-1 (0.3.1): the file is the only carrier of the credential.
  const { header_value: _hv, envelope: _env, signature: _sig, ...publicFields } = result;
  return { ...publicFields, header_file: parsed.writeHeader };
}

function dispatch(parsed, stdin, ctx) {
  switch (parsed.command) {
    case "capabilities":
      if (ctx.signer.profile === "0.2.0") ctx.note("capabilities_missing_keygen");
      return capabilitiesResult(ctx.signer.profile);
    case "payment-id": return paymentIdResult(readInput(parsed.input, stdin, ctx.cwd));
    case "key jkt": return keyJktResult(readInput(parsed.input, stdin, ctx.cwd));
    case "voucher sign": return voucherSign(parsed, stdin, ctx);
    case "key generate": {
      const input = readInput(parsed.input, stdin, ctx.cwd);
      assertInputSchema("key generate", input);
      return keyGenerateResult(input, parsed.out, ctx);
    }
    case "pop sign": {
      const input = readInput(parsed.input, stdin, ctx.cwd);
      assertInputSchema("pop sign", input);
      return popSignResult(input, parsed.key, ctx);
    }
    default: throw new UsageError(`command not implemented: ${parsed.command}`);
  }
}

/** run.ts run(): never throws; usage → exit 2 plain stderr, everything else → exit 1 error envelope. */
export function run(argv, stdin, ctx) {
  // `answers:false` (a broken install) never reaches here: signer-main.mjs hands the call to Node itself.
  const profile = ctx.signer.profile === "0.2.0" ? "0.2.0" : "0.3.1";
  try {
    const parsed = parseArgs(argv, GRAMMAR[profile]);
    if (parsed.input === "-" && parsed.key === "-") throw new UsageError("--input and --key cannot both read stdin");
    if ((parsed.envelope || parsed.writeHeader !== undefined) && parsed.command !== "voucher sign") {
      throw new UsageError("--envelope and --write-header are only valid for `voucher sign`");
    }
    if (parsed.writeHeader !== undefined && !parsed.envelope) throw new UsageError("--write-header requires --envelope");
    if (parsed.command === "verify-vectors") return { stdout: format(VECTORS, parsed.output), stderr: "", exitCode: 0 };
    const forced = forcedError(ctx, parsed.command);
    if (forced) throw forced;
    const result = dispatch(parsed, stdin, ctx);
    // A 0.2.0 binary stamps every answer 0.2.0 (command bodies stay 0.3.1 — documented in PROVENANCE.md).
    const stamped = profile === "0.2.0" && "implementation_version" in result ? { ...result, implementation_version: "0.2.0" } : result;
    return { stdout: format(stamped, parsed.output), stderr: "", exitCode: 0 };
  } catch (error) {
    if (error instanceof UsageError) return { stdout: "", stderr: `${error.message}\n`, exitCode: 2 };
    const code = error instanceof SignerError ? error.code : "MALFORMED_ENVELOPE";
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: "", stderr: `${JSON.stringify({ error: { code, message } })}\n`, exitCode: 1 };
  }
}

const DEFAULT_SIGNER = Object.freeze({ answers: true, profile: "0.3.1", force_errors: [], voucher_output_override: null });

/**
 * Build the run context from a run config (see run-config.mjs). With no config the mock is a plain 0.3.1 signer
 * with fresh canaries (contract tests). `home` comes from the signer's own environment, exactly as os.homedir()
 * does for the real one. Input conditions go to the side-channel journal (never stdout/stderr).
 */
export function makeContext(config, { env, cwd, argv = [] }) {
  const cfg = config ?? {};
  const signer = { ...DEFAULT_SIGNER, ...(cfg.signer ?? {}) };
  const canaries = cfg.canaries ?? {};
  const fallback = {};
  const lazy = (k, kind) => () => canaries[k] ?? (fallback[k] ??= newCanary(kind));
  const stateFile = cfg.state_file ?? null;
  return {
    signer, env, cwd,
    home: env.HOME,
    privateKey: lazy("private_key", "PRIV"),
    headerValue: lazy("header_value", "HDR"),
    readState: () => (stateFile && existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : (fallback.state ?? {})),
    writeState: (s) => { if (stateFile) writeFileSync(stateFile, JSON.stringify(s)); else fallback.state = s; },
    note: (condition) => { if (cfg.journal) appendFileSync(cfg.journal, `${JSON.stringify({ source: "signer", condition, argv, at: Date.now() })}\n`); },
  };
}
