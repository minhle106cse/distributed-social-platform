#!/usr/bin/env python3
"""
Agent Memory Manager (Experience Buffer) v2
Usage:
  # Log an error and its solution:
  python execution/memory_manager.py log --error "..." --solution "..." --context "..."

  # Search memory (fuzzy multi-keyword, searches all fields):
  python execution/memory_manager.py search --query "CQRS transaction prisma"

  # List all entries (optionally limit):
  python execution/memory_manager.py list
  python execution/memory_manager.py list --limit 10
"""

import os
import json
import argparse
from datetime import datetime, timezone
from utils import get_tmp_dir, get_logger

logger = get_logger("memory-manager")


def get_memory_file() -> str:
    return os.path.join(get_tmp_dir(), "agent_memory.json")


def load_memory() -> list:
    mem_file = get_memory_file()
    if os.path.exists(mem_file):
        try:
            with open(mem_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load memory file: {e}")
            return []
    return []


def save_memory(data: list):
    mem_file = get_memory_file()
    with open(mem_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def log_experience(error: str, solution: str, context: str):
    mem = load_memory()
    entry = {
        "id": len(mem) + 1,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "error": error,
        "solution": solution,
        "context": context
    }
    mem.append(entry)
    save_memory(mem)
    logger.info(f"Logged new experience into buffer: {entry['id']}")
    print(json.dumps({"status": "success", "entry": entry}))


def _score_entry(entry: dict, keywords: list[str]) -> int:
    """
    Multi-keyword fuzzy scoring.
    Returns how many unique keywords matched across all fields.
    Higher score = more relevant.
    """
    text = " ".join([
        entry.get("error", ""),
        entry.get("solution", ""),
        entry.get("context", ""),
    ]).lower()

    return sum(1 for kw in keywords if kw in text)


def search_experience(query: str, top_k: int = 10):
    """
    Fuzzy multi-keyword search. Splits query into keywords and scores entries.
    Returns top_k results sorted by relevance score (descending).
    """
    mem = load_memory()
    keywords = [kw.lower() for kw in query.split() if kw.strip()]

    scored = []
    for entry in mem:
        score = _score_entry(entry, keywords)
        if score > 0:
            scored.append({**entry, "_score": score})

    # Sort by score descending, then by recency (id descending) as tiebreak
    scored.sort(key=lambda e: (e["_score"], e["id"]), reverse=True)
    results = scored[:top_k]

    # Remove internal score field from output
    clean_results = [{k: v for k, v in r.items() if k != "_score"} for r in results]

    print(json.dumps({
        "status": "success",
        "query": query,
        "keywords": keywords,
        "matches": len(clean_results),
        "results": clean_results
    }, indent=2))


def list_experience(limit: int = 0):
    """
    List all memory entries, newest first.
    """
    mem = load_memory()
    entries = list(reversed(mem))  # newest first
    if limit > 0:
        entries = entries[:limit]

    print(json.dumps({
        "status": "success",
        "total": len(mem),
        "showing": len(entries),
        "entries": entries
    }, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Agent Experience Buffer v2")
    subparsers = parser.add_subparsers(dest="action", required=True)

    # Log
    log_parser = subparsers.add_parser("log", help="Record a new error/solution pair")
    log_parser.add_argument("--error", required=True, help="Error or problem encountered")
    log_parser.add_argument("--solution", required=True, help="How it was resolved")
    log_parser.add_argument("--context", default="", help="Context or file involved")

    # Search (fuzzy multi-keyword)
    search_parser = subparsers.add_parser("search", help="Fuzzy multi-keyword search")
    search_parser.add_argument("--query", required=True, help="Keywords to search (space-separated)")
    search_parser.add_argument("--top", type=int, default=10, help="Max results to return")

    # List all
    list_parser = subparsers.add_parser("list", help="List all memory entries (newest first)")
    list_parser.add_argument("--limit", type=int, default=0, help="0 = no limit")

    args = parser.parse_args()

    if args.action == "log":
        log_experience(args.error, args.solution, args.context)
    elif args.action == "search":
        search_experience(args.query, top_k=args.top)
    elif args.action == "list":
        list_experience(limit=args.limit)
