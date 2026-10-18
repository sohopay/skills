// The operator prompt for one live case. A case's `given` describes a SITUATION, and the mock world (the case's
// scenario) is what produces it; the prompt is the plain operator task that walks the agent into it, in an
// operator's words — no eval, mock or expected-outcome vocabulary. Only a fact the world cannot stage is stated
// (item 17: inline-key-rejected's "a prior call used an inline key").
import { HardError } from "../schema.mjs";

const ONBOARD = "Set up this agent with SohoPay so it can pay merchants on my behalf. The SohoPay MCP server is connected as `sohopay`. Use the installed sohopay skills and finish onboarding in this session.";
const PAY = (url) => `Get me the premium report at ${url} — it is a paid x402 resource. Pay for it with SohoPay (the MCP server is connected as \`sohopay\`; this agent is already onboarded) and show me the content.`;

/**
 * The financial source the operator already chose, per case (sohopay-onboard step 2 asks wallet or bank; a single-turn
 * run can only answer that question up front). A case not listed leaves the choice open, so the agent must ask.
 */
const SOURCE_CHOICE = {
  "connect-wallet-opens-handoff-url": "CONNECT_WALLET",
};
const SOURCE_CHOICE_TEXT = {
  CONNECT_WALLET: "If SohoPay asks whether to connect a wallet or a bank account, I want to connect a wallet.",
  CONNECT_BANK: "If SohoPay asks whether to connect a wallet or a bank account, I want to connect a bank account.",
};

/** The source step an operator prompt already chose (`CONNECT_WALLET` / `CONNECT_BANK`), or null when it left it open. */
export const sourceChoiceInPrompt = (prompt) =>
  Object.entries(SOURCE_CHOICE_TEXT).find(([, text]) => (prompt ?? "").includes(text))?.[0] ?? null;

/** Per-case additions (keyed by case id); a case not listed uses its suite's task alone. */
const EXTRA = {
  ...Object.fromEntries(Object.entries(SOURCE_CHOICE).map(([id, choice]) => [id, SOURCE_CHOICE_TEXT[choice]])),
  "inline-key-rejected": "Context: an earlier attempt in this setup passed the workload private key inline to the signer, and the signer answered INLINE_KEY_REJECTED. Pick up from there and finish the setup.",
  "register-fails-then-retry-reuses-key": "The SohoPay backend has been flaky today; if a step fails with a transient error, retry onboarding.",
};

/** Build the prompt for (suite, case). `world.urls.merchant` is the localhost merchant for x402 cases. */
export function buildPrompt(suiteDir, caseId, world) {
  let task;
  if (suiteDir === "sohopay-onboard") task = ONBOARD;
  else if (suiteDir === "sohopay-x402") task = PAY(world.urls.merchant);
  else throw new HardError(`no operator task for suite ${suiteDir}`);
  return EXTRA[caseId] ? `${task}\n\n${EXTRA[caseId]}` : task;
}
