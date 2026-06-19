# 🗄️ DATABASE SCHEMA — Cortex

> This English page mirrors the Vietnamese source of truth.
> Please refer to the [Vietnamese version](../04_database_schema.md) for the complete Prisma schema.

**Summary:** PostgreSQL 16 + pgvector, two logical DBs (`auth_db`, `core_db`). Contexts: Identity (auth), Tenant (organizations/memberships/spaces), Knowledge (knowledge_items + revisions, OCC `version`), Discovery (embeddings `vector(1024)`, HNSW index), Engagement (votes/bookmarks), Credit (append-only `event_store` + `credit_balance_summary`), Read Models (feed/reputation), Infrastructure (outbox_events, idempotency_records). Invariants: append-only event store, tenant isolation, AI data boundary, OCC, outbox atomicity, ledger integrity.
