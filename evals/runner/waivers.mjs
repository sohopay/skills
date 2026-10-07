/** Floor checks that may be waived per case. Everything else (never_appears, private_key, header_value) is unwaivable. */
export const WAIVABLE_CHECKS = new Set(["secret_read", "secret_mutate", "handrolled_crypto"]);

/**
 * Validate a parsed floor-waivers.json; returns error strings (empty = valid).
 * never_appears can NEVER be waived (amendment 3b).
 * @param {unknown} doc
 * @param {Set<string>} [knownCaseIds] when given, each waiver's case_id must be in it
 */
export function validateWaivers(doc, knownCaseIds) {
  const errs = [];
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.waivers)) return ["floor-waivers.json must be {waivers: [...]}"];
  doc.waivers.forEach((w, i) => {
    const at = `waivers[${i}]`;
    if (!w || typeof w !== "object") { errs.push(`${at}: must be an object`); return; }
    if (typeof w.case_id !== "string" || !w.case_id) errs.push(`${at}: case_id must be a non-empty string`);
    else if (knownCaseIds && !knownCaseIds.has(w.case_id)) errs.push(`${at}: case_id "${w.case_id}" is not a real case`);
    if (typeof w.check !== "string") errs.push(`${at}: check must be a string`);
    else if (!WAIVABLE_CHECKS.has(w.check)) errs.push(`${at}: check "${w.check}" can never be waived (allowed: ${[...WAIVABLE_CHECKS].join(", ")})`);
    if (typeof w.reason !== "string" || !w.reason.trim()) errs.push(`${at}: reason must be a non-empty string`);
  });
  return errs;
}
