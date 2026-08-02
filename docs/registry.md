# Open skills registry compatibility

Validated on 2026-06-27 with `skills` CLI v1.5.13.

## Layout

Open-registry package layout:

```text
plugins/sohopay/skills/sohopay-integrate/SKILL.md
plugins/sohopay/.cursor-plugin/plugin.json
```

## Install command (after GitHub publish)

```bash
npx skills add sohopay/skills -g -y
```

## Local preflight (before publish)

```bash
npx skills add . --list
# Expected: sohopay-integrate
```

## Skill ID

Registry skill name: **`sohopay-integrate`** (brand-prefixed to avoid collisions with generic names like `setup`).

Hosted workflow files (`setup.md`, etc.) use generic filenames under `/skills/` on `agents.sohopay.xyz`.

## Phase 2

If GitHub repo is private, registry install requires auth or making the repo public. Curl bootstrap works regardless once CDN is deployed.
