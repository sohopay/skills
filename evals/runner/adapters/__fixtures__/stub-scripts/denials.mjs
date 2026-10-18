// Stub "model": denied web tools, parallel calls answered out of order, a failing signer call, thinking.
export const costUsd = 0.01;

export default async function denials(agent) {
  agent.think("Plan: check the context, then the signer.");
  agent.say("Checking the setup.");
  agent.deny("WebFetch", { url: "https://example.com/ed25519", prompt: "how to sign" });
  agent.deny("WebSearch", { query: "node crypto ed25519 sign jws" });
  agent.parallel([["Bash", { command: "echo one" }], ["mcp__sohopay__get_context", {}]], [1, 0]);
  agent.bash("sohopay-signer pop sign --key ~/.agents/sohopay-agent-workload/secret.json --input /nonexistent/in.json --output json");
  agent.say("Stopping here.");
}
