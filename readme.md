# 🧠 CORTEX — AI-POWERED TEAM KNOWLEDGE HUB

[![Architecture](https://img.shields.io/badge/Architecture-Hexagonal%20%7C%20CQRS%20%7C%20Event--Sourcing-blue)](#-kiến-trúc-nâng-cao-showcase)
[![AI](https://img.shields.io/badge/AI-RAG%20%7C%20pgvector%20%7C%20Hybrid%20Search-purple)](#-trí-tuệ-khám-phá-rag--hybrid-retrieval)
[![Progress](https://img.shields.io/badge/Progress-Phase%200%20(Foundation)-brightgreen)](#-tiến-độ-dự-án)
[![License](https://img.shields.io/badge/License-MIT-green)](#)

> 📖 **[English Version](./docs/en/README.md)**

## 📖 MỤC LỤC TÀI LIỆU

| # | Tài liệu | Mô tả |
|---|----------|-------|
| 💼 | [Yêu cầu Nghiệp vụ](./docs/01_business_requirements.md) | 5 trụ cột: Knowledge, AI Discovery, Credit Economy, Reputation, Multi-tenancy |
| 📋 | [Kịch bản Sử dụng](./docs/02_use_cases.md) | Đặc tả luồng tương tác User ↔ System chi tiết |
| 🏗️ | [Kiến trúc & Sơ đồ Luồng](./docs/03_system_architecture_diagrams.md) | Topology, RAG pipeline, Sequence Diagrams, Data Flow |
| 💾 | [Lược đồ CSDL](./docs/04_database_schema.md) | Prisma Schema, Event Store, Read Model, pgvector embeddings |
| 🎨 | [Tiêu chuẩn UI/UX](./docs/05_web_ui_ux_guidelines.md) | Search-first UX, RAG answer + citations, credit wallet |
| 📡 | [Đặc tả API](./docs/06_api_contracts.md) | RESTful endpoints, Idempotency, Tenant scoping |
| 🧩 | [Design System](./docs/07_design_system_assets.md) | Color tokens, typography, spacing, component specs |
| 🧪 | [Chiến lược Testing](./docs/08_testing_and_qa_strategy.md) | Ledger integrity, AI-Saga refund, Tenant isolation |
| ☁️ | [Hạ tầng DevOps](./docs/09_devops_infrastructure.md) | Monorepo, Docker Compose, Observability |
| 🛡️ | [Bảo mật & Phân quyền](./docs/10_security_rbac.md) | Multi-tenant RBAC, AI data boundary, Rate Limiting |
| 🚀 | [Lộ trình Thực thi](./readme.phases.md) | Roadmap 9 phases (0-8): Monolith → Microservices |

---

## 🧠 TẦM NHÌN DỰ ÁN

**Cortex** là một **nền tảng tri thức nội bộ cho team/công ty (Internal Knowledge Hub)** được trang bị AI, xây dựng bằng kiến trúc phân tán cấp doanh nghiệp (Enterprise-grade Distributed Architecture).

### Bài toán thực tế

Tri thức của một tổ chức **tản mát khắp nơi** — Slack, Notion, Google Drive, Confluence, và quan trọng nhất: **trong đầu vài người chủ chốt**. Hệ quả mỗi ngày:

- 🔍 **"Cái này ai biết?"** — Hỏi đi hỏi lại cùng một câu, người mới mất hàng tuần để onboard.
- 📄 **Tài liệu chết** — Viết xong không ai tìm thấy; search bằng keyword không ra vì không nhớ đúng từ khóa.
- 🧠 **Bus factor** — Một người nghỉ việc, cả mảng kiến thức biến mất.
- 😮‍💨 **Lười document** — Không ai muốn viết lại vì "viết xong cũng chẳng ai đọc".

Các giải pháp hiện tại (Glean, Notion AI, Confluence) chứng minh đây là thị trường thật. **Cortex** giải cùng bài toán nhưng bằng kiến trúc chuẩn Enterprise — **RAG + Hybrid Search, Event Sourcing, CQRS, Saga** — vì khi xử lý **tri thức + AI tốn tiền + dữ liệu nhiều tổ chức**, mọi pattern phân tán đều trở thành **bắt buộc**, không phải trang trí.

### Tại sao dự án này "Show off" System Design?

Triết lý cốt lõi: **mỗi yêu cầu nghiệp vụ ÉP BUỘC một System Design Pattern** — không pattern nào là trang trí.

| Yêu cầu nghiệp vụ | System Design Pattern bắt buộc |
|---|---|
| Credit (mua bằng tiền) phải kiểm toán, không bao giờ sai số | **Event Sourcing** (sổ cái bất biến) |
| Đọc/search tri thức 1000x vs ghi 1x | **CQRS** (Read/Write tách biệt) |
| Tiêu credit gọi AI → nếu AI fail phải hoàn lại credit | **Saga Pattern** (Distributed Transaction) |
| Ghi document + bắn event re-index/re-embed phải atomic | **Outbox Pattern** |
| Bấm "Hỏi AI" 2 lần do lag | **Idempotency Key** |
| 2 người sửa cùng 1 runbook (wiki) | **Optimistic Concurrency Control** |
| Nhà cung cấp AI/embedding (Claude) bị down | **Circuit Breaker + Fallback** |
| Một câu hỏi hot được 500 người search cùng lúc | **Cache + Stampede Prevention** |
| Gọi AI rất ĐẮT → chống lạm dụng | **Rate Limiting (Token Bucket)** |
| Worker re-index thất bại | **Dead Letter Queue + Retry** |
| Tìm tài liệu theo NGỮ NGHĨA, không phải keyword | **Vector Search (pgvector)** |
| Search full-text + filter + facet | **Elasticsearch (Hybrid Retrieval)** |
| Mỗi tổ chức cô lập dữ liệu, quota riêng, chống noisy-neighbor | **Multi-tenancy** |

---

## 🏗️ TRIẾT LÝ KIẾN TRÚC: MODULAR MONOLITH FIRST

### Core Strategy
Bắt đầu bằng **Modular Monolith** chặt chẽ, và chỉ tách thành **Microservices** khi thực sự cần thiết hoặc để chứng minh khả năng Migration.

### Lý do
- **Tránh over-engineering**: Microservices toàn phần ngay từ đầu mang lại độ trễ mạng, đau đầu về distributed transaction, và chi phí hạ tầng không cần thiết.
- **Kỹ năng Migration**: Một trong những kỹ năng đắt giá nhất của Senior là biết cách *phá vỡ Monolith một cách an toàn (Zero-Downtime Migration)*. Dự án này chứng minh điều đó ở Phase 7 — tách `discovery-service` (workload AI-bound, cần cô lập scale & chi phí).

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
  🌊 KAFKA EVENT STREAMING BACKBONE
 =========================================================================
        |                  |                   |                    |
        v                  v                   v                    v
  [Worker Service]   [Search Service]   [Notification Svc]    [Chat Service]
  (Embeddings,       (Kafka → ES        (WebSocket +          (AI Assistant /
   re-index, RAG      indexer)           Redis Pub/Sub)        threads, presence)
   summarize, digest)
```

---

## 🧱 BOUNDARIES & EXTRACTION STRATEGY

### 1. `core-api` (Trái tim hệ thống — Modular Monolith)

Chứa toàn bộ Business Logic. Dữ liệu nằm chung một PostgreSQL database nhưng được chia schema/table rõ ràng. KHÔNG JOIN chéo giữa các domain mà không thông qua interface.

**Modules:**
- **`tenant-module`** — Tổ chức (Organization), Workspace, membership, cấu hình & quota theo tenant.
- **`knowledge-module`** — Document/Question/Answer/Runbook/ADR. Wiki-style với OCC + versioning. Sổ cái nội dung bất biến qua event.
- **`taxonomy-module`** — Spaces/Collections, tags/topics, subscribe.
- **`engagement-module`** — Vote, accept answer, verify (đánh dấu "đã kiểm chứng"), bookmark, follow.
- **`discovery-module`** — **Hybrid Search**: kết hợp Elasticsearch (full-text) + pgvector (semantic) + RAG orchestration để trả lời câu hỏi kèm trích dẫn nguồn.
- **`credit-module`** — **Event-sourced ledger**: purchase / spend / stake / award / refund credit. Saga đảm bảo atomic.
- **`reputation-module`** — Điểm uy tín + badge, gamify hành vi đóng góp tri thức.
- **`feed-module`** — Read Model (Materialized View): "Mới trong Spaces của bạn", trending, digest.

### 2. Các Service tách riêng từ đầu (Microservices)

- **`auth-service`** (Fastify) — Cô lập bảo mật hoàn toàn. JWT, Passwords, Refresh Token Rotation, org-scoped RBAC.
- **`notification-service`** — WebSocket (real-time) + Push Notification. Scale ngang với Redis Pub/Sub adapter.
- **`worker-service`** — Background jobs: **sinh embeddings**, re-index, AI summarization, digest email, phát hiện tài liệu lỗi thời (stale detection), cron badge.
- **`search-service`** — Lắng nghe Kafka để index documents vào Elasticsearch.
- **`chat-service`** — Thảo luận realtime + **AI Assistant (RAG chatbot)** + presence.

### 3. Future Migration Target (Phase 7)

Sau khi hệ thống ổn định, thực hiện **The Great Migration**: Tách `discovery-module` ra thành `discovery-service` độc lập. Lý do: workload AI/vector **bị giới hạn bởi tài nguyên (AI-bound), đắt đỏ, và bursty** — cần scale riêng và cô lập chi phí. *(Phương án thay thế để showcase ACID: tách `credit-ledger-service`.)*

---

## 🔥 KIẾN TRÚC NÂNG CAO (SHOWCASE)

### 1. Hexagonal Architecture (Ports & Adapters)

Thiết lập ranh giới tuyệt đối giữa Logic Nghiệp vụ và Cơ sở hạ tầng:

- **`common/` (Pure POJO):** Abstractions, interfaces, domain types. Tuyệt đối KHÔNG chứa code Framework (NestJS) hay ORM (Prisma).
- **`infrastructure/`:** Triển khai cụ thể các Adapters (Prisma Client, Framework Decorators, Interceptors).
- **Dependency Injection:** Inject từ `infrastructure/` vào `modules/` thông qua interfaces định nghĩa ở `common/`.

### 2. In-House CQRS (Command Query Responsibility Segregation)

Tự xây dựng hệ thống **CQRS Bus độc lập hoàn toàn khỏi Framework** (không dùng `@nestjs/cqrs`):

- Chạy mượt mà trên cả **NestJS** (`core-api`) và **Fastify** (`auth-service`).
- Middleware Chain: `LoggingMiddleware` → `RetryMiddleware` → `TransactionMiddleware` → Handler.
- `IdempotencyMiddleware` kiểm tra Idempotency Key trước khi execute Command.

### 3. Event Sourcing (Sổ cái Credit Bất biến)

Thay vì UPDATE số dư credit trực tiếp, mọi thay đổi được lưu dưới dạng **Event bất biến**:

```
CreditPurchasedEvent → {orgId, packId, amount: +1000, source: "billing"}
CreditSpentEvent     → {orgId, userId, amount: -5, reason: "ai_query", queryId}
CreditRefundedEvent  → {orgId, userId, amount: +5, reason: "ai_failed", queryId}
CreditAwardedEvent   → {orgId, userId, amount: +10, reason: "answer_accepted"}
```

**Balance = f(replay all events)**. Có thể rebuild Read Model bất cứ lúc nào. Đây chính xác là cách sổ cái tài chính hoạt động — nhưng ở đây là **credit ảo** (không bao giờ rút ra tiền mặt) ⇒ đầy đủ rigor kế toán nhưng nhẹ rủi ro pháp lý.

### 4. Saga Pattern (AI-Query & Bounty)

Khi User gọi AI để hỏi (RAG):

```
Step 1: Reserve credit (trừ tạm)       → Success ✅
Step 2: Gọi Claude API (RAG)           → Fail ❌ (timeout / provider down)
Step 3: Compensate — Refund credit     → Execute ✅ (Rollback)
```

Nếu bất kỳ bước nào thất bại, Saga Engine tự động chạy **Compensating Transactions**. Bounty saga cũng tương tự: stake credit → accept answer → award → badge → notify, fail ở bất kỳ đâu thì hoàn nguyên.

### 5. Outbox Pattern (Atomic Event Publishing)

Ghi dữ liệu vào DB và publish event lên Kafka **cùng một database transaction**:

```sql
BEGIN TRANSACTION;
  INSERT INTO documents (...) VALUES (...);
  INSERT INTO outbox_events (type, payload) VALUES ('DocumentPublished', '{...}');
COMMIT;
```

Một CDC Connector (hoặc Polling Publisher) đọc `outbox_events` và đẩy lên Kafka → các consumer **re-index (ES)** và **re-embed (pgvector)**. Đảm bảo **At-least-once delivery**.

### 6. Idempotency (Tính lũy đẳng)

Mọi API tốn credit (gọi AI) đều yêu cầu header `X-Idempotency-Key`. Nếu Client gửi lại cùng request (mạng lag, double-click), Server nhận diện key đã xử lý và trả về kết quả cached — **không trừ credit 2 lần**.

### 7. Circuit Breaker (Cầu dao quanh AI Provider)

`discovery-module` / `worker-service` gọi API bên thứ 3 (Claude embedding/summarization). Khi API bị down:

```
State: CLOSED (bình thường)
  → 5 lỗi liên tiếp → State: OPEN (ngắt cầu dao, rơi về keyword search / cached embeddings)
  → Sau 30s → State: HALF-OPEN (thử 1 request)
  → Thành công → CLOSED · Thất bại → OPEN lại
```

Không để một nhà cung cấp AI chết kéo sập toàn bộ tính năng search.

### 8. 🧠 Trí tuệ Khám phá: RAG + Hybrid Retrieval

Trái tim của Cortex là **Hybrid Retrieval**: kết hợp 2 thế giới để cho kết quả tốt nhất.

```
Query: "làm sao rotate JWT secret khi deploy?"
   │
   ├──► Elasticsearch (BM25 full-text) ──► top-K theo keyword
   │
   ├──► pgvector (cosine similarity)   ──► top-K theo ngữ nghĩa (embedding)
   │
   ▼
Reciprocal Rank Fusion (RRF) ──► hợp nhất & re-rank
   │
   ▼
RAG: nạp top-N đoạn + câu hỏi vào Claude ──► câu trả lời kèm TRÍCH DẪN NGUỒN
```

- **Embedding** sinh bất đồng bộ bởi `worker-service` (qua Kafka), lưu vào cột `vector` của pgvector.
- **Citation bắt buộc:** mỗi câu trả lời AI đều dẫn lại document nguồn → chống "AI bịa" (hallucination), người dùng kiểm chứng được.

---

## 🤖 AI-DRIVEN DEVELOPMENT WORKFLOW

Dự án áp dụng hệ thống **Multi-Agent Orchestration (Level 4/5)** để chính AI xây dựng dự án:

### Layered AI Architecture
- **Layer 0 (Harness Sandbox):** Container Docker chạy cách ly (`docker-compose.agent.yml`). Script chỉ chạy trong sandbox, Read-Only.
- **Layer 1 (Directives):** SOPs định nghĩa luật kiến trúc (Hexagonal, CQRS, Event Sourcing rules) trong `directives/`.
- **Layer 2 (Orchestration):** Agent điều phối, lập kế hoạch động, dùng sub-agent cho task lớn.
- **Layer 3 (Execution):** Python scripts trong `execution/`, Memory Buffer trong `.ai/memory/*.jsonl`, Knowledge Index trong `.ai/KNOWLEDGE_INDEX.md`.

### Security Pattern
- **Sandbox Read-Only:** Tools chạy validator với quyền Read-Only, xuất report ra `.tmp/`.
- **Report → Execute:** Tool sinh report trước, Agent review rồi mới apply (Circuit Breaker pattern cho AI).

> 📎 Lưu ý: RAG/MCP/Vector vừa là **công nghệ sản phẩm** (Cortex), vừa là **công cụ của AI workflow** — dự án này dùng chính những pattern nó xây để tự phát triển.

---

## 🛠️ CÔNG NGHỆ ÁP DỤNG

| Category | Technologies |
|----------|-------------|
| **Monorepo** | Turborepo |
| **Backend** | NestJS (`core-api`), Fastify (`auth-service`) |
| **ORM** | Prisma v7 |
| **Database** | PostgreSQL + **pgvector** (Event Store + Read Model + Embeddings) |
| **Cache & Pub/Sub** | Redis |
| **Message Broker** | Kafka (Event Backbone, KRaft mode) |
| **Search** | Elasticsearch (Full-text) + pgvector (Semantic) → Hybrid |
| **AI** | Claude (embedding + RAG summarization) qua Circuit Breaker |
| **Real-time** | WebSocket + Redis Pub/Sub adapter |
| **Frontend** | Vite + React 18 (SPA) |
| **State** | Zustand + TanStack Query |
| **Styling** | TailwindCSS v3 + CSS Variables |
| **DevOps** | Docker Compose, Prometheus + Grafana, CI/CD |
| **Testing** | Jest/Vitest, Testcontainers, K6 |

---

## 📈 TIẾN ĐỘ DỰ ÁN

Tiến độ hiện tại: **Phase 0 — Foundation & Scaffolding**

- [x] **Phase 0:** Foundation & Infra (Monorepo, Docker, AI Workflow, module scaffolds)
- [ ] **Phase 1:** Multi-tenant Knowledge Monolith — Tenant, Knowledge, OCC versioning (NEXT)
- [ ] **Phase 2:** Event Backbone — Kafka, Outbox, Event Store, Credit ledger event-sourced
- [ ] **Phase 3:** CQRS & Read Model — Feed/Digest projections, Redis cache
- [ ] **Phase 4:** AI Search & Discovery — pgvector + Elasticsearch Hybrid + RAG (Circuit Breaker)
- [ ] **Phase 5:** Credit Economy & Saga — Spend/Stake, AI-Query Saga, Idempotency, DLQ
- [ ] **Phase 6:** Real-time & Workers — Notification, Chat/AI-Assistant
- [ ] **Phase 7:** The Great Migration — Tách `discovery-service`
- [ ] **Phase 8:** Production Hardening — Observability, Tenant-isolation, Load Test

📋 Chi tiết từng Phase: [readme.phases.md](./readme.phases.md)

---

## 🚀 KHỞI CHẠY NHANH

```bash
# 1. Clone
git clone https://github.com/yourname/cortex-knowledge-hub.git
cd cortex-knowledge-hub

# 2. Install dependencies
npm install

# 3. Start infrastructure (Postgres+pgvector, Redis, Kafka, Elasticsearch, Monitoring)
docker-compose up -d

# 4. Run migrations
npx turbo run db:migrate

# 5. Start development
npx turbo run dev
```

---

## 🚀 BƯỚC TIẾP THEO

Xem [Lộ trình Thực thi (readme.phases.md)](./readme.phases.md) để nắm chi tiết roadmap từ Monolith đến Microservices.
