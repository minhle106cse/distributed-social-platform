# Claude Code Entry Point

> **This file mirrors `AGENTS.md` (the canonical agent instruction file).** Claude Code auto-loads
> *only this file* at session start — `AGENTS.md` is not read unless you open it yourself — so the
> decision-relevant parts (Task Classification, Citation Protocol, Session Start Protocol, Hard
> Rules) are duplicated here in full, not linked. Edit `AGENTS.md` first, then port the same change
> here in the same task — a change that lands in one and not the other is silent drift, nothing
> checks for it except `scripts/sync.cjs`'s warn-only reminder. What's genuinely CLAUDE.md-only-by-
> reference (the docs↔directives boundary table, hook internals, the docs forcing-function detail):
> read `AGENTS.md`. For how all the knowledge fits together: `.ai/KNOWLEDGE_ARCHITECTURE.md`.

## 🧠 Session Start Protocol (do this first)

1. Read `.ai/KNOWLEDGE_INDEX.md` (~8k tokens) — project context: overview, live status, directive
   and docs maps.
2. **Only when debugging** (or designing where you may have burned before): `.ai/GOTCHAS.md`
   (~21k). Skip it for questions and small fixes. Untruncated text: `grep .ai/memory/*.jsonl`.
3. Read the relevant `directives/*.md` SOP before creating/modifying code.

**Which of the above a task actually needs — don't over- or under-read:**

| Task | `KNOWLEDGE_INDEX` (~8k) | `GOTCHAS.md` (~21k) | Directive (~5k ea.) |
|---|---|---|---|
| Question / explain / review code | ✅ | ❌ | if area-specific |
| Small fix / format / comment | ✅ | ❌ | — |
| Debug build/test/runtime error | ✅ | ✅ | — |
| Design a pattern / refactor architecture | ✅ | ✅ | ✅ |
| Implement a complex new feature | ✅ | ✅ | ✅ |

The ❌ are deliberate, not laziness — gotchas are a *"have I hit this before?"* lookup, useless on a
question or a typo fix.

**Plans must cite sources.** Any implementation plan MUST have a "References & Compliance" section
listing which `directives/*.md` and `docs/NN_*.md` you actually read and where each decision came
from. A plan missing this may be rejected outright.

## 📦 Project Context — Cortex

**Cortex**: a B2B **AI-powered internal knowledge hub** (RAG + Hybrid Search via pgvector +
Elasticsearch), with an **event-sourced virtual credit economy**, reputation/gamification, realtime
(chat/notification), and **multi-tenancy**. This replaces the legacy "TeamFin" finance concept — do
NOT reintroduce expense/settlement/Splitwise framing.

Source of truth: `.ai/KNOWLEDGE_INDEX.md` → `docs/01..10` → `readme.md` / `readme.phases.md`.

## ⛔ Hard Rules (see AGENTS.md for full text)

- Never `console.log` (use `createLogger`); never `autoincrement()` PK (use UUID); never CORS `['*']`;
  never put infrastructure code in `common/`.
- Repo interface placement is NOT by eye: write port → `domain/repositories/`; read port →
  `domain/repositories/` only if a `domain/` file imports it, else `application/repositories/`
  (`<module>.query-repository.ts`). 2-step rule in `directives/cqrs_pattern.md`, enforced by
  `npm run check:arch`.
- Entities: UUID PK, `camelCase` code / `@map("snake_case")` DB, soft delete via `deletedAt`.
- Run TS via `turbo` (`npm run check`). `docker exec <container>` is only for infra (Postgres, nginx,
  Kafka) during smoke tests — there is no agent sandbox.
- After non-trivial work (After-Task Protocol): log a lesson to `.ai/memory/<category>.jsonl`; update
  the relevant `directives/*.md`; if the change touches schema/API/security/ops, reconcile the matching
  `docs/NN_*.md` in the **same task**; update `.ai/PROJECT_STATUS.md` if a phase/module changed. The
  `Stop` hook regenerates `.ai/KNOWLEDGE_INDEX.md` — **edit the sources, not the generated index.**
