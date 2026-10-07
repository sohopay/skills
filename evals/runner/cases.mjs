import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LABELS } from "./schema.mjs";
import { PREDICATES, PREDICATE_ARGS } from "./predicates.mjs";

/** sha256 hex of a case's `expect` text; a reworded expect invalidates its assertion until re-reviewed. */
export const expectHash = (expectStr) => createHash("sha256").update(expectStr).digest("hex");

/** Load `<dir>/behavioral-cases.json` and `<dir>/assertions.json` into id-keyed Maps. */
export function loadSuite(dir) {
  const rawCases = JSON.parse(readFileSync(join(dir, "behavioral-cases.json"), "utf8"));
  const rawAsserts = JSON.parse(readFileSync(join(dir, "assertions.json"), "utf8"));
  return {
    cases: new Map(rawCases.map(({ id, given, expect }) => [id, { given, expect }])),
    assertions: new Map(rawAsserts.cases.map((a) => [a.id, a])),
  };
}

const CLASSES = new Set(["safety", "behavioral"]);
const GRADERS = new Set(["predicate", "judge"]);

/** Validate the cases<->assertions join; returns human-readable errors (empty = valid). */
export function validateJoin(cases, assertions) {
  const errs = [];
  for (const id of cases.keys()) if (!assertions.has(id)) errs.push(`id "${id}": case has no assertion`);
  for (const id of assertions.keys()) if (!cases.has(id)) errs.push(`id "${id}": assertion has no case`);

  for (const [id, a] of assertions) {
    const c = cases.get(id);
    if (c && a.expect_hash !== expectHash(c.expect)) errs.push(`id "${id}": expect_hash mismatch (expect reworded? re-review and update)`);
    if (!CLASSES.has(a.class)) errs.push(`id "${id}": invalid class "${a.class}"`);
    if (!GRADERS.has(a.grader)) errs.push(`id "${id}": invalid grader "${a.grader}"`);
    if (a.class === "safety" && a.grader !== "predicate") errs.push(`id "${id}": safety case must use grader "predicate", got "${a.grader}"`);

    const requires = a.requires_labels ?? [];
    for (const l of requires) if (!Object.hasOwn(LABELS, l)) errs.push(`id "${id}": requires_labels has undeclared label "${l}"`);
    const checkLabel = (l, where) => { if (l !== undefined && !Object.hasOwn(LABELS, l)) errs.push(`id "${id}": ${where} references undeclared label "${l}"`); };

    for (const p of a.predicates ?? []) {
      if (!Object.hasOwn(PREDICATES, p.name)) { errs.push(`id "${id}": unknown predicate "${p.name}"`); continue; }
      const decl = PREDICATE_ARGS[p.name];
      for (const k of decl.required) if (p[k] === undefined) errs.push(`id "${id}": ${p.name} requires arg "${k}"`);
      for (const k of Object.keys(p)) if (k !== "name" && !decl.required.includes(k) && !decl.optional.includes(k)) errs.push(`id "${id}": ${p.name} has unknown arg "${k}"`);
      for (const k of ["label", "a", "b", "after"]) checkLabel(p[k], `${p.name}.${k}`);
      if (p.attr !== undefined && Object.hasOwn(LABELS, p.label)) {
        const attr = String(p.attr).split("=")[0];
        if (!LABELS[p.label].includes(attr)) errs.push(`id "${id}": ${p.name} attr "${attr}" not declared on label "${p.label}"`);
      }
      if (p.after !== undefined && !requires.includes(p.after)) errs.push(`id "${id}": ${p.name} anchor "${p.after}" must be in requires_labels`);
      if (p.name === "not_before" && p.b !== undefined && !requires.includes(p.b)) errs.push(`id "${id}": not_before anchor "${p.b}" must be in requires_labels`);
      if (p.name === "absent" && requires.includes(p.label)) errs.push(`id "${id}": absent target "${p.label}" must not be in requires_labels`);
    }
  }
  return errs;
}
