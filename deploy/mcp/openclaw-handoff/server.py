"""Tiny MCP server for human handoff via Telegram + AgentMail.

Wraps two outbound channels so an embedded OpenClaw agent (which doesn't
get the built-in `message` tool) can still hand a customer over to the
team. Two tools, no state, no auth beyond the configured creds.

  - notify_team(message)            -> Telegram sendMessage (existing)
  - notify_team_email(subject,body) -> AgentMail messages.send (new)

Both tools are independent: the agent calls each once per handoff.
Failure of one doesn't affect the other, by design — losing one channel
is preferable to losing the whole handoff.

Telegram env (required for notify_team):
  TELEGRAM_BOT_TOKEN  — bot token (BotFather)
  TELEGRAM_CHAT_ID    — destination chat (positive int = user, negative = group)

Telegram optional:
  TELEGRAM_API_ROOT   — default https://api.telegram.org
  HANDOFF_PARSE_MODE  — Telegram parse_mode (default empty = plain text). Set to
                        "MarkdownV2" or "HTML" only if your messages are escaped
                        for that mode — wrong escaping makes Telegram 400.
  HANDOFF_TIMEOUT_S   — HTTP timeout in seconds (default 15)

AgentMail env (required for notify_team_email):
  AGENTMAIL_API_KEY   — API key from https://console.agentmail.to
  AGENTMAIL_INBOX_ID  — sender inbox id (e.g. agent-name@agentmail.to)
  HANDOFF_EMAIL_TO    — destination email address (single recipient)
"""

from __future__ import annotations

import os
import urllib.parse
import urllib.request
from typing import Any

from mcp.server.fastmcp import FastMCP


def _env(name: str, default: str | None = None, *, required: bool = False) -> str:
    val = os.environ.get(name, default)
    if required and not val:
        raise RuntimeError(f"missing required env: {name}")
    return val or ""


# Telegram (required at startup — historical behaviour, server fails fast if
# the operator forgot to wire the bot. AgentMail vars are optional.)
BOT_TOKEN = _env("TELEGRAM_BOT_TOKEN", required=True)
CHAT_ID = _env("TELEGRAM_CHAT_ID", required=True)
API_ROOT = _env("TELEGRAM_API_ROOT", "https://api.telegram.org").rstrip("/")
PARSE_MODE = _env("HANDOFF_PARSE_MODE", "")
TIMEOUT_S = int(_env("HANDOFF_TIMEOUT_S", "15") or "15")

# AgentMail (lazy — read at call time so operators can flip env without
# restarting before the first send. Missing config → tool returns ok=false.)
MAX_TELEGRAM_TEXT = 4096  # Telegram per-message hard limit

mcp = FastMCP("openclaw-handoff")


def _send_chunk(text: str) -> dict[str, Any]:
    payload: dict[str, str] = {
        "chat_id": CHAT_ID,
        "text": text,
        "disable_web_page_preview": "true",
    }
    if PARSE_MODE:
        payload["parse_mode"] = PARSE_MODE

    body = urllib.parse.urlencode(payload).encode("utf-8")
    url = f"{API_ROOT}/bot{BOT_TOKEN}/sendMessage"
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return {"ok": True, "status": resp.status, "response": raw}
    except urllib.error.HTTPError as err:
        body_text = err.read().decode("utf-8", errors="replace") if err.fp else ""
        return {"ok": False, "status": err.code, "error": body_text or str(err)}
    except Exception as err:
        return {"ok": False, "status": 0, "error": str(err)}


@mcp.tool()
def notify_team(message: str) -> dict[str, Any]:
    """Post a handoff message to the team's Telegram chat.

    Use this when a customer needs human follow-up: include the customer
    contact info, summary of their request, why escalation is needed, and
    relevant context. Keep total length under ~3500 chars; longer messages
    are split into multiple Telegram sends.

    Returns {"ok": bool, "chunks": [...], "totalChars": int}. ok is true
    only if every chunk was accepted by Telegram.
    """
    if not message or not message.strip():
        return {"ok": False, "error": "empty message"}

    text = message.strip()
    chunks: list[str] = []
    while text:
        chunks.append(text[:MAX_TELEGRAM_TEXT])
        text = text[MAX_TELEGRAM_TEXT:]

    results = [_send_chunk(c) for c in chunks]
    return {
        "ok": all(r["ok"] for r in results),
        "chunks": results,
        "totalChars": sum(len(c) for c in chunks),
        "chatId": CHAT_ID,
    }


@mcp.tool()
def notify_team_email(subject: str, body: str) -> dict[str, Any]:
    """Send a handoff email to the team via AgentMail.

    Pair with notify_team(): for every escalation, call BOTH so the team
    is reachable on whichever channel they're watching. Failure of one
    must not stop the agent from calling the other.

    Args:
      subject: short subject line (e.g. "🆕 客戶後送 #LINE — 王先生 / 退費").
      body: full handoff payload (same content as the Telegram version is
            fine — plain text, no markdown). 1-50000 chars.

    Returns {"ok": bool, "messageId"|"error": str, "to": str}.
    """
    if not subject or not subject.strip():
        return {"ok": False, "error": "empty subject"}
    if not body or not body.strip():
        return {"ok": False, "error": "empty body"}

    api_key = os.environ.get("AGENTMAIL_API_KEY", "")
    inbox_id = os.environ.get("AGENTMAIL_INBOX_ID", "")
    to_addr = os.environ.get("HANDOFF_EMAIL_TO", "")

    missing = [
        name
        for name, val in (
            ("AGENTMAIL_API_KEY", api_key),
            ("AGENTMAIL_INBOX_ID", inbox_id),
            ("HANDOFF_EMAIL_TO", to_addr),
        )
        if not val
    ]
    if missing:
        return {
            "ok": False,
            "error": f"email destination not configured (missing env: {', '.join(missing)})",
        }

    try:
        # Imported lazily: agentmail is only required if the email tool
        # is actually used. Importing at module load would force every
        # operator (including telegram-only setups) to install the SDK.
        from agentmail import AgentMail  # type: ignore[import-not-found]
    except ImportError as err:
        return {
            "ok": False,
            "error": f"agentmail package not installed: {err}. Run `uv sync` in the openclaw-handoff dir.",
        }

    try:
        client = AgentMail(api_key=api_key)
        result = client.inboxes.messages.send(
            inbox_id,
            to=to_addr,
            subject=subject.strip(),
            text=body.strip(),
        )
    except Exception as err:
        return {"ok": False, "error": str(err), "to": to_addr}

    msg_id = getattr(result, "message_id", None) or getattr(result, "id", None) or ""
    return {"ok": True, "messageId": str(msg_id), "to": to_addr}


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
