"""Thin MCP server wrapping the mem0 SDK.

Self-hosted setup:
  vector store : local Qdrant (default http://127.0.0.1:6333)
  embedder     : local Ollama bge-m3 (default http://127.0.0.1:11434)
  LLM          : configurable via MEM0_LLM_MODE — either an OpenAI-compatible
                 endpoint (e.g. Gemini's /v1beta/openai/, OpenRouter, vLLM,
                 LM Studio, …) OR Google's native Gemini API.

Tools exposed: add_memory, search_memories, list_memories, delete_memory,
  delete_all_memories.

All env vars are optional; sensible defaults are baked in. Required: an LLM
API key (OPENAI_API_KEY for openai mode, GOOGLE_API_KEY for gemini mode).
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from mcp.server.fastmcp import FastMCP
from mem0 import Memory


def _build_llm_config() -> dict[str, Any]:
    mode = os.environ.get("MEM0_LLM_MODE", "openai").lower()
    model = os.environ.get("MEM0_LLM_MODEL", "gemini-2.5-flash-lite")

    if mode == "gemini":
        api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "MEM0_LLM_MODE=gemini requires GOOGLE_API_KEY or GEMINI_API_KEY",
            )
        return {
            "provider": "gemini",
            "config": {
                "model": model,
                "api_key": api_key,
                "temperature": float(os.environ.get("MEM0_LLM_TEMPERATURE", "0.1")),
                "max_tokens": int(os.environ.get("MEM0_LLM_MAX_TOKENS", "2000")),
            },
        }

    if mode == "openai":
        api_key = (
            os.environ.get("OPENAI_API_KEY")
            or os.environ.get("GOOGLE_API_KEY")
            or os.environ.get("GEMINI_API_KEY")
        )
        if not api_key:
            raise RuntimeError(
                "MEM0_LLM_MODE=openai requires OPENAI_API_KEY (or GOOGLE_API_KEY when "
                "OPENAI_BASE_URL points at Gemini's OpenAI-compatible endpoint)",
            )
        base_url = os.environ.get(
            "OPENAI_BASE_URL",
            "https://generativelanguage.googleapis.com/v1beta/openai/",
        )
        return {
            "provider": "openai",
            "config": {
                "model": model,
                "api_key": api_key,
                "openai_base_url": base_url,
                "temperature": float(os.environ.get("MEM0_LLM_TEMPERATURE", "0.1")),
                "max_tokens": int(os.environ.get("MEM0_LLM_MAX_TOKENS", "2000")),
            },
        }

    raise RuntimeError(f"Unknown MEM0_LLM_MODE: {mode!r} (expected 'openai' or 'gemini')")


def _build_embedder_config() -> dict[str, Any]:
    return {
        "provider": "ollama",
        "config": {
            "model": os.environ.get("MEM0_EMBED_MODEL", "bge-m3:latest"),
            "ollama_base_url": os.environ.get(
                "MEM0_EMBED_URL", "http://127.0.0.1:11434"
            ),
            "embedding_dims": int(os.environ.get("MEM0_EMBED_DIMS", "1024")),
        },
    }


def _build_vector_store_config() -> dict[str, Any]:
    return {
        "provider": "qdrant",
        "config": {
            "host": os.environ.get("MEM0_QDRANT_HOST", "127.0.0.1"),
            "port": int(os.environ.get("MEM0_QDRANT_PORT", "6333")),
            "collection_name": os.environ.get(
                "MEM0_COLLECTION", "openclaw_memories"
            ),
            "embedding_model_dims": int(os.environ.get("MEM0_EMBED_DIMS", "1024")),
        },
    }


def _build_memory() -> Memory:
    # NOTE: mem0 OSS 2.x does not ship graph_store — graph features (Neo4j/kuzu)
    # are cloud-only at the moment. We keep the LLM + embedder + vector_store
    # config, which is what the OSS Memory class supports.
    config: dict[str, Any] = {
        "llm": _build_llm_config(),
        "embedder": _build_embedder_config(),
        "vector_store": _build_vector_store_config(),
    }
    return Memory.from_config(config)


memory = _build_memory()
DEFAULT_USER_ID = os.environ.get("MEM0_DEFAULT_USER_ID", "default")

TELEMETRY_PATH = Path(
    os.environ.get(
        "MEM0_TELEMETRY_PATH",
        str(Path.home() / ".openclaw" / "mem0-telemetry.jsonl"),
    )
)


def _record_telemetry(action: str, user_id: str, latency_ms: int, success: bool, extra: dict[str, Any] | None = None) -> None:
    try:
        TELEMETRY_PATH.parent.mkdir(parents=True, exist_ok=True)
        event: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "action": action,
            "user_id": user_id,
            "latency_ms": latency_ms,
            "success": success,
        }
        if extra:
            event.update(extra)
        with TELEMETRY_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
    except Exception:
        # never break a real call because telemetry failed
        pass

mcp = FastMCP(
    name=os.environ.get("MEM0_MCP_NAME", "openclaw-mem0"),
    instructions=(
        "Persistent customer/session memory for OpenClaw agents. "
        "Call search_memories at the start of a customer turn to recall their "
        "history; call add_memory to remember new facts (preferences, context, "
        "answers given). Always pass the LINE userId (or the channel-scoped "
        "session key) as user_id so memories are scoped per-customer."
    ),
)


@mcp.tool()
def add_memory(
    content: str,
    user_id: str = DEFAULT_USER_ID,
    metadata: Optional[dict[str, Any]] = None,
) -> str:
    """Save a fact / preference / observation about a user as long-term memory.

    Args:
        content: The fact to remember (free-form text).
        user_id: Scope the memory to a user/customer. Use the LINE userId (or
            session key) for per-customer memory.
        metadata: Optional metadata dict (e.g. source channel, timestamp).
    """
    started = time.monotonic()
    success = False
    try:
        result = memory.add(content, user_id=user_id, metadata=metadata or {})
        success = True
        return json.dumps(result, ensure_ascii=False, default=str)
    finally:
        _record_telemetry(
            "add",
            user_id,
            int((time.monotonic() - started) * 1000),
            success,
            {"content_len": len(content)},
        )


@mcp.tool()
def search_memories(
    query: str,
    user_id: str = DEFAULT_USER_ID,
    limit: int = 5,
) -> str:
    """Search a user's memories by semantic similarity. Returns up to `limit` hits."""
    started = time.monotonic()
    success = False
    hit_count = 0
    try:
        result = memory.search(
            query=query,
            filters={"user_id": user_id},
            top_k=limit,
        )
        success = True
        if isinstance(result, dict):
            hit_count = len(result.get("results", []))
        elif isinstance(result, list):
            hit_count = len(result)
        return json.dumps(result, ensure_ascii=False, default=str)
    finally:
        _record_telemetry(
            "search",
            user_id,
            int((time.monotonic() - started) * 1000),
            success,
            {"hits": hit_count},
        )


@mcp.tool()
def list_memories(user_id: str = DEFAULT_USER_ID, limit: int = 50) -> str:
    """List all stored memories for a user (newest first, up to `limit`)."""
    started = time.monotonic()
    success = False
    try:
        result = memory.get_all(filters={"user_id": user_id}, top_k=limit)
        success = True
        return json.dumps(result, ensure_ascii=False, default=str)
    finally:
        _record_telemetry(
            "list",
            user_id,
            int((time.monotonic() - started) * 1000),
            success,
        )


@mcp.tool()
def delete_memory(memory_id: str) -> str:
    """Delete a single memory by its id."""
    result = memory.delete(memory_id=memory_id)
    return json.dumps(result, ensure_ascii=False, default=str)


@mcp.tool()
def delete_all_memories(user_id: str) -> str:
    """Delete every memory belonging to the given user.

    Requires an explicit user_id to avoid accidental wipes.
    """
    if not user_id:
        return json.dumps({"error": "user_id is required"}, ensure_ascii=False)
    result = memory.delete_all(user_id=user_id)
    return json.dumps(result, ensure_ascii=False, default=str)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
