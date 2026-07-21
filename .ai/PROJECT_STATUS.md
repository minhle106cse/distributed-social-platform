# 📊 Cortex — Live Status

> **Current-state only.** Injected verbatim into `KNOWLEDGE_INDEX.md §2`. Update as part of the
> After-Task Protocol whenever a phase/module changes. The full historical journal lives in
> `.ai/CHANGELOG.md` (not scanned by the builder). The auto-detected module map that the builder
> appends below this content is filesystem ground-truth — if it disagrees with the table here, this
> file is stale; reconcile it.

> Last curated: **2026-07-21**

**Overall ~86%** — infrastructure ~88% / product features ~55% (credit ledger has a foundation).
**Tech-stack showcase is deep; product surface is still MVP.**

### Where we are now

- **Latest landed:** the **resilience & defense curriculum** (`directives/resilience_patterns.md` is
  the source of truth) is nearly done — idempotency (claim-before-execute + request-hash), retry
  (P2034-only, auto-applies to every `transactional:true` command), circuit breaker (gRPC + ES +
  Ollama, promoted to shared-kernel), org-aware rate limiting, and graceful shutdown are all ✅.
  **Correlation-id (W3C traceparent across HTTP/gRPC/Kafka) is implemented but held back
  uncommitted pending review** — the only remaining item. Also landed: membership-verification gRPC
  (IDOR fix), 293-test unit-test pass across the monorepo, and a monitoring stack as code.
- **Current focus:** land correlation-id once reviewed, then RAG learning curriculum → resume
  feature work.

### Phase map

| Phase | Goal | Status |
|---|---|---|
| 0 | Foundation & Infra | ✅ Done |
| 1 | Multi-tenant Knowledge Monolith | ✅ Done (taxonomy deferred to post-Phase-3) |
| 2 | Event Backbone (Kafka + Outbox) | ✅ Done — 2a outbox/publisher + 2b consumer, smoke-tested |
| 3 | CQRS & Read Model | ⬜ Deferred — schema stays source-of-truth-only until a read path needs it |
| 4 | AI Search & Discovery (RAG) | ✅ Code-complete + smoke-tested (search-service; happy-path summary needs a real key) |
| 5 | Credit Economy & Saga | 🔄 5a Credit Ledger done + smoke-tested; **5b AI-Query Saga = next**; 5c bounty+reputation pending |
| 6 | Realtime & Workers | 🔄 Started early — notification-service B1 + B2 done |
| 7 | The Great Migration | ⬜ Not started (re-anchored: credit-ledger-service + CDC replay demo) |
| 8 | Production Hardening | ⬜ Not started |

**Built modules:** core-api (`tenant`, `knowledge`, `engagement`, `feed`, `credit`, `platform-admin`,
`outbox`); auth-service (auth JWT RS256 + refresh rotation, system RBAC, user); notification-service
(B1 consumer + B2 fan-out); search-service (semantic + hybrid RRF + RAG summary). Cross-service:
gRPC org-provisioning saga (ts-proto codegen), System-Admin vs Org-Admin split, per-service Kafka ids.

### Live debts (consciously deferred, not forgotten)

- **Saga durability:** org-provisioning compensation is in-request only — a core-api crash mid-flow
  leaves a harmless orphan user (no saga-state table + sweep job; not worth it at admin-op frequency).
- **CloudEvent tracing:** W3C `traceparent` propagation is implemented (HTTP/gRPC/Kafka) but sitting
  uncommitted pending review — see `directives/resilience_patterns.md` §7 once it lands. A distinct
  `causationId` (event-caused-event chain) is still unmodeled — add when Phase 5b saga needs it.
- **Outbox reorder:** retry can reorder same-aggregate events (fix = per-key sequencing; not worth it yet).
- **Naming split:** `CORS_ORIGINS` (auth) vs `CORS_ALLOWED_ORIGINS` (3 NestJS services) — known,
  unmerged (touches 4 configs); see `directives/naming_conventions.md`.
- **Test gaps:** `credit` module unit tests pending user review of the AI-authored code; no
  e2e/integration tests anywhere yet (sequenced into the final performance/hardening phase).
