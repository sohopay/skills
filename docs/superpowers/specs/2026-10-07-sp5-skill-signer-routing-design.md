# SP5 — Skill Signer Routing (Portable Agent Signing) Design

> Sub-project SP5 of the **SohoPay Portable Agent Signing** epic. Depends on SP1 (the
> `sohopay-signer/1` contract), SP2 (the `sohopay-signer` Node CLI), and **SP2 Amendment A**
> (`voucher sign --envelope` + normative header serialization; `@sohopay/signer-vectors@0.2.0`).

## Context & Goal

Agent-host skills in the `sohopay/skills` repo currently tell the model to **hand-roll
Protocol-V2 voucher crypto** — JCS canonicalization, the tagged Ed25519 preimage, the
signature, and the base64 `PAYMENT-SIGNATURE` envelope — by copying a prose "recipe." An
LLM cannot compute Ed25519 or RFC 8785 JCS reliably, so this is the highest-risk step in
the whole pay flow.

**Goal:** the voucher **sign step** stops doing or explaining crypto and instead **routes
to a runtime signer** — the SP2 `sohopay-signer` CLI — which, via Amendment A, returns the
*entire* deterministic `PAYMENT-SIGNATURE` header. If no conformant signer is present, the
skill **fails closed** with `SIGNER_UNAVAILABLE` and never improvises crypto.

**Intended outcome / success criteria:**
- The V2 sign step in `sohopay-x402` contains **no cryptographic instructions** — it
  describes *how to invoke and consume a signer*, nothing more.
- A conformant signer produces the header; the skill copies it opaquely and retries.
- No signer → one clear terminal failure (`SIGNER_UNAVAILABLE`), no prose-crypto fallback.
- The private key never enters the model's context, a shell argument, or any tool input.
- CI mechanically enforces that the recipe cannot creep back in.

**Who it is for:** any agent host running the SohoPay skills (Claude Code, Cursor, etc.)
that has — or can resolve — a `sohopay-signer` executable.

## Scope

**In scope — the V2 voucher hot path only:**
- The **sign step** of `plugins/sohopay/skills/sohopay-x402/references/prepare-and-voucher.md`.
- A **new reusable reference** `plugins/sohopay/skills/sohopay-x402/references/signer.md`
  holding the signer-invocation contract.
- A **light pointer** update in `plugins/sohopay/skills/sohopay-x402/SKILL.md` (Wave 3).

**Out of scope (unchanged by SP5):**
- Onboarding / keygen / PoP (`sohopay-onboard`) — the signer does **not** generate keys;
  these skills legitimately keep crypto terms.
- The V1 `COMPLETED` branch, `borrower-direct.md`, `v1-fallback.md`.
- Operator consent, first-time-merchant, the merchant HTTP contract, settlement polling.
- Multi-skill routing (SP5-complete), bundled JS (SP3), Python (SP4), multi-host evals (SP6).

## Approach (locked)

**Approach A** — a shared `signer.md` reference + a rewrite of the `prepare-and-voucher.md`
sign section + a light `SKILL.md` pointer. Edits are made **only under `plugins/`**; the
repo-root `*.md`, `.well-known/agent-skills/index.json`, and `llms-full.txt` are
**generated** by `npm run build` (`generate:hosted` + `generate:llms-full`) and validated
by `npm run validate` (`scripts/validate-skills.mjs`). Never hand-edit generated files.

**Delivery — route-if-present, else fail closed.** SP5 does not decide how the signer is
published or installed (true cross-host portability waits for SP3's bundle). The skill
*resolves* a signer if one exists and *fails closed* otherwise.

**Security terminology (locked).** We do **not** claim "the key never leaves the host" as a
normative guarantee. The precise claim: **SP5 does not intentionally transmit the private
key outside the local signer process, nor place it in `argv`, `stdin`, or any tool input.**

---

## Section 1 — Architecture & flow

### Sequencing invariant

The sign step is **not** free-standing. The hot path ordering is:

```
consent_ok → prepare → sign → retry
```

The consent / first-time-merchant gate (out of scope) **must** have passed before sign
runs. `signer.md` states this ordering invariant and defers the gate's mechanics to the
existing `sohopay-x402` / `sohopay-spend` docs.

### Flow (V2 `VOUCHER_ISSUED`)

```
prepare_x402_payment → VOUCHER_ISSUED (unsigned voucher + envelope + header_name)
  → resolve a signer         (signer.md resolution order; else SIGNER_UNAVAILABLE, STOP)
  → write prepare response to <prepfile> (curl -o; file-write tool is byte-for-byte fallback)
  → sohopay-signer voucher sign --envelope --key <secret.json> --input <prepfile> --write-header <hdrfile>
  → read signer stdout: assert signer_protocol, header_name; cross-check payment_id + agent_key_jkt
  → retry merchant: curl -H @<hdrfile> {MERCHANT_URL}
  → delete <prepfile> and <hdrfile>
```

The skill performs **no** canonicalization, hashing, signing, or base64 — all of it lives
behind the signer.

---

## Section 2 — `signer.md` contract (new reference)

A self-contained reference that any SohoPay skill can point at for "route signing to the
signer." SP5 uses it for the voucher hot path; later sub-projects reuse it.

### Resolution

Resolve the first candidate that **answers**, in order:

1. `$SOHOPAY_SIGNER` (explicit path/command override)
2. `sohopay-signer` on `PATH`
3. `npx --no @sohopay/agent-signer`

There is **no** local-checkout candidate. Each candidate gets a **10 s** timeout; a
timeout (or spawn failure) counts as a **miss**, move to the next. **Resolution budget:**
worst case is 3 × 10 s = **30 s**, accepted explicitly (no separate total cap).

A candidate **answers** iff: it runs `capabilities`, exits 0, stdout parses as JSON, **and**
`signer_protocol === "sohopay-signer/1"`. If `capabilities` reports embedded conformance
vectors, run `verify-vectors` **once** and require exit 0 before trusting the candidate.

**Header-format / version pin.** The curl-ready `--write-header` line format (`<name>:
<value>\n`) ships in `@sohopay/agent-signer` **0.2.0** alongside `--envelope`. The package is
**private and was never published**, and `--write-header` is new in the Amendment A change,
so the brief raw-value form — which existed only between two in-branch commits — was **never
released**. `sohopay-signer/1` therefore **defines** `--write-header` as the curl-line
format; any `/1` signer emits it. As belt-and-suspenders for the one implementation that
briefly had an unreleased build, when `implementation === "@sohopay/agent-signer"` the skill
additionally requires `implementation_version >= 0.2.0` (from `capabilities`); a lower
version is a **miss**. (A pre-Amendment-A build has no `--envelope` at all, so the
`voucher sign --envelope` call fails loudly — exit 2 — rather than emitting a malformed
header.)

**`verify-vectors`/`capabilities` cost.** Both run in-process and complete sub-second on a
resolved local signer, so they fit inside the 10 s per-candidate budget. The only thing that
can approach 10 s is a **cold `npx` download** of the package — which is moot until SP3
publishes `@sohopay/agent-signer` (until then resolution is `$SOHOPAY_SIGNER` / `PATH`); SP3
revisits the budget when it enables the `npx` path.

If no candidate answers → **`SIGNER_UNAVAILABLE`**, STOP, surface to the operator. **Never**
hand-sign, WebSearch, or install crypto libraries as a fallback.

### Invocation

```
<signer> voucher sign --envelope --key <secret.json path> --input <prepfile> --write-header <hdrfile>
```

- **Input (`--input <prepfile>`):** the **full `prepare_x402_payment` response**
  (`{ voucher, signing, envelope, header_name, … }`). The `prepare` HTTP call writes it
  **straight to disk** (`curl … -o <prepfile>`). The host file-write tool is a **fallback
  only**, and must write the response **byte-for-byte as received — no re-serialization**,
  so the model never transcribes (and cannot silently alter) numbers or fields. **Never**
  interpolate the JSON into a shell string; a quoted heredoc (`<<'SOHOPAY_EOF'`) is a
  shell-only last resort.
- **Key (`--key <secret.json path>`):** an **opaque path**. Key **selection** is by the
  canonical path onboarding wrote for this borrower
  (`~/.agents/sohopay-agent-workload/secret.json`); the skill does **not** read the file to
  "check" it. Correctness is enforced downstream (see Cross-check) — not by the skill
  reading key material.

### Output & header

The signer emits snake_case JSON on stdout: `signer_protocol`, `implementation`,
`implementation_version`, `payment_id`, `agent_key_jkt`, `signature`, `algorithm`,
`envelope`, `header_name`, `header_value`.

- **Assert `header_name === "PAYMENT-SIGNATURE"`**, else STOP with a named error
  (`UNEXPECTED_HEADER_NAME`). The skill never hardcodes a header the signer didn't return
  and the two never drift.
- **`header_value` is opaque** — never decode, edit, re-encode, or echo it. The signed
  voucher is a **replayable credential until expiry**.
- **Retry via the header file:** the signer's `--write-header` writes a curl-ready line
  `PAYMENT-SIGNATURE: <header_value>\n`, so the retry is **`curl -H @<hdrfile> {URL}`** —
  the value never enters a shell argument or the model's context. (Amendment A guarantees
  this file format.)

### Cross-check (before the retry)

Compare the signer's output against the **prepare response** (the authoritative prepared
values):

- `payment_id` **must equal** the prepare response's `voucher.paymentId`.
- `agent_key_jkt` **must equal** the prepare response's `voucher.agentKeyJkt` — which is
  **the backend-registered workload key's thumbprint**.

A mismatch → STOP (`PAYMENT_ID_MISMATCH` / `AGENT_KEY_JKT_MISMATCH` surfaced from the
signer or raised by the skill). This is meaningful **in combination** with the signer's own
`AGENT_KEY_JKT_MISMATCH` guard, which binds the `--key` file to `voucher.agentKeyJkt`:
together they confirm **the registered key signed this exact payment** (comparing signer
output to its own input alone would only catch signer bugs).

### Error handling (no partial recovery)

Any **nonzero signer exit**, malformed/unparseable stdout, incompatible `signer_protocol`,
or a missing required output field → **surface the signer's error code** and STOP **before**
the merchant retry. **Never** fall back to hand-signing, and **never** re-invoke the signer
with modified input. `signer.md` carries a **caller-action table** (code → surface + stop)
that **links SP1's code table** rather than duplicating the code meanings.

### Key handling — MUST NOT

- The agent **MUST NOT** read, print, parse, copy, or summarize `secret.json`.
- The private key **MUST NOT** appear in `argv`, `stdin`, or any tool input.
- `secret.json` is only ever an **opaque `--key` path**.

### Temp-file lifecycle

- `<prepfile>` and `<hdrfile>` are created with mode **`0600`** under a **per-invocation
  directory** with an **unpredictable name** (e.g. `mktemp -d`).
- Both are **deleted after the retry resolves** (success **or** terminal failure).
  `<hdrfile>` is the sensitive one (it holds the replayable credential).

### Re-sign & expiry

If the retry fails terminally or the voucher validity window lapses, **re-prepare** (which
mints a **new `payment_id`**) and sign the fresh envelope. **Never** re-sign a stale
envelope or reuse an old header. (`signer.md` references the signer's operation/recovery
state model — SP2 S9/S10 — for what "terminal" means.)

---

## Section 3 — `prepare-and-voucher.md` rewrite

**Delete** (the prose-crypto):
- The entire **"Protocol V2 sign recipe (copy this — do not rediscover)"** block: the
  7 hand-crypto steps (JCS → preimage → Ed25519 → encode → fill → base64 header), the
  `secret.json` **shape** JSON (`private_key_base64url`, `public_jwk`, `jkt`, …), and the
  "Deps: `@noble/curves` + `canonicalize`" note.
- The `VOUCHER_ISSUED` action-table rows **"How to sign"**, **"Fill signature"**, and
  **"Merchant header"** (they instruct the model to hand-build the envelope).

**Replace** with a short **"Sign via the signer"** subsection that defers to
`[references/signer.md](signer.md)` and carries only the hot-path specifics: route (else
`SIGNER_UNAVAILABLE`), one `voucher sign --envelope` call does the whole header, `secret.json`
is an opaque `--key` path, `header_value` is opaque (retry with `curl -H @<hdrfile>`),
assert `header_name`, cross-check `payment_id` + `agent_key_jkt`, temp-file `0600` +
cleanup, re-prepare on expiry. The `VOUCHER_ISSUED` field table keeps **"Unsigned voucher"**
as source-of-truth; its sign/fill/header rows now point at `signer.md`.

**Unchanged:** the V1 `COMPLETED` branch, the 402-challenge map, operator-consent /
payRequest, first-time-merchant, scopes, and the merchant HTTP contract.

### `SKILL.md` (light pointer)

Wave 3 (currently: "open `references/prepare-and-voucher.md` Sign steps. Key:
`~/.agents/sohopay-agent-workload/secret.json` (reuse only if borrower_id and jkt match)")
is updated to route the sign through the signer and pass the canonical `secret.json` as an
**opaque `--key`** — dropping the "reuse only if borrower_id and jkt match" phrasing, which
implied reading the file (key correctness is now enforced by the signer guard + cross-check,
not by the skill inspecting the file). The `sohopay-x402` **`description:` frontmatter is
unchanged** (SP5 changes *how* the skill signs, not *what* it does).

---

## Machine-checkable invariants (CI)

Add to `scripts/validate-skills.mjs` (or a dedicated check it calls), failing the build on
violation:

1. **No crypto recipe in the hot-path file.** `prepare-and-voucher.md` contains **none** of:
   `Ed25519`, `canonicalize`, `@noble`, `private_key`, `base64url`, `JCS`.
   **Scoped to `prepare-and-voucher.md` only** — `sohopay-onboard` / `sohopay-authorize-agent`
   / `sohopay-repay` legitimately mention these for keygen/PoP/consent and are out of SP5
   scope.
2. **No dangling link to the removed recipe.** No skill file links to the removed
   "Protocol V2 sign recipe" anchor (check `sohopay-onboard` and any other skill).
3. **Signer invocations are file-based.** Every `voucher sign` invocation in skill docs uses
   `--key`, `--input`, **and** `--write-header`, and **none** use inline JSON or `stdin`
   (no `--input -`, no piped JSON).

---

## Build & packaging integration

- Edit only: `plugins/sohopay/skills/sohopay-x402/SKILL.md`,
  `plugins/sohopay/skills/sohopay-x402/references/prepare-and-voucher.md`, and new
  `plugins/sohopay/skills/sohopay-x402/references/signer.md`.
- Run `npm run build` (regenerates root `*.md`, `index.json`, `llms-full.txt`) then
  `npm run validate` (must pass the new invariants + existing frontmatter/link/secret rules).
- **Triggering evals:** the `sohopay-x402` `description` is unchanged, so
  `evals/sohopay-x402/trigger-queries.json` (a *triggering*-only harness — does the skill
  fire for a query) needs **no change**.
- **Behavioral invariants (required).** SP5 changes behavior materially, and those changes
  must be enforced, not left as prose. Two layers:
  - **Static (in-repo, mechanical) — the three CI invariants** below. These prevent the
    doc-level failure modes outright: the agent cannot copy a crypto recipe that the grep
    guarantees is absent, cannot use a non-file-based `voucher sign`, and cannot follow a
    dangling recipe link.
  - **Runtime behavioral cases** — the repo's eval harness is **triggering-only**, so these
    agent-execution assertions are captured as committed behavioral-eval fixtures
    (`evals/sohopay-x402/behavioral-cases.*`) for the multi-host execution harness (SP6) to
    run, **not** left in prose:
    1. **No signer →** the agent fails closed with `SIGNER_UNAVAILABLE` and does **not**
       hand-sign, import a crypto lib, or write signing code.
    2. **Key opacity —** the agent never reads/`cat`s/parses `secret.json`; the key never
       appears in any tool input.
    3. **Header opacity —** the retry uses `curl -H @<hdrfile>`; `header_value` never appears
       in model output or `argv`.
    4. **Cross-check mismatch —** a mismatched `payment_id` or `agent_key_jkt` stops the flow
       with no retry.
    5. **Sequencing —** no sign call occurs before `consent_ok`.
  - **Open fork (see §Decision below):** whether SP5 also builds a minimal behavioral runner
    for cases 1–5 now, or commits them as fixtures and defers *execution* to SP6.
- **Merge order (strict).** The SP5 skill change **must not ship ahead of a signer that
  satisfies it.** Required order: (1) `@sohopay/signer-vectors@0.2.0` published (done); (2)
  signer PR #2 (`voucher sign --envelope` + curl-line `--write-header`, `@sohopay/agent-signer@0.2.0`)
  **merged and a `/1` signer installable**; (3) **then** the SP5 skill change merges. A skill
  that routes to `voucher sign --envelope` before such a signer exists would fail every pay.
- Work in the parked worktree `skills-wt-signer-sdk`, branch `feat/signer-sdk-migration`.

### Decision needed before `writing-plans`

The five runtime behavioral cases cannot run in the current triggering-only harness. Either
(A) SP5 builds a minimal behavioral/execution eval runner for cases 1–5 (larger SP5), or
(B) SP5 commits cases 1–5 as structured fixtures + maximizes the static CI coverage, and the
multi-host execution harness (SP6) runs them. Recommended: **B** — keeps SP5 a focused
routing change, and the three static invariants already give mechanical prevention for the
doc-level failure modes today.

## Testing

- **CI invariants** above are the primary automated gate.
- **`npm run validate`** green.
- **Manual / staging round-trip** (best-effort): resolve a signer and run a real
  `voucher sign --envelope` against a staging `prepare` response. Note: staging MCP x402
  is currently blocked on a real active merchant + a borrower EIP-712 grant not exposed via
  MCP, so an end-to-end staging pay may not be reproducible here; the signer invocation
  itself is exercised by SP2's own suite + `verify-vectors`.

## Out of scope / future

SP5-complete (route every signing skill, not just `sohopay-x402`), SP3 (bundled JS so the
signer is present without `npx`), SP4 (Python runtime), SP6 (multi-host evals). PoP signing
stays untagged/frozen (SOHO-74); a future symmetric typed PoP prefix would be
`sohopay-signer/2`.
