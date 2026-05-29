#!/usr/bin/env python3
"""
Agent Memory Manager (Experience Buffer)
Usage:
  # To log an error and its solution:
  python execution/memory_manager.py log --error "ModuleNotFoundError: No module named 'requests'" --solution "Add requests to Dockerfile or pip install it" --context "Running tool X"
  
  # To search memory for past errors:
  python execution/memory_manager.py search --query "ModuleNotFoundError"
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

def search_experience(query: str):
    mem = load_memory()
    query_lower = query.lower()
    results = []
    
    for entry in mem:
        if (query_lower in entry["error"].lower() or 
            query_lower in entry["solution"].lower() or 
            query_lower in entry.get("context", "").lower()):
            results.append(entry)
            
    print(json.dumps({"status": "success", "matches": len(results), "results": results}, indent=2))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Agent Experience Buffer")
    subparsers = parser.add_subparsers(dest="action", required=True)
    
    # Log parser
    log_parser = subparsers.add_parser("log")
    log_parser.add_argument("--error", required=True, help="Error message encountered")
    log_parser.add_argument("--solution", required=True, help="How it was solved")
    log_parser.add_argument("--context", default="", help="Context of the error")
    
    # Search parser
    search_parser = subparsers.add_parser("search")
    search_parser.add_argument("--query", required=True, help="Keyword to search in memory")
    
    args = parser.parse_args()
    
    if args.action == "log":
        log_experience(args.error, args.solution, args.context)
    elif args.action == "search":
        search_experience(args.query)
