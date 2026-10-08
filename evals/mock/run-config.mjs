// Per-run setup for a live SP6 eval: turn a scenario (scenarios/<case_id>.mjs) into a run config with fresh
// FAKE-SP6-CANARY- canaries and a fresh identity, seed the hermetic HOME, and install the mock signer.
// The live adapter (Task 15) owns the workspace; this module only writes inside the paths it is given.
import { appendFileSync, chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { newCanary, publicFromPrivate, storedKeyFile } from "./lib/keymodel.mjs";

/**
 * @typedef {object} Scenario  One live-eval case's world (evals/mock/scenarios/<case_id>.mjs).
 * @property {string} case_id
 * @property {string} suite
 * @property {string} situation  What the case's `given` needs, in words.
 * @property {{presence: "path"|"absent", profile?: "0.3.1"|"0.2.0", answers?: boolean, npx?: "unavailable",
 *   force_errors?: {command: string, code: string, times?: number}[], voucher_output_override?: object}} signer
 * @property {{key?: {borrower: "self"|"other", terminal: "self"|"other", tamper?: boolean}, key_dir_mode?: number}} seed
 * @property {{state: "fresh-host"|"terminal-registered"|"onboarded", register_fail_times?: number,
 *   injection?: {tool: string, field?: string, text: string}, first_time_merchant?: boolean}} backend
 * @property {string[]} conditions  Input conditions this scenario emits to the journal on the honest path.
 * @property {{signer_error: string|null, stderr_match?: string}} expect  The signer code the honest path meets
 *   (null = none), and for a signer that never starts, a regex its stderr matches.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
export const SIGNER_SHIM = join(HERE, "sohopay-signer");
export const KEY_REL = join(".agents", "sohopay-agent-workload", "secret.json");
/** The canonical key path as the skills spell it (sensitive_paths.key_path). */
export const KEY_PATH_SPELLING = "~/.agents/sohopay-agent-workload/secret.json";

const hex = (n) => randomBytes(n).toString("hex");

/** A fresh identity per run, so nothing in a transcript is a fixed, memorisable value. */
export function newIdentity() {
  return {
    borrower_id: randomUUID(),
    operational_agent_id: `oa_${hex(8)}`,
    terminal_id: `term_${hex(8)}`,
    handle: `sp6agent${hex(2)}`,
    merchant_id: `0x${hex(32)}`,
    merchant_uuid: randomUUID(),
    pay_to: `0x${hex(20)}`,
  };
}

/**
 * Build the run config for `scenario` under `runDir` (outside the agent workspace) with HOME = `home`.
 * Returns the config object; prepareRun() also writes it to disk.
 */
export function buildRun(scenario, { runDir, home }) {
  const canaries = { private_key: newCanary("PRIV"), header_value: newCanary("HDR") };
  return {
    case_id: scenario.case_id,
    suite: scenario.suite,
    home,
    journal: join(runDir, "journal.jsonl"),
    state_file: join(runDir, "signer-state.json"),
    canaries,
    identity: newIdentity(),
    signer: { answers: true, profile: "0.3.1", force_errors: [], voucher_output_override: null, ...scenario.signer },
    seed: scenario.seed ?? {},
    backend: { state: "fresh-host", register_fail_times: 0, injection: null, first_time_merchant: false, ...scenario.backend },
    // What the transcript's secrets / sensitive_paths blocks must carry for this run (floor + secret_read).
    transcript: { secrets: canaries, sensitive_paths: { key_path: KEY_PATH_SPELLING } },
  };
}

/** Seed the hermetic HOME: an existing key (own / other borrower or terminal, optionally tampered), dir modes. */
export function seedHome(run) {
  const { seed, home, identity, canaries } = run;
  const keyFile = join(home, KEY_REL);
  if (seed.key_dir_mode !== undefined) {
    mkdirSync(dirname(keyFile), { recursive: true });
    chmodSync(join(home, ".agents"), 0o700);
    chmodSync(dirname(keyFile), seed.key_dir_mode);
  }
  if (seed.key) {
    mkdirSync(dirname(keyFile), { recursive: true, mode: 0o700 });
    chmodSync(join(home, ".agents"), 0o700);
    chmodSync(dirname(keyFile), 0o700);
    const borrower = seed.key.borrower === "other" ? randomUUID() : identity.borrower_id;
    const terminal = seed.key.terminal === "other" ? `term_${hex(8)}` : identity.terminal_id;
    let body = storedKeyFile(canaries.private_key, borrower, terminal);
    if (seed.key.tamper) {
      // Stored public material no longer derives from the private key → KEY_INTEGRITY_FAILED on verify.
      const stored = JSON.parse(body);
      body = `${JSON.stringify({ ...stored, jkt: publicFromPrivate(`${canaries.private_key}-other`).jkt }, null, 2)}\n`;
    }
    writeFileSync(keyFile, body, { mode: 0o600 });
    chmodSync(keyFile, 0o600);
  }
}

/**
 * Install the signer per `run.signer.presence`: "path" / "path-unanswering" → a `sohopay-signer` wrapper in binDir
 * (the run config path is baked into the wrapper, so the agent's environment carries nothing mock-specific);
 * "absent" → none. With `run.signer.npx === "unavailable"`, an `npx` that fails like an offline `npx --no`.
 */
export function installSigner(run, { binDir, runPath }) {
  mkdirSync(binDir, { recursive: true });
  const presence = run.signer.presence ?? "path";
  if (presence !== "absent") {
    const wrapper = join(binDir, "sohopay-signer");
    writeFileSync(wrapper, `#!/bin/sh\nSP6_MOCK_RUN=${shq(runPath)} exec ${shq(process.execPath)} ${shq(SIGNER_SHIM)} "$@"\n`, { mode: 0o755 });
  }
  if (run.signer.npx === "unavailable") {
    const npx = join(binDir, "npx");
    writeFileSync(npx, `#!/bin/sh\necho "npm error npx canceled due to missing packages and no YES option: [\\"$2\\"]" >&2\nexit 1\n`, { mode: 0o755 });
  }
}
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Every `name` executable on a PATH string (the adapter must find none besides the mock's). */
export function findOnPath(name, pathValue) {
  return pathValue.split(delimiter).filter(Boolean).map((d) => resolve(d, name)).filter((p) => existsSync(p));
}

/**
 * One call for the live adapter: build + persist the run config, seed HOME, install the signer.
 * Returns { run, runPath, binDir }; prepend binDir to the agent's PATH.
 */
export function prepareRun(scenario, { runDir, home, binDir = join(runDir, "bin") }) {
  mkdirSync(runDir, { recursive: true });
  mkdirSync(home, { recursive: true });
  const run = buildRun(scenario, { runDir, home });
  const runPath = join(runDir, "run.json");
  writeFileSync(runPath, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
  appendFileSync(run.journal, "");
  seedHome(run);
  installSigner(run, { binDir, runPath });
  return { run, runPath, binDir };
}
