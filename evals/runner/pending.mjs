// evals/goldens-pending.json: the cases whose golden has not been recorded yet. A listed case with no golden is reported
// as PENDING instead of failing the replay gate and INV-sp6-transcripts-present; everything else about the gate holds:
//   * a case that is NOT listed still fails without a golden (a new case cannot ship without one, or a listing);
//   * a listed case whose golden EXISTS is graded normally by replay, and is a stale entry for validate-skills.mjs
//     (the list only shrinks — the live workflow's regen job removes each id in the same commit as its golden);
//   * the file is CODEOWNERS-reviewed, so adding an entry is a reviewed decision.
// Fail closed: an unreadable or malformed file is an error, never "nothing pending".
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PENDING_FILE = "goldens-pending.json";

/**
 * Structural errors in a parsed goldens-pending.json.
 * @param {unknown} doc
 * @param {Map<string, Set<string>>} caseIdsBySuite  suite dir → its case ids (assertions.json)
 * @returns {string[]}
 */
export function validatePending(doc, caseIdsBySuite) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return ["must be a JSON object"];
  const p = doc.pending;
  if (!p || typeof p !== "object" || Array.isArray(p)) return ['"pending" must be an object of suite → case ids'];
  const errs = [];
  for (const [suite, ids] of Object.entries(p)) {
    const known = caseIdsBySuite.get(suite);
    if (!known) { errs.push(`unknown suite ${JSON.stringify(suite)}`); continue; }
    if (!Array.isArray(ids)) { errs.push(`${suite}: must be an array of case ids`); continue; }
    const seen = new Set();
    for (const id of ids) {
      if (typeof id !== "string" || !known.has(id)) errs.push(`${suite}: unknown case id ${JSON.stringify(id)}`);
      else if (seen.has(id)) errs.push(`${suite}: duplicate case id ${id}`);
      seen.add(id);
    }
  }
  return errs;
}

/**
 * suite dir → Set of pending case ids. An absent file means nothing is pending.
 * Throws on unreadable JSON or a structural error (callers turn it into a HardError / INV failure).
 * @param {string} evalsRoot
 * @param {Map<string, Set<string>>} caseIdsBySuite
 */
export function loadPending(evalsRoot, caseIdsBySuite) {
  const f = join(evalsRoot, PENDING_FILE);
  if (!existsSync(f)) return new Map();
  let doc;
  try { doc = JSON.parse(readFileSync(f, "utf8")); } catch (e) { throw new Error(`${PENDING_FILE} is not valid JSON (${e.message})`); }
  const errs = validatePending(doc, caseIdsBySuite);
  if (errs.length) throw new Error(`${PENDING_FILE}: ${errs.join("; ")}`);
  return new Map(Object.entries(doc.pending).map(([s, ids]) => [s, new Set(ids)]));
}
