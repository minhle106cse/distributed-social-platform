# Claude Code Entry Point

> **This file mirrors `AGENTS.md` (the canonical agent instruction file).** Read `AGENTS.md` for the full Layered Architecture, Session Start Protocol, and Rules #0–#3.

## 🧠 Session Start Protocol (MANDATORY — DO THIS FIRST)

1. Read `.ai/KNOWLEDGE_INDEX.md` — entire project context (architecture, conventions, gotchas).
2. For complex tasks, search `.ai/memory/*.jsonl` (errors, gotchas, architecture, conventions).
3. Read the relevant `directives/*.md` SOP before creating/modifying code.

## 📦 Project Context — Cortex

The product is **Cortex**: a B2B **AI-powered internal knowledge hub** (RAG + Hybrid Search via pgvector + Elasticsearch), with an **event-sourced virtual credit economy**, reputation/gamification, realtime (chat/notification), and **multi-tenancy**. This replaces the legacy "TeamFin" finance concept — do NOT reintroduce expense/settlement/Splitwise framing.

Source of truth: `.ai/KNOWLEDGE_INDEX.md` → `docs/01..10` → `readme.md` / `readme.phases.md`.

## ⛔ Hard Rules (see AGENTS.md for full text)
- Never run `python`/`node` directly on host — use `docker exec agent-sandbox python ...` (no `-it`).
- Never put infrastructure code in `common/`; never `console.log`; never `autoincrement()` PK; never CORS `['*']`.
- After non-trivial work: log lessons to `.ai/memory/<category>.jsonl` and update the relevant `directives/*.md`.
