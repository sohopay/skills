---
name: sohopay-idempotency
description: >
  Pass idempotency_key (UUID v4) on SohoPay write tools. Use when Cursor or ChatGPT cannot set Idempotency-Key, or a write is retried — not for whoami.
license: Apache-2.0
metadata:
  hosted_name: idempotency
  title: SohoPay Idempotency
  version: "1.0"
---

On every MCP **write**, pass `idempotency_key` (UUID v4) in the tool args when the harness cannot set headers. If you also set `Idempotency-Key`, the values must match.

- Same key + same body → replay.
- Same key + different body → `409 IDEMPOTENCY_KEY_CONFLICT`.
- Network retry of the same call → **reuse** the key. New operation → new key.
- 402 merchant **202** → replay the **same** payment header. Do not mint a new spend.
- `authorize_agent` challenge and submit are two writes → two keys.
- `request_repayment` challenge and submit are two writes → two keys.

TTL table: [references/ttl.md](references/ttl.md).
