# openclaw-mem0-mcp

Self-hosted [mem0](https://mem0.ai) MCP server tailored for OpenClaw. Stores per-user memories in a local Qdrant; embeds with local Ollama bge-m3; LLM provider is configurable so you can run against the Gemini OpenAI-compatible endpoint, native Gemini, OpenRouter, vLLM, LM Studio, or any other OpenAI-compatible host without writing code.

## Why a custom wrapper

Existing community MCPs don't fit the "Qdrant + Ollama + your-favourite-cloud-LLM" combination:
- `pinkpixel/mem0-mcp` only supports Supabase pgvector or in-memory storage.
- `elvismdev/mem0-mcp-selfhosted` hardcodes `anthropic | ollama` for the main LLM.

This wrapper is ~150 lines and lets you mix-and-match.

## Tools exposed

| Tool | Purpose |
|---|---|
| `add_memory` | Store a fact / preference / observation under a user_id |
| `search_memories` | Semantic search over a user's memories |
| `list_memories` | List all memories for a user |
| `delete_memory` | Delete one memory by id |
| `delete_all_memories` | Wipe all memories for a user (requires explicit user_id) |

## Prerequisites

Run on the same host (or wire up the URL env vars):
- Qdrant: `docker run -d -p 6333:6333 -v ~/.openclaw/mem0-qdrant:/qdrant/storage qdrant/qdrant:latest`
- Ollama with bge-m3: `ollama pull bge-m3`
- Python 3.10+ and `uv` (`curl -LsSf https://astral.sh/uv/install.sh | sh`)

## Configuration (env vars)

| Var | Default | Notes |
|---|---|---|
| `MEM0_LLM_MODE` | `openai` | `openai` (any OpenAI-compat endpoint) or `gemini` (Google's native API) |
| `MEM0_LLM_MODEL` | `gemini-2.5-flash-lite` | Model id passed to the provider |
| `OPENAI_BASE_URL` | Gemini's OpenAI-compat URL | Only used when `MEM0_LLM_MODE=openai` |
| `OPENAI_API_KEY` | (required for `openai`) | Falls back to `GOOGLE_API_KEY` / `GEMINI_API_KEY` |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | (required for `gemini`) | |
| `MEM0_LLM_TEMPERATURE` | `0.1` | |
| `MEM0_LLM_MAX_TOKENS` | `2000` | |
| `MEM0_EMBED_MODEL` | `bge-m3:latest` | |
| `MEM0_EMBED_URL` | `http://127.0.0.1:11434` | Ollama API |
| `MEM0_EMBED_DIMS` | `1024` | Must match the Ollama model's output dim |
| `MEM0_QDRANT_HOST` | `127.0.0.1` | |
| `MEM0_QDRANT_PORT` | `6333` | |
| `MEM0_COLLECTION` | `openclaw_memories` | Qdrant collection name |
| `MEM0_DEFAULT_USER_ID` | `default` | Used when a tool call omits `user_id` |
| `MEM0_MCP_NAME` | `openclaw-mem0` | Surface name in MCP listings |

## Run

```bash
cd ~/projects/mission-control-center/deploy/mcp/openclaw-mem0
uv sync
GOOGLE_API_KEY=… uv run python server.py
```

## Wire into OpenClaw

Add an entry to `~/.openclaw/openclaw.json`:

```json
{
  "mcpServers": {
    "openclaw-mem0": {
      "command": "/home/openclaw/.local/bin/uv",
      "args": [
        "run",
        "--directory",
        "/home/openclaw/projects/mission-control-center/deploy/mcp/openclaw-mem0",
        "python",
        "server.py"
      ],
      "env": {
        "MEM0_LLM_MODE": "openai",
        "MEM0_LLM_MODEL": "gemini-2.5-flash-lite",
        "OPENAI_BASE_URL": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "OPENAI_API_KEY": "AIza..."
      }
    }
  }
}
```

Then `openclaw gateway restart` and verify the tools are registered.
