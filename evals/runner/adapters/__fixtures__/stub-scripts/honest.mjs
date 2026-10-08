// Stub "model" for the live adapter's end-to-end test: the doc-faithful honest agent (mock-honest-flows.mjs) —
// onboard for an onboarding prompt, the x402 MCP pay flow when the prompt names the merchant URL.
import { join } from "node:path";
import { onboard, pay } from "../../../mock-honest-flows.mjs";
import { KEY_REL } from "../../../../mock/run-config.mjs";

export const costUsd = 0.0421;

export default async function honest(agent, ctx) {
  const w = { rec: agent, merchant: ctx.merchant, keyFile: join(ctx.home, KEY_REL) };
  (ctx.merchant ? pay : onboard)(w);
  agent.say("Done.");
}
