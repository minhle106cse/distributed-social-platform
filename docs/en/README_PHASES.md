# 🚀 EXECUTION ROADMAP: MONOLITH TO MICROSERVICES

> 📖 **[Phiên bản Tiếng Việt](../../readme.phases.md)**

> **Note:** This is a summary version. For the complete detailed roadmap in Vietnamese, please refer to the linked file above.

## Master Roadmap

| Phase | Goal | Key Output | Pattern Showcase |
|-------|------|-----------|-----------------|
| Phase 0 | Foundation & Infra | Monorepo, Docker, AI Workflow | Hexagonal Architecture |
| Phase 1 | Multi-tenant Knowledge Monolith | `core-api` (Tenant, Knowledge) | Domain Isolation, OCC, Multi-tenancy |
| Phase 2 | Event Backbone | Kafka, Outbox, Event Store | Event Sourcing, Outbox |
| Phase 3 | CQRS & Read Model | Feed/Digest projections, cache | CQRS, Projection, Stampede Prevention |
| Phase 4 | AI Search & Discovery | pgvector + ES Hybrid, RAG | Vector Search, Circuit Breaker, RAG |
| Phase 5 | Credit Economy & Saga | Credit ledger, AI-Query Saga | Saga, Idempotency, DLQ |
| Phase 6 | Real-time & Workers | Notification, Chat/AI-Assistant | WebSocket, Pub/Sub |
| Phase 7 | **The Great Migration** | Extract `discovery-service` | Strangler Fig, CDC |
| Phase 8 | Production Hardening | Observability, Load Test, Security | Rate Limiting, Tracing, Tenant Isolation |

---

### Phase 0 — Foundation & Infrastructure
Turborepo monorepo; Docker Compose (Postgres+pgvector, Redis, Kafka KRaft, Elasticsearch, Prometheus/Grafana); shared-kernel; AI workflow (`directives/`, `execution/`, `.ai/`). **AC:** `docker-compose up -d` and `turbo run dev` work.

### Phase 1 — Multi-tenant Knowledge Monolith
`tenant` (org/workspace, roles OWNER/ADMIN/MEMBER/GUEST, quota), `knowledge` (DOCUMENT/QUESTION/ANSWER/RUNBOOK/ADR with OCC + versioning), `taxonomy`, `engagement` (vote/accept/verify). **AC:** CRUD scoped by `orgId`; OCC blocks concurrent edits; tenant isolation test passes.

### Phase 2 — Event Backbone (Kafka + Event Sourcing)
Event Store (append-only), Outbox Pattern, Idempotency table; credit ledger becomes event-sourced. Topics: `knowledge-events`, `credit-events`, `engagement-events`. **AC:** rebuild balance from events == current; idempotent spends; DLQ works.

### Phase 3 — CQRS & Read Model Optimization
Materialized read models (feed timeline, trending, credit summary), Redis cache, stampede prevention. **AC:** feed < 200ms; cache invalidation < 1s; single rebuild under stampede.

### Phase 4 — AI Search & Discovery (RAG + Hybrid)
Embedding pipeline (`worker-service` + Claude, Circuit Breaker), Hybrid Retrieval (ES BM25 + pgvector, RRF), RAG answers with citations, AI rate limiting. **AC:** semantic hits without keyword match; answers always cited; keyword fallback when AI down.

### Phase 5 — Credit Economy & Saga
AI-Query Saga (reserve → RAG → commit/refund), bounty Saga, credit sources/sinks (virtual, no payout), DLQ. **AC:** refund on RAG failure; no double-spend; ledger integrity holds.

### Phase 6 — Real-time & Workers
`notification-service` (WebSocket + Redis Pub/Sub), `chat-service` (AI Assistant RAG + presence), `worker-service` (embeddings, digest, stale detection). **AC:** realtime < 500ms; AI assistant keeps context + citations; DLQ resilient.

### Phase 7 — The Great Migration
Extract `discovery-service` (embeddings + vector + RAG + ES) via Strangler Fig + CDC; AI-bound workload isolated for scale and cost. **AC:** zero downtime; no relevance regression; old code removed.

### Phase 8 — Observability & Production Hardening
OpenTelemetry → Jaeger, Grafana dashboards, K6 load tests, tenant isolation audit, AI data boundary, rate limiting, nightly ledger integrity cron. **AC:** all metrics visible; load thresholds pass; 0 cross-org leak; no ledger drift.
