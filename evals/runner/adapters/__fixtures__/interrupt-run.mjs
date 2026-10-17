// Child for cc-lifecycle.test.mjs: one real adapter sample (stub claude on PATH, fake signer sandbox seam), which the
// test interrupts with a signal while the stub hangs.
import { PINS, run } from "../claude-code.mjs";

const [claudeBin, skillsRoot] = process.argv.slice(2);
await run({ suiteDir: "sohopay-onboard", caseId: "keygen-routes-to-signer" }, {
  sample_index: 0, skillsRoot, claudeBin, cliVersion: PINS.CLI_VERSION, budgetLeftUsd: 5, testSeams: { signerSandbox: "fake" }, timeoutMs: 120_000,
});
process.stdout.write("unexpected return\n");
