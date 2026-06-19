# 🧠 CORTEX — AI-POWERED TEAM KNOWLEDGE HUB

[![Architecture](https://img.shields.io/badge/Architecture-Hexagonal%20%7C%20CQRS%20%7C%20Event--Sourcing-blue)](#-advanced-architectural-implementations)
[![AI](https://img.shields.io/badge/AI-RAG%20%7C%20pgvector%20%7C%20Hybrid%20Search-purple)](#-discovery-intelligence-rag--hybrid-retrieval)
[![Progress](https://img.shields.io/badge/Progress-Phase%200%20(Foundation)-brightgreen)](#-progress-tracking)

> 📖 **[Phiên bản Tiếng Việt](../../readme.md)**

## 📖 DOCUMENTATION INDEX

| # | Document | Description |
|---|----------|-------------|
| 💼 | [Business Requirements](./01_business_requirements.md) | 5 pillars: Knowledge, AI Discovery, Credit Economy, Reputation, Multi-tenancy |
| 📋 | [Use Cases](./02_use_cases.md) | Detailed User ↔ System interaction flows |
| 🏗️ | [Architecture & Diagrams](./03_system_architecture_diagrams.md) | Topology, RAG pipeline, Sequence Diagrams |
| 💾 | [Database Schema](./04_database_schema.md) | Prisma Schema, Event Store, Read Model, pgvector |
| 🎨 | [UI/UX Guidelines](./05_web_ui_ux_guidelines.md) | Search-first UX, RAG answers + citations |
| 📡 | [API Contracts](./06_api_contracts.md) | RESTful endpoints, Idempotency, Tenant scoping |
| 🧩 | [Design System](./07_design_system_assets.md) | Color tokens, typography, component specs |
| 🧪 | [Testing Strategy](./08_testing_and_qa_strategy.md) | Ledger integrity, AI-Saga refund, Tenant isolation |
| ☁️ | [DevOps & Infrastructure](./09_devops_infrastructure.md) | Monorepo, Docker Compose, Observability |
| 🛡️ | [Security & RBAC](./10_security_rbac.md) | Multi-tenant RBAC, AI data boundary, Rate Limiting |
| 🚀 | [Execution Roadmap](./README_PHASES.md) | 9-phase roadmap (0-8): Monolith → Microservices |

---

## 🧠 PROJECT VISION

**Cortex** is an **AI-powered internal Knowledge Hub for teams/companies**, built on an Enterprise-grade Distributed Architecture.

### The Real Problem

An organization's knowledge is **scattered everywhere** — Slack, Notion, Google Drive, Confluence, and most critically: **inside a few key people's heads**. The daily consequences:

- 🔍 **"Who knows about this?"** — The same questions get asked repeatedly; new hires take weeks to onboard.
- 📄 **Dead documents** — Written but never found; keyword search fails when you don't recall the exact term.
- 🧠 **Bus factor** — One person leaves and an entire knowledge area disappears.
- 😮‍💨 **Nobody documents** — "Why write it if no one reads it?"

Existing solutions (Glean, Notion AI, Confluence) prove this is a real market. **Cortex** solves the same pain with proper Enterprise architecture — **RAG + Hybrid Search, Event Sourcing, CQRS, Saga** — because once you handle **knowledge + costly AI + multi-tenant data**, distributed patterns become **mandatory, not decorative**.

### Why this project "Shows off" System Design

Core philosophy: **every business requirement FORCES a System Design Pattern**.

| Business Requirement | Mandatory Pattern |
|---|---|
| Credit (bought with money) must be auditable, never wrong | **Event Sourcing** (immutable ledger) |
| Read/search knowledge 1000x vs write 1x | **CQRS** (separate read/write) |
| Spend credit on AI → refund if AI fails | **Saga Pattern** (distributed transaction) |
| Write document + emit re-index/re-embed atomically | **Outbox Pattern** |
| Clicking "Ask AI" twice due to lag | **Idempotency Key** |
| Two people editing the same runbook (wiki) | **Optimistic Concurrency Control** |
| AI/embedding provider (Claude) goes down | **Circuit Breaker + Fallback** |
| A hot question searched by 500 people at once | **Cache + Stampede Prevention** |
| AI calls are EXPENSIVE → prevent abuse | **Rate Limiting (Token Bucket)** |
| Re-index worker fails | **Dead Letter Queue + Retry** |
| Find docs by MEANING, not keywords | **Vector Search (pgvector)** |
| Full-text search + filter + facet | **Elasticsearch (Hybrid Retrieval)** |
| Each org isolates data, own quota, no noisy-neighbor | **Multi-tenancy** |

---

## 🏗️ ARCHITECTURE PHILOSOPHY: MODULAR MONOLITH FIRST

Start with a tight **Modular Monolith**, split into **Microservices** only when truly needed — or to prove migration skill. Phase 7 extracts `discovery-service` (AI-bound workload that must scale and be cost-isolated separately).

---

## 🧱 SERVICE TOPOLOGY

- **`auth-service`** (Fastify) — JWT, refresh rotation, org-scoped RBAC.
- **`core-api`** (NestJS Modular Monolith) — modules: `tenant`, `knowledge` (OCC + versioning), `taxonomy`, `engagement`, `discovery` (Hybrid Search + RAG), `credit` (event-sourced ledger), `reputation`, `feed` (read model).
- **`worker-service`** — embeddings, re-index, summarization, digest, stale detection.
- **`notification-service`** — WebSocket + Redis Pub/Sub.
- **`chat-service`** — realtime threads + AI Assistant (RAG) + presence.
- **`search-service`** — Kafka → Elasticsearch indexer.

---

## 🔥 ADVANCED ARCHITECTURAL IMPLEMENTATIONS

1. **Hexagonal Architecture** — pure POJO `common/`, concrete `infrastructure/`.
2. **In-house CQRS bus** — runs on both NestJS and Fastify; middleware chain Logging → Retry → Transaction.
3. **Event Sourcing** — credit ledger as immutable events; `Balance = f(replay events)`. Credit is **virtual (never cashes out)** → full ledger rigor, low legal risk.
4. **Saga** — AI-Query saga (reserve → call RAG → commit / refund), Bounty saga.
5. **Outbox** — atomic DB write + event publish → Kafka → re-index (ES) + re-embed (pgvector).
6. **Idempotency** — `X-Idempotency-Key` on every credit-spending action.
7. **Circuit Breaker** — around Claude embedding/RAG; fallback to keyword search.

## 🧠 DISCOVERY INTELLIGENCE: RAG + HYBRID RETRIEVAL

```
Query → [Elasticsearch BM25] + [pgvector cosine] → Reciprocal Rank Fusion → RAG (Claude) → Answer + CITATIONS
```
- Embeddings generated asynchronously by `worker-service` via Kafka.
- **Citations are mandatory** on every AI answer → prevents hallucination, enables verification.

---

## 🤖 AI-DRIVEN DEVELOPMENT WORKFLOW

Layered Multi-Agent Orchestration (Level 4/5):
- **Layer 0** Sandbox (`docker-compose.agent.yml`, read-only).
- **Layer 1** Directives (`directives/` SOPs).
- **Layer 2** Orchestration (the agent, dynamic planning, sub-agents).
- **Layer 3** Execution (`execution/` Python tools, `.ai/memory/*.jsonl`, `.ai/KNOWLEDGE_INDEX.md`).

---

## 🛠️ TECH STACK

Turborepo · NestJS + Fastify · Prisma v7 · PostgreSQL + **pgvector** · Redis · Kafka (KRaft) · Elasticsearch · **Claude** (embedding + RAG) · WebSocket + Redis Pub/Sub · Vite + React 18 · Zustand + TanStack Query · TailwindCSS · Docker Compose + Prometheus/Grafana · Jest/Vitest + Testcontainers + K6.

---

## 📈 PROGRESS TRACKING

- [x] **Phase 0:** Foundation & Infra
- [ ] **Phase 1:** Multi-tenant Knowledge Monolith (NEXT)
- [ ] **Phase 2:** Event Backbone (Kafka, Outbox, Event Store)
- [ ] **Phase 3:** CQRS & Read Model
- [ ] **Phase 4:** AI Search & Discovery (pgvector + ES Hybrid + RAG)
- [ ] **Phase 5:** Credit Economy & Saga
- [ ] **Phase 6:** Real-time & Workers
- [ ] **Phase 7:** The Great Migration (extract `discovery-service`)
- [ ] **Phase 8:** Production Hardening

📋 Details: [README_PHASES.md](./README_PHASES.md)

---

## 🚀 QUICK START

```bash
git clone https://github.com/yourname/cortex-knowledge-hub.git
cd cortex-knowledge-hub
npm install
docker-compose up -d        # Postgres+pgvector, Redis, Kafka, Elasticsearch, Monitoring
npx turbo run db:migrate
npx turbo run dev
```
