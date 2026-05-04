# Customer ID Injector

OpenClaw plugin that **enforces correct customer scoping** on customer-memory tool calls. Without it, the LLM has to remember to pass the right `user_id` for every `add_memory` / `search_memories` call, and gets it wrong about 5% of the time.

## What it does

Hooks `before_tool_call`. On every:

- `openclaw-mem0__*` call → overrides `params.user_id` with the canonical LINE userId derived from `ctx.sessionKey`
- `wiki_get` / `wiki_apply` call where `params.id` starts with `entity.customer-` → rewrites the id to `entity.customer-line-<userId>`

The userId is parsed out of the OpenClaw session key (format `agent:<agentId>:line:direct:<userId>`) and canonicalized to `U` + 32 lowercase hex.

## Why

`mem0` and `wiki_apply` accept the user id as a regular tool parameter. Without this plugin, correctness depends on the LLM:
- reading the session metadata correctly,
- not mixing up two customers in the same session,
- not falling back to a default user_id.

This plugin makes it deterministic: regardless of what the LLM passes, the actual LINE senderId wins.

## Config

```json
{
  "plugins": {
    "entries": {
      "customer-id-injector": {
        "enabled": true,
        "config": {
          "memToolPrefix": "openclaw-mem0__",
          "wikiToolNames": ["wiki_get", "wiki_apply"],
          "wikiPathField": "id",
          "wikiCustomerPathTemplate": "entity.customer-line-{userId}",
          "logOverrides": true,
          "channels": ["line"]
        }
      }
    }
  }
}
```

All fields optional; the defaults match the farfaraway-cs setup.

## Install

```bash
openclaw plugins install -l /path/to/openclaw-customer-id-injector
openclaw plugins enable customer-id-injector
systemctl --user restart openclaw-gateway
```

Or use the Mission Control `/customer-service` "Memory" tab — the install wizard auto-installs this plugin alongside mem0.
