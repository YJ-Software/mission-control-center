# Business Hours Gate

OpenClaw plugin that silences (or canned-replies) inbound messages during configured business hours. Lets human staff handle messages without the AI also responding.

## How it works

Registers a single `inbound_claim` hook. When a message arrives:

1. Reads `plugins.entries.business-hours-gate.config` from `openclaw.json`.
2. If the current time (in the configured timezone) falls inside any window, claims the message — AI is not invoked.
3. If `replyText` is set, sends that text as a canned reply. If empty, silence.
4. Outside windows: passes through, agent handles normally.
5. Optional `channels` list restricts gating to specific channels (e.g. `["line"]`).

## Config

```json
{
  "plugins": {
    "entries": {
      "business-hours-gate": {
        "enabled": true,
        "config": {
          "schedule": {
            "timezone": "Asia/Taipei",
            "windows": [
              { "days": ["mon","tue","wed","thu","fri"], "start": "09:00", "end": "18:00" }
            ]
          },
          "replyText": "",
          "channels": ["line"]
        }
      }
    }
  }
}
```

## Install (manual)

```bash
openclaw plugins install -l /path/to/this/dir
openclaw plugins enable business-hours-gate
systemctl --user restart openclaw-gateway
```

`-l` symlinks instead of copying — good for development. Drop the flag for a production-style install.

## Install (via Mission Control)

Use the Customer Service page in Mission Control Center; it handles install / enable / config / restart in one click.
