# 🚀 LỘ TRÌNH THỰC THI: TỪ MONOLITH ĐẾN MICROSERVICES


---

## 🧠 MỤC TIÊU LỘ TRÌNH

Không áp dụng Microservices một cách mù quáng. Bắt đầu bằng **Modular Monolith** vững chắc cho Core Business, xây dựng nền tảng Event-Driven, bổ sung **AI Discovery (RAG + Hybrid Search)**, và cuối cùng chứng minh kỹ năng Senior bằng cách **Migrate** một module thành Microservice độc lập — **zero downtime**.

---

## 🏁 MASTER ROADMAP OVERVIEW

> **Trạng thái cập nhật 2026-07-02** (ground truth: [`.ai/PROJECT_STATUS.md`](./.ai/PROJECT_STATUS.md)). Cột "Thực tế" ghi lại các quyết định đã làm lệch so với plan gốc — có chủ đích, đều được log trong `.ai/`.

| Phase | Mục tiêu | Pattern Showcase | Trạng thái / Thực tế |
|-------|----------|-----------------|---------------------|
| 0 | Foundation & Infra | Hexagonal | ✅ Done |
| 1 | Multi-tenant Knowledge Monolith | Domain Isolation, OCC, Multi-tenancy | ✅ Done (taxonomy deferred sau Phase 3) |
| 2 | Event Backbone | Outbox, CloudEvents, DLQ | ✅ Done + hardened (outbox HA claim/reaper, idempotency enforce compile-time) |
| 3 | CQRS & Read Model | CQRS, Projection, Stampede Prevention | ⬜ Deferred CÓ CHỦ ĐÍCH — read-model từng dựng sớm đã rollback (schema chỉ giữ source-of-truth; feed = fan-out-on-read) |
| 4 | AI Search & Discovery | Vector Search, RRF, Circuit Breaker, RAG | ✅ Done (smoke-tested) — **khác plan: sinh thẳng `search-service` own-DB thay vì discovery-module trong core-api**; embeddings = self-hosted Ollama (Claude KHÔNG có embeddings API) |
| 5 | Credit Economy & Saga | Saga, Idempotency, DLQ | ⬜ Chưa — ledger tables (CreditEvent/ReputationEvent) đã sẵn làm source-of-truth |
| 6 | Real-time & Workers | WebSocket, Pub/Sub | 🔄 Partial — notification-service LIVE (Kafka consumer + REST fan-out); WebSocket/chat/worker chưa |
| 7 | Migration/Extraction | Strangler Fig, CDC | ⬜ **RE-ANCHORED** — xem §Phase 7: discovery đã là microservice từ đầu, target mới = `credit-ledger-service` + CDC replay demo |
| 8 | Production Hardening | Rate Limiting, Tracing, Tenant Isolation | 🔄 Một phần làm sớm (DLQ, outbox HA, prom metrics, dedup counters); tracing/K6/tenant-audit chưa |

---

## 🔷 PHASE 0 — FOUNDATION & INFRASTRUCTURE

### 🎯 Goal
Tạo môi trường phát triển local hoàn chỉnh và chuẩn hóa kiến trúc.

### Deliverables
1. **Monorepo Setup (Turborepo)**
   - `apps/core-api` — NestJS Modular Monolith
   - `apps/auth-service` — Fastify Microservice
   - `apps/web` — Vite + React SPA (Phase X - Future)
   - `apps/worker-service` — Background Jobs / Embeddings (Scaffolded)
   - `apps/notification-service` — WebSocket + Push (Scaffolded)
   - `apps/search-service` — Kafka → Elasticsearch indexer (Phase X - Future)
   - `apps/chat-service` — Realtime + AI Assistant (Phase X - Future)

2. **Local Infra (Docker Compose)**
   - PostgreSQL + **pgvector** (`15432`) — Core Database + Embeddings
   - Redis (`6379`) — Cache & Pub/Sub
   - Kafka (`9092`, KRaft mode — không Zookeeper) — Event Broker
   - Elasticsearch (`9200`) — Full-text Search
   - Prometheus + Grafana + Exporters — Observability

3. **Shared Packages**
   - `packages/shared-kernel` — Abstractions, interfaces, domain types, logger (Pino), CQRS bus
   - `packages/event-contracts` — Kafka Event Schema definitions (Phase X - Future)

4. **AI Agent Workflow**
   - `directives/` — SOPs cho kiến trúc, CQRS rules, Event Sourcing rules (the coding rulebook)
   - `docs/` — thiết kế & spec (business, schema, API, security)
   - `.ai/` — KNOWLEDGE_INDEX (tự sinh) + memory buffer + PROJECT_STATUS
   - `.claude/` + `scripts/sync.cjs` — 2 hook tự regenerate index + build

### ✅ Acceptance Criteria
- `docker-compose up -d` khởi động toàn bộ infra không lỗi.
- `npx turbo run dev` chạy tất cả apps đồng thời.
- Hexagonal Architecture folder structure established.

---

## 🔷 PHASE 1 — MULTI-TENANT KNOWLEDGE MONOLITH

### 🎯 Goal
Xây dựng Business Logic cốt lõi trong Monolith gọn gàng, với multi-tenancy ngay từ đầu.

### Deliverables

#### 1. `auth-service` (Fastify — đã có sẵn)
- JWT Access Token (15 phút) + Refresh Token Rotation.
- HTTP-Only Secure Cookie cho Refresh Token.
- **Org-scoped RBAC:** token mang `orgId` + role trong org.
- Rate Limiting: 5 req/5 phút cho Login/Register.

#### 2. `core-api` Modules

**`tenant-module`:**
- Tạo Organization, Workspace, mời thành viên (Invite Link).
- Vai trò trong org: `OWNER`, `ADMIN`, `MEMBER`, `GUEST`.
- Cấu hình & quota theo tenant (seat limit, credit balance, AI quota).
- **Tenant isolation:** mọi truy vấn BẮT BUỘC scope theo `orgId`.

**`knowledge-module`:**
- CRUD nội dung: `DOCUMENT`, `QUESTION`, `ANSWER`, `RUNBOOK`, `ADR`.
- **Versioning + OCC:** trường `version` chống race condition khi 2 người sửa cùng 1 document (wiki edit).
- Soft delete (`deletedAt`) + audit (`createdBy`, `updatedBy`).
- Trạng thái: `DRAFT`, `PUBLISHED`, `ARCHIVED`, `STALE`.

**`taxonomy-module`:**
- Spaces/Collections (nhóm nội dung theo team/chủ đề).
- Tags/Topics, subscribe để nhận digest.

**`engagement-module`:**
- Vote (up/down), Accept Answer, **Verify** (đánh dấu "đã kiểm chứng bởi expert").
- Bookmark, Follow document/space.

#### 3. Database
- 1 PostgreSQL cho `auth-service` (`auth_db` — cô lập bảo mật).
- 1 PostgreSQL cho `core-api` (`core_db` — schema phân chia theo domain, KHÔNG FK chéo domain).

### ✅ Acceptance Criteria
- API CRUD Knowledge hoạt động đầy đủ, scope đúng theo `orgId`.
- OCC chặn được 2 update đồng thời (chỉ 1 thành công).
- Một user ở org A KHÔNG đọc được dữ liệu org B (tenant isolation test).
- Unit tests cho versioning + vote logic.

---

## 🟡 PHASE 2 — EVENT BACKBONE (KAFKA + EVENT SOURCING)

### 🎯 Goal
Chuyển từ CRUD thuần sang **Event-Driven Architecture** + **Event Sourcing** cho sổ cái Credit.

### Deliverables

1. **Event Store Table:**
   ```
   EventStore: { id, aggregateType, aggregateId, eventType, payload, version, createdAt }
   ```
   - Mọi thay đổi credit (Purchase/Spend/Stake/Award/Refund) lưu dưới dạng Event bất biến.
   - Không bao giờ UPDATE hoặc DELETE row trong Event Store.

2. **Outbox Pattern:**
   - Ghi domain table + Outbox Event trong cùng 1 DB Transaction.
   - CDC Connector (hoặc Polling Publisher) đọc Outbox và đẩy lên Kafka.
   - Topics: `knowledge-events`, `credit-events`, `engagement-events`.

3. **Consumers re-index / re-embed:**
   - `DocumentPublishedEvent` → `search-service` index vào ES + `worker-service` sinh embedding (pgvector).

4. **Idempotency Table:**
   ```
   IdempotencyRecord: { key, response, createdAt, expiresAt }
   ```
   - Mọi Command tốn credit kiểm tra Idempotency Key trước khi execute.

### ✅ Acceptance Criteria
- Spend credit → Event Store có record + Outbox có record + Kafka nhận event.
- Rebuild credit balance từ Event Store cho kết quả identical với current balance.
- Gửi cùng Idempotency Key 2 lần → chỉ trừ credit 1 lần.
- DLQ hoạt động: message lỗi schema vào DLQ topic.

---

## 🟣 PHASE 3 — CQRS & READ MODEL OPTIMIZATION

### 🎯 Goal
Tách biệt hoàn toàn Write Model (Event Store) và Read Model (Feed/Dashboard).

### Deliverables

1. **Materialized Views / Read Models:**
   - `feed_timeline` — "Mới trong Spaces của bạn".
   - `trending_knowledge` — Nội dung được xem/vote nhiều.
   - `credit_balance_summary` — Số dư credit org + lịch sử gần đây.
   - `org_statistics` — Tổng số doc, contributor active, top contributor.

2. **Caching Strategy:**
   - Redis cache cho Feed & Balance Summary (hot data).
   - Cache invalidation: khi nhận Kafka event → invalidate cache.
   - **Stampede Prevention:** Distributed Lock — chỉ 1 request rebuild cache, còn lại chờ.

3. **Query Optimization:**
   - Read API không bao giờ đụng Event Store.
   - Tất cả Read query chạy trên Materialized View + Redis cache.

### ✅ Acceptance Criteria
- Feed load < 200ms cho org 500+ documents.
- Cache invalidation đúng thời điểm (publish doc → feed mới trong < 1s).
- Stampede test: 100 request đồng thời vào hot key → chỉ 1 lần rebuild.

---

## 🟠 PHASE 4 — AI SEARCH & DISCOVERY (RAG + HYBRID)

### 🎯 Goal
Trái tim sản phẩm: tìm tri thức theo **ngữ nghĩa** + trả lời câu hỏi bằng **RAG** kèm trích dẫn.

### Deliverables

> ✅ **ĐÃ HOÀN THÀNH (2026-07-02) — khác plan gốc ở 2 điểm, có chủ đích:**
> (1) Toàn bộ Phase 4 sống trong **`search-service`** — microservice riêng own `search_db`, consume `knowledge-events` (embed-on-publish) — KHÔNG phải worker-service + discovery-module trong core-api. Lý do: tái dùng backbone consumer đã hardened, và tránh nhét workload AI vào monolith (đằng nào Phase 7 cũng phải tách).
> (2) **Claude KHÔNG có embeddings API** (plan gốc ghi sai) → embeddings = self-hosted **Ollama `nomic-embed-text` (dim 768)** sau port `IEmbeddingService`. Claude/Gemini chỉ dùng cho RAG summarization (swap qua `ISummarizer`).

1. **Embedding Pipeline (`search-service`):** ✅
   - Publish → Kafka → chunk (400 từ/overlap 64) → embed → `vector(768)` + HNSW cosine index.
   - Re-publish → re-index sạch (delete+insert theo itemId, idempotent natural-key).

2. **Hybrid Retrieval (`search-service`):** ✅
   - Elasticsearch BM25 (per-tenant index) + pgvector cosine, chạy song song.
   - **RRF (k=60, item-level)** hợp nhất; ES down → degrade semantic-only.

3. **RAG Answer:** ✅ (một phần)
   - Top-N chunks + câu hỏi → Claude (`claude-opus-4-8`) hoặc Gemini → answer kèm **citation [n]**.
   - **Circuit Breaker** quanh mọi call LLM: 5 fail → OPEN → search vẫn trả chunks (summary=null).
   - ⬜ Còn lại: **Rate Limiting (Token Bucket)** per user/org cho AI query — dời sang Phase 5 (gắn với credit spend).

4. ⬜ **Cache embeddings & kết quả search hot trong Redis** — chưa làm (defer: đúng nguyên tắc "source-of-truth trước, optimize sau"; làm cùng Phase 3/8).

### ✅ Acceptance Criteria
- Semantic search trả đúng document dù query không chứa keyword khớp.
- RAG answer luôn kèm ít nhất 1 citation hợp lệ (chống hallucination).
- Khi AI API down → Circuit Breaker OPEN → search vẫn chạy (keyword fallback).
- Rate limit chặn user vượt quota AI.

---

## 🔴 PHASE 5 — CREDIT ECONOMY & SAGA PATTERN

### 🎯 Goal
Implement nền kinh tế credit ảo với **Saga Pattern** và **Idempotency**.

### Deliverables

1. **AI-Query Saga (Saga Orchestration):**
   ```
   AskAiCommand
     → Step 1: Reserve credit (trừ tạm)
     → Step 2: Gọi RAG (Claude)
     → Step 3: Commit credit spend (Event Store) + lưu kết quả
   
   If Step 2 fails (timeout / provider down):
     → Compensate: Refund credit (CreditRefundedEvent)
     → Notify user: "AI tạm thời không khả dụng, credit đã được hoàn"
   ```

2. **Bounty Saga (gamify đóng góp):**
   - Asker stake credit cho câu hỏi khó → expert trả lời → asker accept.
   - Saga: release stake → award answerer + reputation → grant badge → notify.
   - Fail ở bất kỳ bước nào → compensate toàn bộ.

3. **Credit Sources & Sinks:**
   - Source: org mua credit pack (billing), award khi đóng góp được verify.
   - Sink: gọi AI, stake bounty, premium feature.
   - **Không payout ra tiền mặt** — credit chỉ luân chuyển nội bộ org.

4. **DLQ Handling:** message lỗi vào DLQ topic, có endpoint replay thủ công.

### ✅ Acceptance Criteria
- Saga rollback: khi RAG fail → credit được hoàn đúng số, balance không lệch.
- Idempotency: cùng key 2 lần → chỉ 1 lần trừ credit.
- Ledger integrity: `Sum(credit events) == Current Balance` cho mọi org.

---

## 🟢 PHASE 6 — REAL-TIME & WORKERS

### 🎯 Goal
Thông báo thời gian thực + AI Assistant + Xử lý tác vụ nền.

### Deliverables

1. **`notification-service`:**
   - WebSocket Server (Socket.IO) + Redis Pub/Sub adapter (scale ngang).
   - Subscribe Kafka topics (`knowledge-events`, `engagement-events`).
   - Real-time push: câu hỏi được trả lời, document mình follow được cập nhật, @mention.
   - Push Notification: digest, nhắc review tài liệu sắp stale.

2. **`chat-service`:**
   - Thảo luận realtime theo thread trên 1 document/question.
   - **AI Assistant (RAG chatbot):** hỏi đáp hội thoại trên tri thức org, có ngữ cảnh phiên.
   - Presence (ai đang online / đang xem doc) qua Redis.

3. **`worker-service`:**
   - **Embedding & Re-index** (đã có ở Phase 4), digest email định kỳ.
   - **Stale Detection:** đánh dấu document lỗi thời (lâu không cập nhật / có thay đổi liên quan).
   - **Badge Cron:** tính lại reputation & badge định kỳ.

### ✅ Acceptance Criteria
- Document được trả lời → members online nhận WebSocket event < 500ms.
- AI Assistant giữ được ngữ cảnh hội thoại + trích dẫn nguồn.
- DLQ: message lỗi vào DLQ, không crash worker.

---

## 🔴 PHASE 7 — MIGRATION / EXTRACTION (RE-ANCHORED 2026-07-02)

> ⚠️ **Plan gốc đã vô hiệu một nửa:** premise là "tách discovery-module RA KHỎI core-api" — nhưng Phase 4 đã sinh thẳng `search-service` như microservice own-DB ngay từ đầu (không có gì trong core-api để tách). Đây là trade-off có chủ đích: được kiến trúc đúng sớm hơn, đổi lại mất "câu chuyện migration" của discovery. Phase 7 re-anchor như sau:

### 🎯 Goal (mới)
Vẫn phô diễn **Strangler Fig + CDC replay**, nhưng trên target còn thật:
1. **Primary: tách `credit-ledger-service`** (sau Phase 5) — module event-sourced ACID-critical, đúng phương án thay thế đã ghi trong readme gốc. Strangler: build service mới own ledger DB → gateway route `/credits/*` → dual-run so khớp balance → cutover.
2. **CDC replay demo (làm được NGAY, không chờ Phase 5):** xóa `search_db` → replay `knowledge-events` từ offset 0 → search-service tự rebuild toàn bộ embeddings + ES index → verify kết quả search khớp trước-sau. Chứng minh "read model dựng lại được từ event log" — chính là giá trị của event backbone.

### Tình huống (giữ nguyên lý do scale/cô lập chi phí — áp cho credit-ledger)
- **ACID + audit độc lập** (sổ cái không được lệch, cần deploy/rollback riêng).
- **Cô lập blast-radius** (bug ở knowledge không được đụng ledger).
- **Hồ sơ tài nguyên khác** (append-heavy, rebuild theo replay).

### Deliverables

1. **Strangler Fig Pattern:**
   - Phase 7a: Xây `discovery-service` mới (sở hữu pgvector embeddings + ES client).
   - Phase 7b: API Gateway routing: `/api/v1/search/*` → service mới.
   - Phase 7c: Dual-run period (so sánh kết quả service mới vs cũ).
   - Phase 7d: Cutover — chỉ routing service mới. Xóa code cũ trong `core-api`.

2. **Data Migration (CDC):**
   - Replay `knowledge-events` để build lại embeddings ở service mới.
   - Verify: kết quả search service mới = service cũ (relevance regression test).

3. **Inter-service Communication:**
   - `core-api` gọi `discovery-service` qua Kafka (async re-index) hoặc gRPC (sync search).

### ✅ Acceptance Criteria
- Zero downtime during migration.
- Relevance không giảm sau migration (regression test pass).
- Old discovery code removed from `core-api`.
- `discovery-service` scale & đo chi phí AI độc lập.

---

## 🟤 PHASE 8 — OBSERVABILITY & PRODUCTION HARDENING

### 🎯 Goal
Sẵn sàng production. Đo đạc, giám sát, bảo mật chặt chẽ, đa tổ chức an toàn.

### Deliverables

1. **Observability Stack:**
   - **Distributed Tracing:** OpenTelemetry → Jaeger.
   - **Metrics:** Prometheus + Grafana dashboards (đã có nền tảng exporters).
   - **Logging:** Structured logging (Pino) → ELK Stack.
   - **Alert Rules:** High latency, DLQ depth, Circuit Breaker state, AI cost spike.

2. **Load Testing (K6):**
   - OCC: 10 concurrent edit cùng 1 doc → chỉ 1 thành công.
   - Search throughput: 1000 concurrent search → P99 < 500ms.
   - AI rate-limit: vượt quota → bị chặn đúng, không trừ credit.
   - Credit: 100 concurrent spend → no double-spend (Idempotency).

3. **Security & Tenant Hardening:**
   - Rate Limiting (Redis-backed Token Bucket) per user/org.
   - **Tenant isolation audit:** không rò rỉ dữ liệu chéo org (row-level + query guard).
   - **AI Data Boundary:** dữ liệu org A không bao giờ lọt vào ngữ cảnh RAG của org B.
   - CORS whitelist, secret rotation cho AI API key.

4. **Ledger Integrity Cron:**
   - Chạy hàng đêm: `Sum(credit events) == Current Balance` cho mọi org.
   - Bất kỳ drift nào → Alert + auto-rebuild balance.

### ✅ Acceptance Criteria
- Grafana dashboard hiển thị đầy đủ metrics cho mọi service.
- K6 load test pass tất cả thresholds.
- Tenant isolation audit: 0 cross-org leak.
- Ledger integrity cron chạy không phát hiện drift.

---

## 🚀 BƯỚC TIẾP THEO

Bắt đầu triển khai **Phase 1** — Xây dựng Multi-tenant Knowledge Monolith với Tenant, Knowledge, và Engagement modules.
