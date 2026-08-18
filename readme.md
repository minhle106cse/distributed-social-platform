# 🧠 CORTEX — AI-POWERED TEAM KNOWLEDGE HUB

[![Architecture](https://img.shields.io/badge/Architecture-Hexagonal%20%7C%20CQRS%20%7C%20Event--Sourcing-blue)](#-advanced-architecture-showcase)
[![AI](https://img.shields.io/badge/AI-RAG%20%7C%20pgvector%20%7C%20Hybrid%20Search-purple)](#8--discovery-intelligence-rag--hybrid-retrieval)
[![Progress](https://img.shields.io/badge/Progress-Phase%204%20(RAG%20Live)%20·%20~83%25-brightgreen)](#-project-progress)
[![License](https://img.shields.io/badge/License-MIT-green)](#)

🇬🇧 English · [🇻🇳 Tiếng Việt](readme.vi.md)

## 📖 DOCUMENTATION INDEX

> The documents below are written in Vietnamese; see [Documentation language convention](#documentation-language-convention).

| # | Document | Description |
|---|----------|-------------|
| 💼 | [Business Requirements](./docs/01_business_requirements.md) | The 5 pillars: Knowledge, AI Discovery, Credit Economy, Reputation, Multi-tenancy |
| 📋 | [Use Cases](./docs/02_use_cases.md) | Detailed User ↔ System interaction flows |
| 🏗️ | [Architecture & Flow Diagrams](./docs/03_system_architecture_diagrams.md) | Topology, the RAG pipeline, sequence diagrams, data flow |
| 💾 | [Database Schema](./docs/04_database_schema.md) | Prisma schema, Event Store, Read Model, pgvector embeddings |
| 🎨 | [UI/UX Standards](./docs/05_web_ui_ux_guidelines.md) | Search-first UX, RAG answer + citations, the credit wallet |
| 📡 | [API Contracts](./docs/06_api_contracts.md) | RESTful endpoints, idempotency, tenant scoping |
| 🧩 | [Design System](./docs/07_design_system_assets.md) | Colour tokens, typography, spacing, component specs |
| 🧪 | [Testing Strategy](./docs/08_testing_and_qa_strategy.md) | Ledger integrity, AI-Saga refund, tenant isolation |
| ☁️ | [DevOps Infrastructure](./docs/09_devops_infrastructure.md) | Monorepo, Docker Compose, observability |
| 🛡️ | [Security & RBAC](./docs/10_security_rbac.md) | Multi-tenant RBAC, the AI data boundary, rate limiting |
| 🚀 | [Execution Roadmap](./readme.phases.md) | The 9-phase roadmap (0-8): Monolith → Microservices |

---

## 🧠 PROJECT VISION

**Cortex** is an AI-equipped **internal knowledge hub for a team/company**, built on an enterprise-grade distributed architecture.

### The real-world problem

An organisation's knowledge is **scattered everywhere** — Slack, Notion, Google Drive, Confluence, and most importantly: **inside a few key people's heads**. The daily consequences:

- 🔍 **"Who knows about this?"** — the same question asked over and over; new joiners take weeks to onboard.
- 📄 **Dead documents** — written once, then never found again; keyword search fails because nobody remembers the exact term.
- 🧠 **Bus factor** — one person leaves and an entire area of knowledge disappears with them.
- 😮‍💨 **Nobody wants to document** — because "nobody reads it anyway".

The existing solutions (Glean, Notion AI, Confluence) prove this is a real market. **Cortex** solves the same problem but with a properly enterprise architecture — **RAG + Hybrid Search, Event Sourcing, CQRS, Saga** — because once you are handling **knowledge + AI that costs real money + data belonging to many organisations**, every distributed pattern becomes **mandatory**, not decorative.

### Why this project "shows off" system design

The core philosophy: **each business requirement FORCES a system design pattern** — no pattern here is decoration.

| Business requirement | The mandatory system design pattern |
|---|---|
| Credits (bought with real money) must be auditable, never off by a cent | **Event Sourcing** (an immutable ledger) |
| Reading/searching knowledge happens 1000x more than writing it | **CQRS** (read/write separation) |
| Spending credits to call the AI → a refund if the AI fails | **Saga Pattern** (a distributed transaction) |
| Writing a document + emitting a re-index/re-embed event must be atomic | **Outbox Pattern** |
| Pressing "Ask AI" twice because of lag | **Idempotency Key** |
| Two people editing the same runbook (wiki) | **Optimistic Concurrency Control** |
| The AI/embedding provider (Claude) goes down | **Circuit Breaker + Fallback** |
| One hot question searched by 500 people simultaneously | **Cache + Stampede Prevention** |
| AI calls are EXPENSIVE → abuse prevention | **Rate Limiting (Token Bucket)** |
| A worker's re-index fails | **Dead Letter Queue + Retry** |
| Finding documents by MEANING, not by keyword | **Vector Search (pgvector)** |
| Full-text search + filters + facets | **Elasticsearch (Hybrid Retrieval)** |
| Each organisation's data isolated, with its own quota, immune to noisy neighbours | **Multi-tenancy** |

---

## 🏗️ ARCHITECTURAL PHILOSOPHY: MODULAR MONOLITH FIRST

### Core strategy
Start with a strict **Modular Monolith**, and split into **Microservices** only when genuinely necessary — or to demonstrate the migration itself.

### The reasoning
- **Avoiding over-engineering**: full microservices from day one bring network latency, distributed-transaction headaches, and unnecessary infrastructure cost.
- **Migration skill**: one of the most valuable senior skills is knowing how to *break a monolith apart safely (zero-downtime migration)*. This project demonstrates that in Phase 7 — extracting `discovery-service` (an AI-bound workload needing isolated scaling and cost).

---

## 🧭 SYSTEM ARCHITECTURE (CURRENT STATE)

```
              Client (React SPA — Search-first UI + Admin)
                              |
                              v
                    API Gateway / Ingress (Nginx)
                              |
              +---------------+----------------+
              |                                |
              v                                v
       [Auth Service]              [Core API (Modular Monolith)]
       (Fastify Microservice)      ├── tenant-module      (org/workspace, quota)
       JWT · RBAC ·                ├── knowledge-module   (docs/Q&A, OCC, versioning)
       Multi-tenant scope          ├── taxonomy-module    (spaces, tags)
              |                     ├── engagement-module  (vote/accept/verify)
              |                     ├── discovery-module   (Hybrid Search + RAG)
              |                     ├── credit-module      (Event-sourced ledger)
              |                     ├── reputation-module  (badges, gamify)
              |                     └── feed-module        (Read Model)
              v                                |
       [DB: auth_db]            [DB: core_db (Event Store + Read Model + pgvector)]
                                               |
                                               v
                                        [Outbox Table]
                                               |
 =========================================================================
  🌊 KAFKA EVENT STREAMING BACKBONE (CloudEvents 1.0 · Outbox HA · DLQ)
 =========================================================================
        |                        |                        |
        v                        v                        v
  [Search Service ✅]      [Notification Svc ✅]     [Worker / Chat ⏳]
  (consumer #2 — own       (consumer #1 — own        (scaffold: digest,
   search_db: embed-on-     notification_db:          stale-detect, WS
   publish → pgvector +     fan-out NEW_IN_SPACE,     realtime, AI
   ES · Hybrid RRF · RAG    follower projection,      assistant — future)
   Claude/Gemini + CB)      REST + mark-read)
```
> Status note: `discovery` is NOT inside core-api as the original drawing showed — Phase 4 produced `search-service` directly as an own-DB microservice (see readme.phases §Phase 7 re-anchor). `worker-service`/`chat-service` are still scaffolds.

---

## 🧱 BOUNDARIES & EXTRACTION STRATEGY

### 1. `core-api` (the heart of the system — a Modular Monolith)

Holds all the business logic. Data shares one PostgreSQL database but is clearly divided by schema/table. NO cross-domain JOINs except through an interface.

**Modules:**
- **`tenant-module`** — Organization, Workspace, membership, per-tenant configuration & quota.
- **`knowledge-module`** — Document/Question/Answer/Runbook/ADR. Wiki-style with OCC + versioning. An immutable content ledger via events.
- **`taxonomy-module`** — Spaces/Collections, tags/topics, subscriptions.
- **`engagement-module`** — Vote, accept answer, verify (marking something "confirmed"), bookmark, follow.
- **`discovery-module`** — **Hybrid Search**: Elasticsearch (full-text) + pgvector (semantic) + RAG orchestration, answering questions with source citations.
- **`credit-module`** — **An event-sourced ledger**: purchase / spend / stake / award / refund credits. A saga guarantees atomicity.
- **`reputation-module`** — Reputation points + badges, gamifying knowledge contribution.
- **`feed-module`** — A read model (materialised view): "New in your Spaces", trending, digests.

### 2. Services separated from the start (Microservices)

- **`auth-service`** (Fastify) — Complete security isolation. JWT, passwords, refresh-token rotation, org-scoped RBAC.
- **`notification-service`** — WebSocket (real-time) + push notifications. Scales horizontally with the Redis Pub/Sub adapter.
- **`worker-service`** — Background jobs: **embedding generation**, re-index, AI summarization, digest email, stale-document detection, badge cron.
- **`search-service`** — Listens to Kafka and indexes documents into Elasticsearch.
- **`chat-service`** — Real-time discussion + an **AI Assistant (RAG chatbot)** + presence.

### 3. Future migration target (Phase 7)

Once the system is stable, perform **The Great Migration**: extracting `discovery-module` into a standalone `discovery-service`. The reason: AI/vector workloads are **resource-constrained (AI-bound), expensive, and bursty** — they need separate scaling and isolated cost. *(An alternative for showcasing ACID: extracting `credit-ledger-service`.)*

---

## 🔥 ADVANCED ARCHITECTURE (SHOWCASE)

### 1. Hexagonal Architecture (Ports & Adapters)

An absolute boundary between business logic and infrastructure:

- **`common/` (pure POJO):** abstractions, interfaces, domain types. Absolutely NO framework code (NestJS) or ORM code (Prisma).
- **`infrastructure/`:** concrete adapter implementations (the Prisma client, framework decorators, interceptors).
- **Dependency injection:** injected from `infrastructure/` into `modules/` through interfaces defined in `common/`.

### 2. In-house CQRS (Command Query Responsibility Segregation)

A hand-built **CQRS bus completely independent of any framework** (not using `@nestjs/cqrs`):

- Runs smoothly on both **NestJS** (`core-api`) and **Fastify** (`auth-service`).
- **[ADR-0001, 2026-07-29]** The pipeline is fixed INSIDE `CommandBus`'s method body (logging → retry →
  transaction → handler); there is no longer a `commandBus.use(...)` with detached middleware — the wrong
  order became unrepresentable rather than dependent on registration order. The transaction is a Unit-of-Work
  inferred from the handler's signature (`kind: 'transactional'` receiving a repos parameter), with no
  `options.transactional` flag. **[2026-07-30]** Repos are now one shape for the WHOLE service (previously a
  separate TxScope per module) — see `docs/adr/0001-transaction-retry-boundary.md` and `directives/cqrs_pattern.md`.
- `IdempotencyMiddleware` checks the idempotency key before executing a command.

### 3. Event Sourcing (the immutable credit ledger)

Instead of UPDATE-ing a credit balance directly, every change is stored as an **immutable event**:

```
CreditPurchasedEvent → {orgId, packId, amount: +1000, source: "billing"}
CreditSpentEvent     → {orgId, userId, amount: -5, reason: "ai_query", queryId}
CreditRefundedEvent  → {orgId, userId, amount: +5, reason: "ai_failed", queryId}
CreditAwardedEvent   → {orgId, userId, amount: +10, reason: "answer_accepted"}
```

**Balance = f(replay all events)**. The read model can be rebuilt at any time. This is exactly how a financial ledger works — except these are **virtual credits** (never cashed out) ⇒ full accounting rigour with low legal risk.

### 4. Saga Pattern (AI-Query & Bounty)

When a user calls the AI to ask a question (RAG):

```
Step 1: Reserve credit (provisional deduction)  → Success ✅
Step 2: Call the Claude API (RAG)               → Fail ❌ (timeout / provider down)
Step 3: Compensate — refund the credit          → Executed ✅ (rollback)
```

If any step fails, the saga engine automatically runs the **compensating transactions**. The bounty saga is similar: stake credit → accept answer → award → badge → notify, with a failure anywhere reverting the whole chain.

### 5. Outbox Pattern (atomic event publishing)

Writing data to the DB and publishing the event to Kafka happen in **the same database transaction**:

```sql
BEGIN TRANSACTION;
  INSERT INTO documents (...) VALUES (...);
  INSERT INTO outbox_events (type, payload) VALUES ('DocumentPublished', '{...}');
COMMIT;
```

A CDC connector (or a polling publisher) reads `outbox_events` and pushes to Kafka → consumers **re-index (ES)** and **re-embed (pgvector)**. This guarantees **at-least-once delivery**.

### 6. Idempotency

Every credit-consuming API (an AI call) requires an `X-Idempotency-Key` header. If the client resends the same request (network lag, a double click), the server recognises the key as already processed and returns the cached result — **the credit is not deducted twice**.

### 7. Circuit Breaker (around the AI provider)

`discovery-module` / `worker-service` call a third-party API (Claude embedding/summarization). When that API goes down:

```
State: CLOSED (normal)
  → 5 consecutive failures → State: OPEN (tripped, falling back to keyword search / cached embeddings)
  → After 30s → State: HALF-OPEN (try one request)
  → Success → CLOSED · Failure → OPEN again
```

One dead AI provider must never drag down the entire search feature.

### 8. 🧠 Discovery intelligence: RAG + Hybrid Retrieval

The heart of Cortex is **Hybrid Retrieval**: combining two worlds for the best results.

```
Query: "how do I rotate the JWT secret during a deploy?"
   │
   ├──► Elasticsearch (BM25 full-text) ──► top-K by keyword
   │
   ├──► pgvector (cosine similarity)   ──► top-K by meaning (embedding)
   │
   ▼
Reciprocal Rank Fusion (RRF) ──► merge & re-rank
   │
   ▼
RAG: feed the top-N passages + the question to Claude ──► an answer WITH SOURCE CITATIONS
```

- **Embeddings** are generated asynchronously by `search-service` (consuming `knowledge-events` over Kafka, embed-on-publish) and stored in a pgvector `vector(768)` column. The provider is self-hosted Ollama behind the `IEmbeddingService` port (Claude has no embeddings API).
- **Citations are mandatory:** every AI answer links back to its source documents → preventing hallucination and letting users verify for themselves.

---

## 🤖 AI-DRIVEN DEVELOPMENT WORKFLOW

This project is built by AI following a **lean, self-maintaining** workflow — no framework, just Markdown + 2 hooks + 1 generator:

### How it works
- **`directives/`** — immutable coding rules (Hexagonal, CQRS, Event Sourcing, …). The agent reads them BEFORE writing code.
- **`docs/`** — design & specs (business, schema, API, security). The `docs`↔`directives` boundary + forcing functions keep the docs from drifting away from the code (the map: `.ai/KNOWLEDGE_ARCHITECTURE.md`).
- **`.ai/`** — `KNOWLEDGE_INDEX.md` (read at the start of every session, **auto-generated**) + `memory/*.jsonl` (an experience buffer) + `PROJECT_STATUS.md` (live status).
- **2 Claude Code hooks** (`.claude/settings.json`): `UserPromptSubmit` → prints the task→doc map; `Stop` → `scripts/sync.cjs` regenerates the index + builds + warns about After-Task discipline.

> 📎 Note: RAG/pgvector/hybrid-search is both **the product's technology** (Cortex) and the inspiration for the AI workflow — the project uses the very pattern it builds to develop itself.

### Documentation language convention

This repo is the origin of a lineage: the AI workflow + `directives/` here are ported into smaller scenarios (`../system-design-scenarios/`). To stop shared documents from drifting between repos:

| Document kind | Language | Reason |
|---|---|---|
| `directives/*.md` | **English only** | Few readers (the agent + developers working directly on the code); they must match the ported copies in each scenario **word for word**, so only one language is kept |
| `readme.md` / `readme.vi.md` | **Both EN and VI** | Many readers — this is the project's front door |
| `docs/*.md`, `.ai/plans/*.md` | Vietnamese (currently) | Internal specs + the audit trail; a plan **must not be retouched after execution** (`docs/12_ai_collaboration.md`) |

---

## 🛠️ TECHNOLOGY STACK

| Category | Technologies |
|----------|-------------|
| **Monorepo** | Turborepo |
| **Backend** | NestJS (`core-api`), Fastify (`auth-service`) |
| **ORM** | Prisma v7 |
| **Database** | PostgreSQL + **pgvector** (Event Store + Read Model + Embeddings) |
| **Cache & Pub/Sub** | Redis |
| **Message Broker** | Kafka (the event backbone, KRaft mode) |
| **Search** | Elasticsearch (full-text) + pgvector (semantic) → Hybrid (RRF) |
| **AI** | Embeddings: self-hosted (Ollama `nomic-embed-text`, dim 768 — Claude has no embeddings API) · RAG summarization: Claude/Gemini (swappable via `ISummarizer`) behind a Circuit Breaker |
| **Real-time** | WebSocket + the Redis Pub/Sub adapter |
| **Frontend** | Vite + React 18 (SPA) |
| **State** | Zustand + TanStack Query |
| **Styling** | TailwindCSS v3 + CSS Variables |
| **DevOps** | Docker Compose, Prometheus + Grafana, CI/CD |
| **Testing** | Jest/Vitest, Testcontainers, K6 |

---

## 📈 PROJECT PROGRESS

Current progress: **Phase 4 (RAG live, smoke-tested) — ~83%** · detailed source: [`.ai/PROJECT_STATUS.md`](./.ai/PROJECT_STATUS.md)

- [x] **Phase 0:** Foundation & infra (monorepo, Docker, the AI workflow, module scaffolds)
- [x] **Phase 1:** Multi-tenant knowledge monolith — Tenant, Knowledge, Engagement, Feed (taxonomy deferred)
- [x] **Phase 2:** Event backbone — Kafka + Outbox (HA claim/reaper), CloudEvents 1.0, DLQ, idempotency enforcement
- [ ] **Phase 3:** CQRS & read model — deliberately deferred (the schema holds only the source of truth; see the read-model rollback decision)
- [x] **Phase 4:** AI search & discovery — `search-service` (pgvector + ES Hybrid RRF + RAG Claude/Gemini + Circuit Breaker)
- [ ] **Phase 5:** Credit economy & saga — spend/stake, the AI-Query saga (the ledger tables are already in place)
- [🔄] **Phase 6:** Real-time & workers — notification-service is LIVE (a Kafka consumer + REST); WebSocket/chat not yet
- [ ] **Phase 7:** Migration/extraction — re-anchored: `search-service` was born a microservice, so the new target is extracting `credit-ledger-service` (see readme.phases)
- [ ] **Phase 8:** Production hardening — partly done early (DLQ, outbox HA, metrics); tracing/load-testing not yet

📋 Per-phase detail: [readme.phases.md](./readme.phases.md)

---

## 🚀 QUICK START

> The full guide (gateway URLs, the end-to-end flow, gotchas): **[RUN.md](./RUN.md)**

```bash
# 1. Install
npm install

# 2. Infra (Postgres+pgvector, Redis, Kafka, ES, Ollama embeddings, Nginx gateway, Monitoring)
npm run infra:up
docker exec dsp-embedding ollama pull nomic-embed-text   # first time only

# 3. Push schemas (per-service DBs)
npm run db:push

# 4. Everything with hot reload (auth:4001 core:4002 notif:4003 search:4004 + web:3001)
npm run dev

# → Every API through the gateway: http://localhost:8000/api/v1/*
# → Web SPA: http://localhost:3001
```

---

## 🚀 NEXT STEPS

See the [Execution Roadmap (readme.phases.md)](./readme.phases.md) for the detailed roadmap from monolith to microservices.
