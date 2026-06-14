# 💰 TEAMFIN — DISTRIBUTED TEAM FINANCE PLATFORM

[![Architecture](https://img.shields.io/badge/Architecture-Hexagonal%20%7C%20CQRS%20%7C%20Event--Sourcing-blue)](#-advanced-architectural-implementations)
[![Progress](https://img.shields.io/badge/Progress-Phase%200%20(Foundation)-brightgreen)](#-progress-tracking)

> 📖 **[Phiên bản Tiếng Việt](../../readme.md)**

## 📖 DOCUMENTATION INDEX

| # | Document | Description |
|---|----------|-------------|
| 💼 | [Business Requirements](./01_business_requirements.md) | 4 business pillars, splitting rules, debt optimization |
| 📋 | [Use Cases](./02_use_cases.md) | Detailed User ↔ System interaction flows |
| 🏗️ | [Architecture & Diagrams](./03_system_architecture_diagrams.md) | ERD, Sequence Diagrams, Data Flow |
| 💾 | [Database Schema](./04_database_schema.md) | Prisma Schema, Event Store, Read Model |
| 🎨 | [UI/UX Guidelines](./05_web_ui_ux_guidelines.md) | Dashboard layout, components, dark mode |
| 📡 | [API Contracts](./06_api_contracts.md) | RESTful endpoints, Idempotency, WebSocket |
| 🧩 | [Design System](./07_design_system_assets.md) | Color tokens, typography, spacing |
| 🧪 | [Testing Strategy](./08_testing_and_qa_strategy.md) | Ledger integrity, Saga rollback, load testing |
| ☁️ | [DevOps Infrastructure](./09_devops_infrastructure.md) | Monorepo, Docker Compose, CI/CD |
| 🛡️ | [Security & RBAC](./10_security_rbac.md) | Financial encryption, Group RBAC, Rate Limiting |
| 🚀 | [Execution Roadmap](./README_PHASES.md) | 8-phase roadmap: Monolith → Microservices |

---

## 🧠 PROJECT VISION

**TeamFin** is a Team Finance & Expense Splitting Platform built with enterprise-grade distributed architecture.

### The Real-World Problem

Every day, millions of friend groups, roommates, and travel companions face the same question: *"Who owes whom how much?"*

- 🏠 **Shared housing** — Rent, utilities, groceries
- ✈️ **Group travel** — Flights in USD, hotels in EUR, food in local currency
- 🍕 **Group dining** — "I'll pay now, you pay me back later"
- 💼 **Team expenses** — Business travel, team funds, project costs

### Why This Project Showcases System Design

| Fintech Requirement | Required System Design Pattern |
|---|---|
| Financial data must be auditable, never deleted | **Event Sourcing** (immutable ledger) |
| Read dashboard 100x vs create expense 1x | **CQRS** (separate Read/Write) |
| Debit A + Credit B must be atomic | **Saga Pattern** (distributed transaction) |
| Write DB + publish event in same transaction | **Outbox Pattern** |
| "Pay" button clicked twice due to lag | **Idempotency Key** |
| 2 people editing same expense concurrently | **Optimistic Concurrency Control** |
| Third-party exchange rate API goes down | **Circuit Breaker + Fallback** |
| Dashboard for 50-person group queried constantly | **Cache + Stampede Prevention** |
| Prevent spam on financial endpoints | **Rate Limiting (Token Bucket)** |
| Notification worker fails | **Dead Letter Queue + Retry** |

---

## 🏗️ ARCHITECTURE: MODULAR MONOLITH FIRST

Start with a **tightly-structured Modular Monolith**, extract to **Microservices** only when justified — demonstrating the most valuable Senior skill: **safe migration with zero downtime**.

### System Architecture

```
         Client (React SPA — Dashboard + Forms)
                    |
          API Gateway / Ingress
                    |
       +------------+-------------+
       |                          |
 [Auth Service]          [Core API (Modular Monolith)]
 (Fastify)               ├── group-module
                         ├── expense-module (Event Sourcing)
                         ├── settlement-module (Saga)
                         ├── balance-module (CQRS Read Model)
                         └── currency-module
       |                          |
 [DB: Auth]              [DB: Core (Event Store + Read Model)]
                                  |
                           [Outbox Table]
                                  |
 =========================================================================
  KAFKA EVENT STREAMING BACKBONE
 =========================================================================
        |                  |                  |                  |
  [Worker Service]  [Search Service]  [Notification Svc]  [Exchange Rate Svc]
  (Debt Simplify)   (ES Indexing)     (WebSocket+Push)    (Circuit Breaker)
```

---

## 🔥 ADVANCED ARCHITECTURAL IMPLEMENTATIONS

1. **Hexagonal Architecture** — Absolute boundary between business logic and infrastructure.
2. **In-House CQRS Bus** — Framework-independent, works on both NestJS and Fastify.
3. **Event Sourcing** — Immutable financial ledger. Balance = f(replay all events).
4. **Saga Pattern** — Distributed transactions with compensating actions for settlement.
5. **Outbox Pattern** — Atomic DB write + event publish.
6. **Idempotency** — Every financial mutation requires `X-Idempotency-Key`.
7. **Circuit Breaker** — Exchange Rate Service with 3-state circuit (CLOSED/OPEN/HALF-OPEN).
8. **Debt Simplification** — NP-Hard variant algorithm minimizing number of transfers.

---

## 🛠️ TECH STACK

| Category | Technologies |
|----------|-------------|
| **Monorepo** | Turborepo |
| **Backend** | NestJS (core-api), Fastify (auth-service) |
| **ORM** | Prisma |
| **Database** | PostgreSQL (Event Store + Read Model) |
| **Cache** | Redis |
| **Message Broker** | Kafka |
| **Search** | Elasticsearch |
| **Real-time** | WebSocket + Redis Pub/Sub |
| **Frontend** | Vite + React 18, Zustand, TanStack Query, Recharts |
| **Testing** | Vitest, Testcontainers, K6, Playwright |

---

## 📈 PROGRESS TRACKING

- [x] **Phase 0:** Foundation & Infrastructure
- [ ] **Phase 1:** Modular Monolith (Group, Expense, Balance)
- [ ] **Phase 2:** Event Backbone (Kafka, Outbox, Event Sourcing)
- [ ] **Phase 3:** CQRS & Read Model Optimization
- [ ] **Phase 4:** Multi-currency & Circuit Breaker
- [ ] **Phase 5:** Settlement Saga & Real-time
- [ ] **Phase 6:** The Great Migration (Extract settlement-service)
- [ ] **Phase 7:** Observability & Production Hardening

📋 Detailed roadmap: [README_PHASES.md](./README_PHASES.md)
