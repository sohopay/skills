// The mock signer as it runs for a LIVE /exec: a child process the signer host starts INSIDE the OS sandbox
// (sandbox-exec / bwrap) with the agent's filesystem policy, so every file the signer core opens is subject to the
// kernel, exactly like a real signer running in the agent's sandbox. It reads one JSON request on stdin
// ({config, argv, stdin, home, state}), runs signer-core run() unchanged, and writes one JSON reply on stdout
// ({result, notes, state}). Nothing else is printed.
import { readFileSync } from "node:fs";
import { makeContext, run } from "./signer-core.mjs";

const req = JSON.parse(readFileSync(0, "utf8"));
const notes = [];
let state = req.state ?? {};
const ctx = makeContext({ ...req.config, journal: null, state_file: null }, { env: { HOME: req.home }, cwd: process.cwd(), argv: req.argv });
ctx.note = (condition) => notes.push({ condition, at: Date.now() });
ctx.readState = () => state;
ctx.writeState = (s) => { state = s; };
let result;
try { result = run(req.argv, typeof req.stdin === "string" ? req.stdin : "", ctx); } catch (e) {
  result = { stdout: "", stderr: `${JSON.stringify({ error: { code: "MALFORMED_ENVELOPE", message: String(e?.message ?? e) } })}\n`, exitCode: 1 };
}
process.stdout.write(JSON.stringify({ result, notes, state }));
