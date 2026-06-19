# 🧪 TESTING & QA STRATEGY — Cortex

> This English page mirrors the Vietnamese source of truth.
> Please refer to the [Vietnamese version](../08_testing_and_qa_strategy.md) for the complete document.

**Summary:** Unit (OCC, credit ledger replay, RRF fusion, reputation rules, idempotency). Integration via Testcontainers (outbox atomicity, re-index/re-embed, OCC race, pgvector scoped search). Saga & resiliency (AI-Query saga refund, bounty saga, circuit breaker, DLQ, idempotency). **Tenant isolation** (no cross-org reads, AI data boundary, quota). Search relevance golden set (Recall@K, MRR, regression gate). Ledger integrity (property + rebuild + nightly cron). K6 load (search throughput, OCC stress, AI rate-limit, no double-spend, cache stampede). QA gate: Zero Trust — no "Done" without an automated verification step.
