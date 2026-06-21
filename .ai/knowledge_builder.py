#!/usr/bin/env python3
"""
Knowledge Builder — Auto-generates KNOWLEDGE_INDEX.md
=====================================================
Scans the project to produce a single, comprehensive knowledge file
that AI agents read at the start of every session.

Usage:
  python .ai/knowledge_builder.py                    # Generate KNOWLEDGE_INDEX.md
  python .ai/knowledge_builder.py --check            # Dry-run, print to stdout
  python .ai/knowledge_builder.py --migrate           # Migrate .tmp/agent_memory.json → .ai/memory/

Sources:
  1. directives/*.md    — Architecture rules, SOPs, conventions
  2. docs/*.md          — Business requirements, system design
  3. .ai/memory/*.jsonl — Categorized experience entries
  4. apps/              — Service discovery (frameworks, entry points)
  5. packages/          — Shared packages
  6. readme.md          — Project overview
"""

import os
import sys
import json
import re
import glob
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
AI_DIR = WORKSPACE_ROOT / ".ai"
MEMORY_DIR = AI_DIR / "memory"
OUTPUT_FILE = AI_DIR / "KNOWLEDGE_INDEX.md"
STATUS_FILE = AI_DIR / "PROJECT_STATUS.md"
OLD_MEMORY_FILE = WORKSPACE_ROOT / ".tmp" / "agent_memory.json"

DIRECTIVE_DIR = WORKSPACE_ROOT / "directives"
DOCS_DIR = WORKSPACE_ROOT / "docs"
APPS_DIR = WORKSPACE_ROOT / "apps"
PACKAGES_DIR = WORKSPACE_ROOT / "packages"
README_FILE = WORKSPACE_ROOT / "readme.md"

MEMORY_CATEGORIES = {
    "errors": "Error → Solution pairs (build, runtime, config issues)",
    "architecture": "Architecture decisions and pattern implementations",
    "conventions": "Coding conventions learned during development",
    "gotchas": "Framework/library gotchas and breaking changes",
}

# Keywords for auto-categorizing old memory entries
CATEGORY_KEYWORDS = {
    "architecture": [
        "hexagonal", "cqrs", "middleware", "pattern", "architecture",
        "boundary", "module", "refactor", "pipeline", "domain",
        "saga", "event sourcing", "ddd", "common/", "infrastructure/",
        "framework code", "pure pojo", "composition root",
        "rag", "pgvector", "vector", "embedding", "hybrid", "tenant",
        "multi-tenant", "idempotency", "circuit breaker", "outbox", "occ",
    ],
    "gotchas": [
        "breaking change", "v7", "v5", "deprecated", "no longer supported",
        "fastify", "logger", "loggerinstance", "-it flag", "docker",
    ],
    "conventions": [
        "naming", "folder", "code quality", "magic number", "getter",
        "bracket notation", "constant", "sop", "directive", "update",
        "tài liệu", "standard",
    ],
    # Everything else → errors (default)
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def read_text(path: Path) -> str:
    """Read a text file, return empty string if not found."""
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def extract_title(md_content: str) -> str:
    """Extract the first H1 heading from markdown content."""
    for line in md_content.splitlines():
        line = line.strip()
        if line.startswith("# "):
            return line[2:].strip()
    return "(no title)"


def extract_headings(md_content: str, max_level: int = 2) -> list[str]:
    """Extract headings up to max_level from markdown."""
    headings = []
    for line in md_content.splitlines():
        line = line.strip()
        match = re.match(r"^(#{1," + str(max_level) + r"})\s+(.+)$", line)
        if match:
            level = len(match.group(1))
            text = match.group(2).strip()
            headings.append(f"{'  ' * (level - 1)}- {text}")
    return headings


def load_jsonl(path: Path) -> list[dict]:
    """Load a JSON Lines file."""
    entries = []
    if not path.exists():
        return entries
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return entries


def save_jsonl(path: Path, entries: list[dict]):
    """Save entries to a JSON Lines file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for entry in entries:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def detect_services(apps_dir: Path) -> list[dict]:
    """Detect services in the apps/ directory and their frameworks."""
    services = []
    if not apps_dir.exists():
        return services
    for child in sorted(apps_dir.iterdir()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        info = {"name": child.name, "framework": "unknown", "has_prisma": False}

        # Detect framework from package.json
        pkg_json = child / "package.json"
        if pkg_json.exists():
            try:
                pkg = json.loads(pkg_json.read_text(encoding="utf-8"))
                deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
                if "@nestjs/core" in deps:
                    info["framework"] = "NestJS"
                elif "fastify" in deps:
                    info["framework"] = "Fastify"
            except Exception:
                pass

        # Detect Prisma
        prisma_schema = child / "prisma" / "schema.prisma"
        if prisma_schema.exists():
            info["has_prisma"] = True

        services.append(info)
    return services


def detect_packages(packages_dir: Path) -> list[str]:
    """Detect shared packages."""
    packages = []
    if not packages_dir.exists():
        return packages
    for child in sorted(packages_dir.iterdir()):
        if child.is_dir() and not child.name.startswith("."):
            packages.append(child.name)
    return packages


def detect_modules(apps_dir: Path) -> dict[str, list[str]]:
    """Map each service → feature module folders under src/modules/.

    Pure filesystem fact (which module folders exist), regenerated on every run,
    so it can never go stale. Used as a CROSS-CHECK against the curated status in
    PROJECT_STATUS.md: a mismatch means the curated file is out of date.
    """
    result: dict[str, list[str]] = {}
    if not apps_dir.exists():
        return result
    for child in sorted(apps_dir.iterdir()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        modules_dir = child / "src" / "modules"
        mods: list[str] = []
        if modules_dir.exists():
            mods = sorted(
                m.name for m in modules_dir.iterdir()
                if m.is_dir() and not m.name.startswith(".")
            )
        result[child.name] = mods
    return result


# ---------------------------------------------------------------------------
# Migration: .tmp/agent_memory.json → .ai/memory/*.jsonl
# ---------------------------------------------------------------------------
def categorize_entry(entry: dict) -> str:
    """Auto-categorize a memory entry based on keyword matching."""
    text = " ".join([
        entry.get("error", ""),
        entry.get("solution", ""),
        entry.get("context", ""),
    ]).lower()

    scores = {}
    for category, keywords in CATEGORY_KEYWORDS.items():
        scores[category] = sum(1 for kw in keywords if kw in text)

    # Return category with highest score, default to "errors"
    best = max(scores, key=scores.get)
    if scores[best] == 0:
        return "errors"
    return best


def migrate_memory():
    """Migrate from flat JSON to categorized JSONL files."""
    if not OLD_MEMORY_FILE.exists():
        print(f"[SKIP] Old memory file not found: {OLD_MEMORY_FILE}")
        return

    try:
        old_data = json.loads(OLD_MEMORY_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[ERROR] Failed to read old memory: {e}")
        return

    MEMORY_DIR.mkdir(parents=True, exist_ok=True)

    # Categorize entries
    categorized: dict[str, list] = {cat: [] for cat in MEMORY_CATEGORIES}
    for entry in old_data:
        cat = categorize_entry(entry)
        categorized[cat].append(entry)

    # Save each category
    total = 0
    for cat, entries in categorized.items():
        if entries:
            save_jsonl(MEMORY_DIR / f"{cat}.jsonl", entries)
            print(f"  [{cat}.jsonl] {len(entries)} entries")
            total += len(entries)

    print(f"\n[DONE] Migrated {total} entries from agent_memory.json → .ai/memory/")
    print(f"  Original file preserved at: {OLD_MEMORY_FILE}")


# ---------------------------------------------------------------------------
# Knowledge Index Generation
# ---------------------------------------------------------------------------
def build_index() -> str:
    """Build the complete KNOWLEDGE_INDEX.md content."""
    now = datetime.now(timezone.utc).isoformat()
    sections = []

    # ── Header ──
    sections.append(f"""# 🧠 Project Knowledge Index
> **Auto-generated by `.ai/knowledge_builder.py`**
> Last updated: {now}
> 
> This file is the **single source of truth** for AI agents working on this project.
> Read this FIRST at the start of every session before writing any code.

---""")

    # ── 1. Project Overview ──
    readme_content = read_text(README_FILE)
    project_name = "Cortex — AI-Powered Team Knowledge Hub"
    services = detect_services(APPS_DIR)
    packages = detect_packages(PACKAGES_DIR)

    service_lines = []
    for s in services:
        prisma_tag = " + Prisma" if s["has_prisma"] else ""
        service_lines.append(f"  - `{s['name']}` — {s['framework']}{prisma_tag}")

    package_lines = [f"  - `{p}`" for p in packages]

    sections.append(f"""## 1. Project Overview

- **Name**: {project_name}
- **Product**: B2B internal Knowledge Hub — AI Discovery (RAG + Hybrid Search), virtual credit economy, multi-tenancy. (Legacy "TeamFin" finance concept is RETIRED — do not reintroduce expense/settlement framing.)
- **Type**: Monorepo (Turborepo) + TypeScript
- **Architecture**: Hexagonal Architecture + CQRS + Event Sourcing + RAG/Hybrid Search + Multi-tenancy
- **Phase**: Phase 0 (Foundation) ✅ — Phase 1 (Multi-tenant Knowledge Monolith) IN PROGRESS (see §2 for live status)
- **Services** (`apps/`):
{chr(10).join(service_lines)}
- **Shared Packages** (`packages/`):
{chr(10).join(package_lines)}
- **Database**: PostgreSQL + pgvector via Prisma v7, port `15432` (Event Store + Read Model + Embeddings)
- **Cache**: Redis (cache, rate-limit, pub/sub)
- **Message Broker**: Kafka (Event Backbone, KRaft mode)
- **Search**: Elasticsearch (full-text) + pgvector (semantic) → Hybrid Retrieval (RRF)
- **AI**: Claude (embedding + RAG summarization) via Circuit Breaker
- **Frontend**: Vite + React 18 + Zustand + TanStack Query + TailwindCSS v3""")

    # ── 2. Implementation Status ──
    modules_map = detect_modules(APPS_DIR)
    detected_lines = []
    for svc, mods in modules_map.items():
        mods_str = ", ".join(f"`{m}`" for m in mods) if mods else "_(no src/modules)_"
        detected_lines.append(f"- **{svc}**: {mods_str}")

    curated = read_text(STATUS_FILE).strip()
    curated_block = curated if curated else (
        "_No curated status yet — create `.ai/PROJECT_STATUS.md` and re-run this builder._"
    )

    sections.append(f"""## 2. Implementation Status

> **Where the project actually is.** Check this BEFORE reading source to gauge progress.
>
> - **Curated** (phase %, current focus, next task) lives in `.ai/PROJECT_STATUS.md` and is injected verbatim below. Update it as part of the After-Task Protocol whenever a module/phase changes.
> - **Auto-detected** module map is scanned fresh from `apps/*/src/modules/` on every regenerate — it can NEVER go stale.
> - ⚠️ **Cross-check:** if the curated status claims a module is done but it's missing from the auto-scan (or vice-versa), the curated file is STALE — reconcile it before trusting the numbers.

{curated_block}

### 🔍 Auto-detected modules (filesystem ground truth)

{chr(10).join(detected_lines) if detected_lines else "_No services found._"}""")

    # ── 3. Architecture Rules ──
    directive_entries = []
    if DIRECTIVE_DIR.exists():
        for md_file in sorted(DIRECTIVE_DIR.glob("*.md")):
            if md_file.name == "README.md":
                continue
            content = read_text(md_file)
            title = extract_title(content)
            directive_entries.append((md_file.name, title, content))

    rules_lines = []
    for fname, title, content in directive_entries:
        rules_lines.append(f"\n### 📄 `directives/{fname}` — {title}\n")
        headings = extract_headings(content, max_level=3)
        if headings:
            rules_lines.append("Key sections:")
            for h in headings[:15]:  # Cap at 15 headings
                rules_lines.append(h)

    sections.append(f"""## 3. Architecture Rules & SOPs (from `directives/`)

> These are the **immutable directives** that govern all code in this project.
> When in doubt, the directive file is the authority.
{"".join(rules_lines)}""")

    # ── 3. Critical Rules Quick-Reference ──
    sections.append("""## 4. Critical Rules Quick-Reference

These are the most frequently needed rules, extracted from directives:

### Folder Structure (`folder_structure_sop.md`)
```
src/
├── @types/           # Augmented global types
├── bootstrap/        # App wiring: server, plugins, swagger
├── common/           # ABSTRACTIONS ONLY — NO infrastructure code
│   ├── cqrs/         # Pure POJO command/query bus & middlewares
│   ├── database/     # DB abstractions (ITransactionManager, AsyncLocalStorage context)
│   └── errors/       # Domain/Application error base classes
├── config/           # Env loading & validation (Zod)
├── container/        # Manual DI wiring (Fastify only, NestJS uses Modules)
├── infrastructure/   # Concrete implementations (Prisma, Fastify hooks, Pino logger)
├── modules/          # Feature modules by domain
│   └── <domain>/
│       ├── domain/           # Entities, Value Objects, Repo Interfaces (PURE TS)
│       ├── application/      # Command/Query Handlers (orchestration via interfaces)
│       ├── infrastructure/   # Concrete repos (PrismaXxxRepository), mappers
│       └── presentation/     # Routes/Controllers, Zod schemas
├── app.ts            # Root app factory (createApp)
├── main.ts           # Local entrypoint (listen)
└── main.lambda.ts    # AWS Lambda entrypoint
```

### CQRS Pipeline (`cqrs_pattern.md`)
- Pipeline order: `LoggingMiddleware → RetryMiddleware → TransactionMiddleware → Handler`
- Retry wraps Transaction → each retry gets a fresh DB transaction
- Commands opt-in via `options: { transactional: true, retryable: true }`
- TransactionMiddleware uses `ITransactionManager` (abstract) + `AsyncLocalStorage`
- Repositories use `getTx() ?? this.prisma` — zero signature changes

### Database (`database_standard.md`)
- Primary keys: UUID (`@default(uuid())`), NEVER `autoincrement()`
- Naming: camelCase in code, `@map("snake_case")` in DB
- Soft delete: `deletedAt DateTime?` for important models
- Prisma v7: NO `url` in `schema.prisma`, use `prisma.config.ts`
- Port: `15432` (not default 5432)

### Testing (`testing_standard.md`)
- Co-location: `*.spec.ts` next to source file
- Mock pattern: `jest.Mocked<Interface>` with `as unknown as` cast
- ESM libraries: `jest.mock('uuid', () => ({ v7: jest.fn(() => 'mock-uuid') }))`
- Path alias: `@/` mapped via `moduleNameMapper`

### Validation (`zod_validation.md`)
- Zod is the ONLY validation library (no class-validator, no typebox)
- Schema location: `modules/<module>/presentation/schemas/<action>.schema.ts`

### Logging (`logging_standard.md`)
- Dual-layer: HTTP hooks + CQRS LoggingMiddleware
- Use `createLogger(serviceName)` from shared-kernel
- NEVER `console.log`

### Security
- CORS origins from env vars, NEVER `['*']`
- Mandatory: `@fastify/helmet`, `@fastify/compress`, `@fastify/rate-limit`""")

    # ── 4. Known Gotchas & Lessons ──
    all_memory = []
    if MEMORY_DIR.exists():
        for jsonl_file in sorted(MEMORY_DIR.glob("*.jsonl")):
            entries = load_jsonl(jsonl_file)
            for e in entries:
                e["_category"] = jsonl_file.stem
            all_memory.extend(entries)

    # Fallback: read from old memory if no JSONL yet
    if not all_memory and OLD_MEMORY_FILE.exists():
        try:
            old_data = json.loads(OLD_MEMORY_FILE.read_text(encoding="utf-8"))
            all_memory = old_data
        except Exception:
            pass

    gotcha_lines = []
    for entry in all_memory:
        error = entry.get("error", "").strip()
        solution = entry.get("solution", "").strip()
        context = entry.get("context", "").strip()
        if error and solution:
            ctx_tag = f" `[{context}]`" if context else ""
            gotcha_lines.append(f"- **{error}**{ctx_tag}\n  → {solution}")

    sections.append(f"""## 5. Known Gotchas & Lessons Learned (from memory)

> These are real problems encountered during development.
> Search this section BEFORE debugging to avoid repeating mistakes.

{chr(10).join(gotcha_lines) if gotcha_lines else "_No memory entries yet._"}""")

    # ── 5. Business Domain ──
    doc_entries = []
    if DOCS_DIR.exists():
        for md_file in sorted(DOCS_DIR.glob("*.md")):
            content = read_text(md_file)
            title = extract_title(content)
            doc_entries.append((md_file.name, title))

    doc_lines = [f"- `docs/{fname}` — {title}" for fname, title in doc_entries]

    sections.append(f"""## 6. Business Domain Documentation (from `docs/`)

> Read these files when you need business context for a feature.

{chr(10).join(doc_lines) if doc_lines else "_No docs found._"}""")

    # ── 6. Agent Operating Protocol ──
    sections.append("""## 7. Agent Operating Protocol

### Session Start (MANDATORY)
1. ✅ Read this file (`KNOWLEDGE_INDEX.md`) — you are doing this now
2. ✅ For complex tasks: search `.ai/memory/*.jsonl` for related issues
3. ✅ Read the relevant `directives/*.md` file before creating/modifying code

### After Completing Work
1. Log new lessons: append to `.ai/memory/<category>.jsonl`
2. If a new convention/pattern was established: update the relevant `directives/*.md`
3. If a change resolves/contradicts a `docs/*.md` file (review finding, API contract, schema): update that doc too
4. If a module/phase changed state: update `.ai/PROJECT_STATUS.md` (drives §2)
5. Re-run `knowledge_builder.py` (via `docker exec agent-sandbox python .ai/knowledge_builder.py`) so §2 + memory refresh

### Memory Categories
| File | Purpose |
|---|---|
| `.ai/memory/errors.jsonl` | Error → Solution pairs |
| `.ai/memory/architecture.jsonl` | Architecture decisions |
| `.ai/memory/conventions.jsonl` | Coding conventions |
| `.ai/memory/gotchas.jsonl` | Framework/library gotchas |

### Forbidden Actions
- ❌ Never run `python` or `node` directly on host — use `docker exec agent-sandbox`
- ❌ Never use `-it` flag in automated docker exec commands
- ❌ Never put infrastructure code in `common/`
- ❌ Never use `console.log` — use structured logger
- ❌ Never use `autoincrement()` for primary keys
- ❌ Never use CORS wildcard `['*']`""")

    return "\n\n".join(sections) + "\n"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    args = sys.argv[1:]

    if "--migrate" in args:
        print("=== Migrating Memory ===")
        migrate_memory()
        return

    content = build_index()

    if "--check" in args:
        print(content)
        print(f"\n--- Preview only (--check). File NOT written. ---")
        return

    # Write the index
    AI_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(content, encoding="utf-8")
    print(f"[DONE] Generated {OUTPUT_FILE}")
    print(f"  Size: {len(content):,} bytes")
    print(f"  Timestamp: {datetime.now(timezone.utc).isoformat()}")


if __name__ == "__main__":
    main()
