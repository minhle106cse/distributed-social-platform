# Agent Instructions — Cortex

> **AGENTS.md is the canonical agent instruction file.** `CLAUDE.md` is a thin pointer so the same
> instructions load in any AI environment. Edit instructions here.
>
> For the full picture of how this project's knowledge is organized — what goes in `docs/` vs
> `directives/` vs `.ai/` vs agent memory, and the rules that keep them from rotting — read
> **`.ai/KNOWLEDGE_ARCHITECTURE.md`** (the meta-doc). This file is the operating summary.

## 📦 Project Context — Cortex (AI-Powered Team Knowledge Hub)

**Cortex** is a B2B **internal knowledge hub** for teams/companies: **AI Discovery (RAG + Hybrid
Search)**, an **event-sourced virtual credit economy**, reputation/gamification, realtime
(chat/notification), and **multi-tenancy**. (This replaces the legacy "TeamFin" finance concept — do
NOT reintroduce expense/settlement/Splitwise framing.)

Business → infrastructure mapping is intentional: **pgvector** (semantic search), **Elasticsearch**
(full-text → hybrid), **Kafka** (Outbox + re-index/re-embed events), **Redis** (cache, rate-limit,
pub/sub), **chat/notification services** (realtime + AI assistant). Patterns showcased: Event Sourcing
(credit ledger), CQRS, Saga (AI-query/bounty), Outbox, Idempotency, OCC, Circuit Breaker (around
Claude), Rate Limiting, Tenant Isolation.

- **Stack**: Turborepo monorepo, TypeScript. NestJS services (core-api, notification, search, worker)
  + Fastify (auth-service) + Vite/React 18 web. PostgreSQL+pgvector (Prisma v7, port `15432`), Kafka
  (KRaft), Redis, Elasticsearch. Embeddings **self-hosted** (Ollama `nomic-embed-text`, 768-dim —
  Claude has no embeddings API); RAG summarization via **Claude** behind a Circuit Breaker.
- **Source of truth for product/business**: `.ai/KNOWLEDGE_INDEX.md` → then the specific
  `docs/NN_*.md` → `readme.md` / `readme.phases.md`.
- `SETUP.md` records **how this codebase was built** so a new project with the same scaffolding but
  empty business can be bootstrapped later. Cortex itself is a real project, not a template.

## 🧠 Session Start Protocol (do this first)

1. **Read `.ai/KNOWLEDGE_INDEX.md`** — the whole project context (overview, live status, directive
   map, docs map). **~8k tokens**, one read instead of grepping the codebase blind.
2. **When debugging, or designing in an area you may have burned on before** — read
   `.ai/GOTCHAS.md` (~21k tokens, generated, newest first). **Not** for questions or small fixes.
   Need the untruncated text of an entry? `grep` `.ai/memory/*.jsonl`.
3. **Before creating/modifying code**, read the relevant `directives/*.md` for that area
   (~5k tokens each — read the one that applies, not the set).

> **Budget honestly.** Full compliance costs ~13k tokens before any work starts, ~34k if you also
> pull gotchas. That is cheap insurance on an architecture task and pure waste on a typo fix — the
> table under *Task Classification* below says which is which. Gotchas used to be inlined in the
> index (63% of its bytes, read every session even for trivial tasks); split out 2026-08-07.

> The `UserPromptSubmit` hook (`.claude/hooks/turn-context.cjs`) injects **turn-local state** —
> branch, uncommitted paths (submodules included), outstanding After-Task debt — plus a one-line
> routing pointer. It deliberately does **not** restate this file: a hook that repeats a static rule
> the model has already read changes nothing (measured 2026-08-07), so it carries only what
> `CLAUDE.md` cannot. Still a nudge, not a substitute for step 3.

## 🗂️ How this project's knowledge is organized (the boundary that matters)

Two families of Markdown, split by **purpose**, not by "who reads it" (agents and humans read both):

| | `docs/` — **Design & Spec** (the WHAT & WHY) | `directives/` — **SOP & Rules** (the HOW) |
|---|---|---|
| Answers | "What is the system, why does it exist, what must it do, how is it run/secured?" | "When I write code, what rule must I not violate?" |
| Reader intent | Understand / operate / deploy / audit the system | Execute — write code that complies |
| Style | Complete, narrative, diagrams, tables, rationale, audit trail | Terse, imperative, litmus-driven, lists 'known exceptions' |
| Changes when | Requirements / architecture intent / API contract / schema / ops posture changes | A convention or pattern is established or refined |
| Litmus | *"Would a new engineer need this to understand or run the system?"* → `docs/` | *"Would an agent about to write a file violate something without this?"* → `directives/` |

`.ai/` is the **machine-maintained knowledge layer** (generated index + curated status + experience
buffer). Agent **memory** (`~/.claude/.../memory/`) holds **who the user is + how they want me to
work** — never project facts that belong in the repo. Full routing rules: `.ai/KNOWLEDGE_ARCHITECTURE.md`.

## ⚙️ How the AI workflow actually runs (no Python sandbox — that was removed)

Two Claude Code hooks (`.claude/settings.json`) automate the loop:

- **`UserPromptSubmit` → `.claude/hooks/turn-context.cjs`** — injects branch + uncommitted paths
  (descending into the `apps/*` submodules) + After-Task debt, ~130 tokens. State, not prose.
- **`Stop` → `scripts/sync.cjs`** — after every response, detects what changed and runs only what's
  needed: rebuild `shared-kernel` (if its `src/` changed), `prisma generate` (if a schema changed),
  and **regenerate `.ai/KNOWLEDGE_INDEX.md`** (if `directives/`, `docs/`, `.ai/memory/`, or
  `PROJECT_STATUS.md` changed). It also **BLOCKS the turn from ending** (`decision: "block"`) when
  source files changed with no newer `.ai/memory` / `PROJECT_STATUS` entry — After-Task is the one
  protocol step with real teeth. It blocks at most **once per code state** (guard file
  `.ai/.after-task-guard`); if an entry genuinely isn't warranted, say so explicitly and stop.
  Worktree-topology warnings stay warn-only and go to the user.

`.ai/knowledge_builder.py` is the generator; `sync.cjs` runs it with **host `python`** (it probes
`python`/`python3`/`py`). Run TypeScript via **`turbo`** (`npm run check` = `typecheck lint
format:check`). Use `docker exec <container>` only to reach **infra containers** (Postgres, nginx,
Kafka) during smoke tests — there is no agent sandbox and nothing here needs one.

## ⛔ Hard Rules (real, enforced)

- **Never** `console.log` — use the structured logger (`createLogger` from shared-kernel).
- **Never** `autoincrement()` primary keys — UUID (`@default(uuid())`).
- **Never** CORS wildcard `['*']` — origins from env.
- **Never** put infrastructure code in `common/` — `common/` is abstractions only (see
  `directives/folder_structure_sop.md`; layer boundaries are lint-enforced in core-api).
- **Never** place a repository interface by eye. Write port (has a mutating method) →
  `domain/repositories/`. Read-only port → `domain/repositories/` **only if** a `domain/` file
  imports it, else `application/repositories/` as `<module>.query-repository.ts`. Full 2-step
  procedure: `directives/cqrs_pattern.md`; **machine-checked by `npm run check:arch`** across all
  4 services (the eslint layer boundaries only cover core-api, and only alias-form imports).
- Entities: UUID PK, `camelCase` in code / `@map("snake_case")` in DB, soft delete via `deletedAt`.
- Zod is the **only** input-validation library, only at the boundary (`presentation/schemas/`).

## 🧭 Task Classification

| Task | `KNOWLEDGE_INDEX` (~8k) | `GOTCHAS.md` (~21k) | Directive (~5k ea.) |
|---|---|---|---|
| Question / explain / review code | ✅ | ❌ | if area-specific |
| Small fix / format / comment | ✅ | ❌ | — |
| Debug build/test/runtime error | ✅ | ✅ | — |
| Design a pattern / refactor architecture | ✅ | ✅ | ✅ |
| Implement a complex new feature | ✅ | ✅ | ✅ |

The ❌ are deliberate, not laziness: gotchas are a *"have I hit this before?"* lookup and buy
nothing on a question or a typo fix.

## 📎 Citation Protocol (plans must cite their sources)

Any implementation plan you generate MUST contain a **"References & Compliance"** section listing
exactly which `directives/*.md` SOP files and which `docs/NN_*.md` business files you read, and where
each decision's logic came from. A plan missing this section may be rejected outright. This exists to
keep plans grounded in the project's actual rules instead of improvised ones.

## 📝 After-Task Protocol (run every non-trivial task — don't wait to be asked)

1. **Log the lesson** — append one JSON line to the right `.ai/memory/<category>.jsonl`:
   - `errors.jsonl` — build/test/runtime error → solution
   - `architecture.jsonl` — design decisions (reactive **and** proactive "chose A over B")
   - `conventions.jsonl` — new coding conventions
   - `gotchas.jsonl` — framework/library gotchas
   - Canonical format (one shape for all four files):
     `{"timestamp","type","title","detail","context"}` — `context` optional. For a decision, the
     choice goes in `title`, the rationale + rejected alternatives in `detail`. Legacy shapes still
     render; don't migrate them. Full rules: `directives/memory_sop.md`.
2. **Update the rule** — if a convention/pattern was established or refined, edit the relevant
   `directives/*.md` **now**, not later.
3. **Reconcile the spec (the docs forcing-function)** — if the change touches **schema, API contract,
   security/RBAC, or ops/devops posture**, update the matching living-spec doc *in the same task*:
   `docs/04_database_schema.md`, `docs/06_api_contracts.md`, `docs/10_security_rbac.md`,
   `docs/09_devops_infrastructure.md`, `docs/03_system_architecture_diagrams.md`. **Do not leave a
   design doc contradicting the code.** (Stable-intent docs — 01 business, 02 use-cases, 05 UI/UX, 07
   design-system — only change when the intent itself changes.)
4. **Update live status** — if a module/phase changed, edit `.ai/PROJECT_STATUS.md` (short
   current-state only; the long history lives in `.ai/CHANGELOG.md`).
5. The `Stop` hook then regenerates `.ai/KNOWLEDGE_INDEX.md` automatically. Only run
   `python .ai/knowledge_builder.py` by hand if you need to see the regenerated index immediately.

*Be pragmatic. Be reliable. Keep the docs honest.*
