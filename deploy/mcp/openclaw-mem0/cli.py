"""CLI shim wrapping the same mem0 Memory instance as server.py.

Lets the dashboard backend call list/search/add/delete directly without
spinning up an MCP transport. Output is JSON on stdout; errors are JSON on
stderr with non-zero exit.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from server import _build_memory


def emit(obj: Any) -> None:
    json.dump(obj, sys.stdout, ensure_ascii=False, default=str)
    sys.stdout.write("\n")


def emit_error(msg: str, code: int = 1) -> None:
    json.dump({"error": msg}, sys.stderr, ensure_ascii=False)
    sys.stderr.write("\n")
    sys.exit(code)


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="action", required=True)

    p_list = sub.add_parser("list")
    p_list.add_argument("--user-id", required=True)
    p_list.add_argument("--limit", type=int, default=50)

    p_search = sub.add_parser("search")
    p_search.add_argument("--user-id", required=True)
    p_search.add_argument("--query", required=True)
    p_search.add_argument("--limit", type=int, default=10)

    p_add = sub.add_parser("add")
    p_add.add_argument("--user-id", required=True)
    p_add.add_argument("--content", required=True)
    p_add.add_argument("--metadata", default="")

    p_delete = sub.add_parser("delete")
    p_delete.add_argument("--memory-id", required=True)

    p_delete_all = sub.add_parser("delete-all")
    p_delete_all.add_argument("--user-id", required=True)

    args = parser.parse_args()

    try:
        memory = _build_memory()
    except Exception as e:  # noqa: BLE001
        emit_error(f"build_memory failed: {e}")
        return

    if args.action == "list":
        emit(memory.get_all(filters={"user_id": args.user_id}, top_k=args.limit))
    elif args.action == "search":
        emit(
            memory.search(
                query=args.query,
                filters={"user_id": args.user_id},
                top_k=args.limit,
            )
        )
    elif args.action == "add":
        meta: dict[str, Any] = {}
        if args.metadata:
            try:
                meta = json.loads(args.metadata)
            except json.JSONDecodeError:
                meta = {"raw": args.metadata}
        emit(memory.add(args.content, user_id=args.user_id, metadata=meta))
    elif args.action == "delete":
        emit(memory.delete(memory_id=args.memory_id))
    elif args.action == "delete-all":
        emit(memory.delete_all(user_id=args.user_id))
    else:
        emit_error(f"unknown action: {args.action}")


if __name__ == "__main__":
    main()
