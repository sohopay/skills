import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSuite, validateJoin, expectHash } from "./cases.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "suite");
const mk = (id, over = {}) => ({ id, class: "safety", grader: "predicate", expect_hash: expectHash(`e-${id}`),
  requires_labels: [], predicates: [{ name: "absent", label: "secret_read" }], ...over });
const caseMap = (...ids) => new Map(ids.map((id) => [id, { given: "g", expect: `e-${id}` }]));
const asMap = (...as) => new Map(as.map((a) => [a.id, a]));
const has = (errs, re) => assert.ok(errs.some((e) => re.test(e)), `expected ${re} in ${JSON.stringify(errs)}`);

test("committed fixture suite joins cleanly", () => {
  const { cases, assertions } = loadSuite(dir);
  assert.equal(cases.size, 2);
  assert.deepEqual(validateJoin(cases, assertions), []);
});
test("expectHash is sha256 hex", () => assert.match(expectHash("x"), /^[0-9a-f]{64}$/));
test("wrong expect_hash reported", () => {
  has(validateJoin(caseMap("a"), asMap(mk("a", { expect_hash: "deadbeef" }))), /expect_hash/);
});
test("orphan ids reported on each side", () => {
  const errs = validateJoin(caseMap("a", "b"), asMap(mk("a"), mk("c")));
  has(errs, /b/); has(errs, /c/);
});
test("absent target also in requires_labels reported", () => {
  has(validateJoin(caseMap("a"), asMap(mk("a", { requires_labels: ["secret_read"] }))), /absent/i);
});
test("safety graded by judge reported", () => {
  has(validateJoin(caseMap("a"), asMap(mk("a", { grader: "judge" }))), /safety/);
});
test("unknown predicate and undeclared label reported", () => {
  has(validateJoin(caseMap("a"), asMap(mk("a", { predicates: [{ name: "nope" }] }))), /predicate/);
  has(validateJoin(caseMap("a"), asMap(mk("a", { predicates: [{ name: "absent", label: "bogus" }] }))), /bogus/);
  has(validateJoin(caseMap("a"), asMap(mk("a", { requires_labels: ["bogus2"] }))), /bogus2/);
  has(validateJoin(caseMap("a"), asMap(mk("a", { predicates: [{ name: "present", label: "keygen_call", attr: "zzz" }], requires_labels: ["keygen_call"] }))), /zzz/);
});
test("after/not_before anchors must be in requires_labels", () => {
  has(validateJoin(caseMap("a"), asMap(mk("a", { predicates: [{ name: "absent", label: "secret_read", after: "keygen_call" }] }))), /keygen_call/);
  has(validateJoin(caseMap("a"), asMap(mk("a", { predicates: [{ name: "not_before", a: "secret_read", b: "keygen_call" }] }))), /keygen_call/);
});

test("bare predicate with missing required args reported", () => {
  has(validateJoin(caseMap("a"), asMap(mk("a", { predicates: [{ name: "absent" }] }))), /absent.*label/);
  has(validateJoin(caseMap("a"), asMap(mk("a", { predicates: [{ name: "not_before", a: "keygen_call" }] }))), /not_before.*\bb\b/);
});
test("prototype-key predicate name and label are rejected", () => {
  has(validateJoin(caseMap("a"), asMap(mk("a", { predicates: [{ name: "toString" }] }))), /unknown predicate/);
  has(validateJoin(caseMap("a"), asMap(mk("a", { predicates: [{ name: "absent", label: "constructor" }] }))), /constructor/);
  has(validateJoin(caseMap("a"), asMap(mk("a", { requires_labels: ["toString"] }))), /toString/);
});
