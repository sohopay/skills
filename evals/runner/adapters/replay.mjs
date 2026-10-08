import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateTranscript, HardError, ADAPTER_VERSIONS } from "../schema.mjs";
import { transcriptKindError } from "../golden.mjs";

/**
 * Deterministic replay host adapter: loads a recorded transcript, validates it, refuses a kind/adapter mismatch
 * (golden ⇒ claude-code, adversarial ⇒ synthetic) and (goldens) refuses it if the skill changed since recording.
 * Does no path resolution; labeling uses the recorded resolved_paths/fs_map.
 * @param {{suite:string, caseId:string, kind:"golden"|"adversarial", name:string}} ref
 * @param {{rootDir:string, skillHashFor:(suite:string)=>string}} opts
 */
export function run(ref, opts) {
  const { suite, caseId, kind, name } = ref;
  const file =
    kind === "adversarial"
      ? join(opts.rootDir, suite, "transcripts", "adversarial", `${name}.json`)
      : join(opts.rootDir, suite, "transcripts", `${caseId}.json`);
  let t;
  try {
    t = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new HardError(`replay: cannot load transcript ${file}: ${e.message}`);
  }
  const v = validateTranscript(t);
  if (!v.ok) throw new HardError(`replay: invalid transcript ${file}: ${v.errors.join("; ")}`);
  if (!ADAPTER_VERSIONS.has(t.meta.adapter_version))
    throw new HardError(`replay: unknown adapter_version ${t.meta.adapter_version} in ${file}`);
  const kindErr = transcriptKindError(t, kind === "adversarial" ? "adversarial" : "golden");
  if (kindErr) throw new HardError(`replay: ${file}: ${kindErr}`);
  // Goldens are pinned to the skill text they were recorded against; a mismatch means re-record.
  // Synthetic grader_hash is informational only (not gated).
  if (kind !== "adversarial") {
    const current = opts.skillHashFor(suite);
    if (current !== t.meta.skill_hash)
      throw new HardError(`replay: stale golden ${file}: skill_hash ${t.meta.skill_hash} != current ${current}`);
  }
  return t;
}
