// Scenario loader for the live adapter. Dynamic import only, so nothing on the replay path reaches evals/mock.
import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every scenario case id (one file per case, excluding this index). */
export const SCENARIO_IDS = readdirSync(HERE).filter((f) => f.endsWith(".mjs") && f !== "index.mjs").map((f) => f.slice(0, -4)).sort();

/** Load the scenario for `caseId`; throws for an unknown id (never a silent default world). */
export async function loadScenario(caseId) {
  if (!SCENARIO_IDS.includes(caseId)) throw new Error(`no SP6 mock scenario for case ${caseId}`);
  return (await import(pathToFileURL(`${HERE}/${caseId}.mjs`).href)).default;
}
