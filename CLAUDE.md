# Claude Code Entry Point

> **This file mirrors `AGENTS.md` (the canonical agent instruction file).** Read `AGENTS.md` for the
> full Session Start Protocol, the docs↔directives boundary, how the AI workflow actually runs, and
> the After-Task Protocol. Read `.ai/KNOWLEDGE_ARCHITECTURE.md` for how all the knowledge fits together.

## 🧠 Session Start Protocol (do this first)

1. Read `.ai/KNOWLEDGE_INDEX.md` — entire project context (overview, live status, rules, gotchas).
2. For complex tasks, search `.ai/memory/*.jsonl` (errors, gotchas, architecture, conventions).
3. Read the relevant `directives/*.md` SOP before creating/modifying code.

## 📦 Project Context — Cortex

**Cortex**: a B2B **AI-powered internal knowledge hub** (RAG + Hybrid Search via pgvector +
Elasticsearch), with an **event-sourced virtual credit economy**, reputation/gamification, realtime
(chat/notification), and **multi-tenancy**. This replaces the legacy "TeamFin" finance concept — do
NOT reintroduce expense/settlement/Splitwise framing.

Source of truth: `.ai/KNOWLEDGE_INDEX.md` → `docs/01..10` → `readme.md` / `readme.phases.md`.

## ⛔ Hard Rules (see AGENTS.md for full text)

- Never `console.log` (use `createLogger`); never `autoincrement()` PK (use UUID); never CORS `['*']`;
  never put infrastructure code in `common/`.
- Entities: UUID PK, `camelCase` code / `@map("snake_case")` DB, soft delete via `deletedAt`.
- Run TS via `turbo` (`npm run check`). `docker exec <container>` is only for infra (Postgres, nginx,
  Kafka) during smoke tests — there is no agent sandbox.
- After non-trivial work (After-Task Protocol): log a lesson to `.ai/memory/<category>.jsonl`; update
  the relevant `directives/*.md`; if the change touches schema/API/security/ops, reconcile the matching
  `docs/NN_*.md` in the **same task**; update `.ai/PROJECT_STATUS.md` if a phase/module changed. The
  `Stop` hook regenerates `.ai/KNOWLEDGE_INDEX.md` — **edit the sources, not the generated index.**
