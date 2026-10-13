// Live run 38322219705: all 95 samples were "the CLI exited with a non-zero status (code 1) (exit 1; )" — the CLI wrote
// nothing to stderr, so the adapter error carried no reason. cliFailureDetail falls back to what the CLI itself printed
// on stdout: non-JSON lines (its own error text) and an is_error final result, never the agent's assistant messages.
import test from "node:test";
import assert from "node:assert/strict";
import { cliFailureDetail } from "./claude-code.mjs";

const line = (o) => JSON.stringify(o);

test("stderr wins when the CLI wrote one", () => {
  assert.equal(cliFailureDetail({ stderr: "  Error: sandbox missing socat \n", stream: "Error: other\n" }), "Error: sandbox missing socat");
});

test("empty stderr: the CLI's own non-JSON stdout lines are the reason", () => {
  const stream = `${line({ type: "system", subtype: "init" })}\nError: Invalid API key · Please run /login\n`;
  assert.equal(cliFailureDetail({ stderr: "", stream }), "stdout: Error: Invalid API key · Please run /login");
});

test("empty stderr: an is_error final result is reported with its subtype and text", () => {
  const stream = [line({ type: "system", subtype: "init" }), line({ type: "result", subtype: "error_during_execution", is_error: true, result: "apiKeyHelper failed" })].join("\n");
  assert.equal(cliFailureDetail({ stderr: "", stream }), "result error_during_execution: apiKeyHelper failed");
});

test("the agent's own messages are never quoted, nor a non-error result", () => {
  const stream = [
    line({ type: "assistant", message: { content: [{ type: "text", text: "the private key is FAKE-SP6-CANARY-PRIV-1" }] } }),
    line({ type: "result", subtype: "success", is_error: false, result: "done: FAKE-SP6-CANARY-PRIV-1" }),
  ].join("\n");
  const d = cliFailureDetail({ stderr: "", stream });
  assert.ok(!/FAKE-SP6-CANARY/.test(d), d);
  assert.equal(d, "no stderr; no CLI error on stdout");
});

test("nothing at all is said explicitly, and the detail is bounded", () => {
  assert.equal(cliFailureDetail({ stderr: "", stream: "" }), "no stderr; no CLI error on stdout");
  assert.ok(cliFailureDetail({ stderr: "x".repeat(5_000), stream: "" }).length <= 600);
  assert.ok(cliFailureDetail({ stderr: "", stream: `${"y".repeat(5_000)}\n` }).length <= 600);
});
