---
name: sohopay-agent-session
description: >
  Create a delegated SohoPay agent session. Use when the operator asks for create_agent_session — not human-direct and not an HTTP 402 pay.
license: Apache-2.0
metadata:
  hosted_name: agent-session
  title: SohoPay Agent Sessions (Delegated)
  version: "1.0"
---

Human-direct is the default. Do not create a session to fix `SESSION_GATE_SKIPPED_NO_SESSION`.

`Mcp-Session-Id` is MCP transport. SohoPay `session_id` / `x-session-id` is the delegated session. Never swap them.

Before `create_agent_session`:

> **STOP — ask the operator and wait for their reply. Do not proceed, skip, or simulate this step. Never fabricate keys, tokens, or signatures.**

Required: `borrower_id`, `agent_id`, `permissions[]`, `max_per_tx`, `daily_limit`, `currency`, `valid_until`, and `allowed_merchants` (use `[]` if none). Pass `idempotency_key`. Field tables: [references/fields.md](references/fields.md).
