# 🚀 EXECUTION ROADMAP: MONOLITH TO MICROSERVICES

> 📖 **[Phiên bản Tiếng Việt](../../readme.phases.md)**

> **Note:** This is a summary version. For the complete detailed roadmap in Vietnamese, please refer to the linked file above.

## Master Roadmap

| Phase | Goal | Key Patterns |
|-------|------|-------------|
| Phase 0 | Foundation & Infrastructure | Hexagonal Architecture |
| Phase 1 | Modular Monolith (Group, Expense, Balance) | Domain Isolation, OCC |
| Phase 2 | Event Backbone (Kafka, Outbox, Event Store) | Event Sourcing, Outbox |
| Phase 3 | CQRS & Read Model Optimization | CQRS, Materialized Views |
| Phase 4 | Multi-currency & Exchange Rate Service | Circuit Breaker, Cache |
| Phase 5 | Settlement Saga & Real-time Notifications | Saga, Idempotency, DLQ |
| Phase 6 | Real-time & Background Workers | WebSocket, Pub/Sub |
| Phase 7 | **The Great Migration** (Extract settlement-service) | Strangler Fig, CDC |
| Phase 8 | Observability & Production Hardening | Rate Limiting, Tracing |

Each phase includes detailed deliverables and acceptance criteria. See the [Vietnamese version](../../readme.phases.md) for full specifications.
