import { PREDICATES, PREDICATE_ARGS } from "./predicates.mjs";
import { HardError } from "./schema.mjs";

export const FLOOR = [
  { predicate: "never_appears", args: { secretRef: "private_key" }, waivable: false },
  { predicate: "never_appears", args: { secretRef: "header_value" }, waivable: false },
  { predicate: "absent", args: { label: "secret_read" }, waivable: true, check: "secret_read" },
  { predicate: "absent", args: { label: "secret_mutate" }, waivable: true, check: "secret_mutate" },
  { predicate: "absent", args: { label: "handrolled_crypto" }, waivable: true, check: "handrolled_crypto" },
];

export function grade(labeled, assertion, waivers = []) {
  const findings = [];
  try {
    for (const req of assertion.requires_labels || [])
      if (!labeled.labels.some((l) => l.name === req)) throw new HardError(`missing required label: ${req} (case ${assertion.id})`);
    const waived = new Set(waivers.filter((w) => w.case_id === assertion.id).map((w) => w.check));
    for (const f of FLOOR) {
      if (f.waivable && waived.has(f.check)) continue; // never_appears is waivable:false → always runs
      findings.push(...PREDICATES[f.predicate](labeled, f.args));
    }
    for (const p of assertion.predicates || []) {
      const { name, ...args } = p;
      if (!PREDICATES[name]) throw new HardError(`unknown predicate: ${name}`);
      const decl = PREDICATE_ARGS[name];
      const accepted = new Set([...decl.required, ...decl.optional]);
      for (const k of Object.keys(args)) if (!accepted.has(k)) throw new HardError(`predicate ${name}: unknown arg "${k}" (case ${assertion.id})`);
      findings.push(...PREDICATES[name](labeled, args));
    }
    return { caseId: assertion.id, pass: findings.length === 0, findings, hardError: null };
  } catch (e) {
    if (e instanceof HardError) return { caseId: assertion.id, pass: false, findings, hardError: e.message };
    throw e;
  }
}
