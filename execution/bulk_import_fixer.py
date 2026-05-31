#!/usr/bin/env python3
"""
Bulk Import Path Fixer for TypeScript source files.
Use this tool INSIDE the Docker Sandbox whenever you move files and need to
update import paths across the entire codebase.

Usage:
  docker exec agent-sandbox python execution/bulk_import_fixer.py \
    --root apps/auth-service/src \
    --replace "@/errors/" "@/common/errors/" \
    --replace "@/prisma/prisma.client" "@/infrastructure/database/prisma/prisma.client"

Args:
  --root      Root directory to scan (recursively finds all .ts files)
  --replace   One or more "OLD_PATH NEW_PATH" pairs (space-separated)
  --dry-run   Preview changes without writing to disk
"""

import os
import re
import argparse
from utils import get_logger

logger = get_logger("bulk-import-fixer")


def find_ts_files(root: str) -> list[str]:
    ts_files = []
    for dirpath, _, filenames in os.walk(root):
        for filename in filenames:
            if filename.endswith(".ts") and not filename.endswith(".d.ts"):
                ts_files.append(os.path.join(dirpath, filename))
    return ts_files


def fix_imports_in_file(filepath: str, replacements: list[tuple[str, str]], dry_run: bool) -> dict:
    with open(filepath, "r", encoding="utf-8") as f:
        original = f.read()

    modified = original
    applied = []

    for old, new in replacements:
        if old in modified:
            modified = modified.replace(old, new)
            applied.append({"from": old, "to": new})

    if applied and not dry_run:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(modified)

    return {"file": filepath, "changes": applied, "dry_run": dry_run}


def main():
    parser = argparse.ArgumentParser(description="Bulk TypeScript import path fixer")
    parser.add_argument("--root", required=True, help="Root directory to scan for .ts files")
    parser.add_argument(
        "--replace",
        nargs=2,
        metavar=("OLD", "NEW"),
        action="append",
        required=True,
        help="Import path replacement: OLD NEW (can be repeated)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without writing to disk",
    )

    args = parser.parse_args()
    replacements = [(old, new) for old, new in args.replace]

    ts_files = find_ts_files(args.root)
    logger.info(f"Scanning {len(ts_files)} TypeScript files in '{args.root}'")

    results = []
    total_changes = 0

    for filepath in ts_files:
        result = fix_imports_in_file(filepath, replacements, args.dry_run)
        if result["changes"]:
            results.append(result)
            total_changes += len(result["changes"])
            logger.info(f"{'[DRY RUN] ' if args.dry_run else ''}Fixed {filepath}: {result['changes']}")

    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Summary: {total_changes} replacement(s) in {len(results)} file(s)")
    for r in results:
        print(f"  {r['file']}")
        for c in r["changes"]:
            print(f"    {c['from']}  →  {c['to']}")


if __name__ == "__main__":
    main()
