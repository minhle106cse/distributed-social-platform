# 🚀 LỘ TRÌNH THỰC THI: TỪ MONOLITH ĐẾN MICROSERVICES

> 📖 **[English Version](./docs/en/README_PHASES.md)**

---

## 🧠 MỤC TIÊU LỘ TRÌNH

Không áp dụng Microservices một cách mù quáng. Bắt đầu bằng **Modular Monolith** vững chắc cho Core Business, xây dựng nền tảng Event-Driven, và cuối cùng chứng minh kỹ năng Senior bằng cách **Migrate** một module thành Microservice độc lập — **zero downtime**.

---

## 🏁 MASTER ROADMAP OVERVIEW

| Phase | Mục tiêu | Output chính | Pattern Showcase |
|-------|----------|-------------|-----------------|
| Phase 0 | Foundation & Infra | Monorepo, Docker, AI Workflow | Hexagonal Architecture |
| Phase 1 | Modular Monolith | `core-api` (Group, Expense, Balance) | Domain Isolation, OCC |
| Phase 2 | Event Backbone | Kafka, Outbox Pattern, Event Store | Event Sourcing, Outbox |
| Phase 3 | CQRS & Read Model | Tách Read/Write, Materialized Views | CQRS, Projection |
| Phase 4 | Multi-currency | Exchange Rate Service, Circuit Breaker | Circuit Breaker, Cache |
| Phase 5 | Settlement & Saga | Saga Orchestrator, Idempotency | Saga, Idempotency, DLQ |
| Phase 6 | Real-time & Workers | Notification Service, Worker Service | WebSocket, Pub/Sub |
| Phase 7 | **The Great Migration** | Tách `settlement-service` | Strangler Fig, CDC |
| Phase 8 | Production Hardening | Observability, Load Test, Security | Rate Limiting, Tracing |

---

## 🔷 PHASE 0 — FOUNDATION & INFRASTRUCTURE

### 🎯 Goal
Tạo môi trường phát triển local hoàn chỉnh và chuẩn hóa kiến trúc.

### Deliverables
1. **Monorepo Setup (Turborepo)**
   - `apps/core-api` — NestJS Modular Monolith
   - `apps/auth-service` — Fastify Microservice
   - `apps/web` — Vite + React SPA (Phase X - Future)
   - `apps/worker-service` — Background Jobs (Scaffolded)
   - `apps/notification-service` — WebSocket + Push (Scaffolded)
   - `apps/exchange-rate-service` — Currency API Proxy (Phase X - Future)
   - `apps/chat-service` — (Phase X - Future)

2. **Local Infra (Docker Compose)**
   - PostgreSQL (5432) — Core Database
   - Redis (6379) — Cache & Pub/Sub
   - Kafka (9092) + Zookeeper (2181) — Event Broker
   - Elasticsearch (9200) — Full-text Search

3. **Shared Packages**
   - `packages/shared-kernel` — Abstractions, interfaces, domain types, and common logger (Pino)
   - `packages/event-contracts` — Kafka Event Schema definitions (Phase X - Future)

4. **AI Agent Workflow**
   - `directives/` — SOPs cho kiến trúc, CQRS rules, Event Sourcing rules
   - `execution/` — Python scripts
   - `docker-compose.agent.yml` — Sandbox environment

### ✅ Acceptance Criteria
- `docker-compose up -d` khởi động toàn bộ infra không lỗi.
- `npx turbo run dev` chạy tất cả apps đồng thời.
- Hexagonal Architecture folder structure established.

---

## 🔷 PHASE 1 — MODULAR MONOLITH & CORE SERVICES

### 🎯 Goal
Xây dựng Business Logic cốt lõi trong Monolith gọn gàng.

### Deliverables

#### 1. `auth-service` (Fastify — đã có sẵn)
- JWT Access Token (15 phút) + Refresh Token Rotation.
- HTTP-Only Secure Cookie cho Refresh Token.
- Rate Limiting: 5 req/5 phút cho Login/Register.

#### 2. `core-api` Modules

**`group-module`:**
- CRUD nhóm: Create, Update, Archive, Delete (soft).
- Mời thành viên (Invite Link/QR Code), chấp nhận/từ chối lời mời.
- Phân quyền: Owner, Admin, Member, Viewer.
- Loại nhóm: `PERSISTENT`, `TRIP`, `QUICK_SPLIT`.

**`expense-module`:**
- Tạo expense với 4 phương thức chia: `EQUAL`, `EXACT`, `PERCENTAGE`, `SHARES`.
- Hỗ trợ nhiều người trả (multi-payer).
- Loại trừ thành viên khỏi expense cụ thể.
- Danh mục chi tiêu: `FOOD`, `TRANSPORT`, `ACCOMMODATION`...
- **OCC (Optimistic Concurrency Control):** Trường `version` chống race condition khi 2 người sửa cùng expense.

**`balance-module` (Read Model):**
- Tính toán "Ai nợ ai bao nhiêu" cho mỗi nhóm.
- Ma trận nợ đầy đủ (pairwise balances).
- Balance tính bằng Base Currency của nhóm.
- **Denormalized table** — tối ưu query, được rebuild từ events.

#### 3. Database
- 1 PostgreSQL cho `auth-service` (cô lập bảo mật).
- 1 PostgreSQL cho `core-api` (schema phân chia theo domain, KHÔNG FK chéo domain).

### ✅ Acceptance Criteria
- API CRUD Group hoạt động đầy đủ.
- API Create/Update/Delete Expense hoạt động với OCC.
- Balance tính đúng cho nhóm có 5+ thành viên và 10+ expenses.
- Unit tests cho logic chia tiền (EQUAL, EXACT, PERCENTAGE, SHARES).

---

## 🟡 PHASE 2 — EVENT BACKBONE (KAFKA + EVENT SOURCING)

### 🎯 Goal
Chuyển từ CRUD thuần sang **Event-Driven Architecture** + **Event Sourcing**.

### Deliverables

1. **Event Store Table:**
   ```
   EventStore: { id, aggregateType, aggregateId, eventType, payload, version, createdAt }
   ```
   - Mọi thay đổi tài chính (Create/Update/Delete Expense, Settlement) được lưu dưới dạng Event bất biến.
   - Không bao giờ UPDATE hoặc DELETE row trong Event Store.

2. **Outbox Pattern:**
   - Ghi Event Store + Outbox Event trong cùng 1 DB Transaction.
   - CDC Connector (hoặc Polling Publisher) đọc Outbox và đẩy lên Kafka.
   - Topics: `expense-events`, `settlement-events`, `group-events`.

3. **Rebuild Read Model:**
   - Balance Module subscribe Kafka events.
   - Khi nhận `ExpenseCreatedEvent` → update pairwise balance table.
   - **Replay capability:** Script rebuild toàn bộ balance từ Event Store.

4. **Idempotency Table:**
   ```
   IdempotencyRecord: { key, response, createdAt, expiresAt }
   ```
   - Mọi Command thay đổi tài chính kiểm tra Idempotency Key trước khi execute.

### ✅ Acceptance Criteria
- Tạo expense → Event Store có record + Outbox có record + Kafka nhận event.
- Rebuild balance từ Event Store cho kết quả identical với current balance.
- Gửi cùng Idempotency Key 2 lần → chỉ tạo 1 expense.
- DLQ hoạt động: message lỗi schema vào DLQ topic.

---

## 🟣 PHASE 3 — CQRS & READ MODEL OPTIMIZATION

### 🎯 Goal
Tách biệt hoàn toàn Write Model (Event Store) và Read Model (Dashboard).

### Deliverables

1. **Materialized Views:**
   - `balance_summary` — Ai nợ ai bao nhiêu (per pair, per group).
   - `spending_by_category` — Chi tiêu theo danh mục.
   - `monthly_spending` — Xu hướng chi tiêu theo tháng.
   - `group_statistics` — Tổng chi, số thành viên active, top spender.

2. **Search Service (Elasticsearch):**
   - Index expenses → Full-text search (tìm kiếm expense theo note/description).
   - Index groups → Search groups by name.

3. **Caching Strategy:**
   - Redis cache cho Balance Summary (hot data).
   - Cache invalidation: Khi nhận Kafka event → Invalidate cache.
   - **Stampede Prevention:** Distributed Lock — chỉ 1 request rebuild cache, còn lại chờ.

4. **Query Optimization:**
   - Read API không bao giờ đụng Event Store.
   - Tất cả Read query chạy trên Materialized View + Redis cache.

### ✅ Acceptance Criteria
- Dashboard load < 200ms cho nhóm 50 thành viên.
- Full-text search expenses hoạt động.
- Cache invalidation đúng thời điểm (tạo expense → cache mới trong < 1s).

---

## 🟠 PHASE 4 — MULTI-CURRENCY & EXCHANGE RATE SERVICE

### 🎯 Goal
Hỗ trợ đa tiền tệ với Exchange Rate Service có Circuit Breaker.

### Deliverables

1. **`exchange-rate-service` (Microservice):**
   - Proxy bọc ngoài API tỷ giá bên thứ 3 (ExchangeRate-API).
   - **Circuit Breaker** (3 states: CLOSED → OPEN → HALF-OPEN).
   - Cache tỷ giá 1 giờ trong Redis.
   - Fallback: Khi Circuit OPEN, trả cached rate gần nhất.

2. **Currency Module trong `core-api`:**
   - Mỗi expense lưu: `amount`, `currency`, `exchangeRate` (tỷ giá tại thời điểm tạo).
   - `convertedAmount` = amount × exchangeRate (quy về Base Currency).
   - Balance luôn tính bằng Base Currency.

3. **Currency Formatting:**
   - VND: `500,000₫` (không thập phân).
   - USD: `$50.00` (2 chữ số thập phân).
   - Hiển thị cả gốc + quy đổi: `$50 (≈ 1,250,000₫)`.

### ✅ Acceptance Criteria
- Tạo expense USD trong nhóm VND → Balance tính đúng bằng VND.
- Khi Exchange Rate API down → Circuit Breaker OPEN → Fallback cache hoạt động.
- Tỷ giá pinned vào expense không thay đổi khi tỷ giá biến động.

---

## 🔴 PHASE 5 — SETTLEMENT & SAGA PATTERN

### 🎯 Goal
Implement Settlement (thanh toán nợ) với **Saga Pattern** và **Debt Simplification**.

### Deliverables

1. **Settlement Flow (Saga Orchestration):**
   ```
   CreateSettlementCommand
     → Step 1: Validate balances
     → Step 2: Create SettlementCreatedEvent (Event Store)
     → Step 3: Update Balance Read Model
     → Step 4: Publish to Kafka → Notification
   
   If Step 3 fails:
     → Compensate: Create SettlementFailedEvent
     → Revert Balance
     → Notify user: "Settlement failed, please try again"
   ```

2. **Debt Simplification Algorithm (Worker Service):**
   - API: `POST /api/v1/groups/{id}/simplify-debts`
   - Thuật toán Greedy Net Balance (O(n log n)).
   - Trả về **gợi ý** danh sách settlements tối ưu.
   - User xác nhận từng khoản.

3. **Settlement Types:** `FULL`, `PARTIAL`, `RECORD_ONLY`.

4. **Notification Flow:**
   - Settlement created → Push + WebSocket → Người nhận tiền.
   - Settlement failed → Push → Người trả tiền.

### ✅ Acceptance Criteria
- Saga rollback hoạt động: Khi Step 3 fail → Balance không bị thay đổi.
- Idempotency: Settle cùng key 2 lần → chỉ 1 settlement record.
- Debt Simplification: Nhóm 5 người, 10 expenses → Output ≤ 4 suggested settlements.

---

## 🟢 PHASE 6 — REAL-TIME & WORKERS

### 🎯 Goal
Thông báo thời gian thực + Xử lý tác vụ nền.

### Deliverables

1. **`notification-service`:**
   - WebSocket Server (Socket.IO) + Redis Pub/Sub adapter (scale ngang).
   - Subscribe Kafka topics (`expense-events`, `settlement-events`).
   - Real-time push: Expense mới, Expense sửa, Settlement hoàn tất.
   - Push Notification: Nhắc nợ (Reminder), Budget Alert, Trip ending.

2. **`worker-service`:**
   - **Scheduled Reminders:** Nhắc nợ tự động (tuần/tháng tùy cài đặt).
   - **Auto-Archive:** Đánh dấu Archive cho nhóm Trip/QuickSplit khi hết thời gian + settled.
   - **Export PDF:** Generate báo cáo chi tiêu nhóm.
   - **Debt Simplification Cron:** Tính lại suggested settlements định kỳ.

3. **DLQ Handling:**
   - Worker lỗi → Message vào DLQ topic.
   - Alert cho developer khi DLQ có message.
   - Manual replay DLQ endpoint.

### ✅ Acceptance Criteria
- Tạo expense → Tất cả members online nhận WebSocket event < 500ms.
- Push notification gửi thành công cho members offline.
- DLQ: Message lỗi vào DLQ, không crash worker.

---

## 🔴 PHASE 7 — THE GREAT MIGRATION (MICROSERVICE EXTRACTION)

### 🎯 Goal
**Phô diễn kỹ năng Senior:** Tách `settlement-module` ra thành `settlement-service` độc lập — zero downtime.

### Tình huống
Settlement cần:
- **ACID cực chặt** (liên quan đến tiền).
- **Scale riêng biệt** (burst khi cuối tháng settle nhiều).
- **Compliance riêng** (có thể cần PCI-DSS sau này).

### Deliverables

1. **Strangler Fig Pattern:**
   - Phase 7a: Xây dựng `settlement-service` mới với DB riêng.
   - Phase 7b: API Gateway routing: `/api/v1/settlements/*` → service mới.
   - Phase 7c: Dual-write period (ghi cả 2 DB để verify).
   - Phase 7d: Cutover — chỉ routing service mới. Xóa code cũ trong `core-api`.

2. **Data Migration (CDC — Change Data Capture):**
   - Replay Event Store cho settlement events → Populate DB mới.
   - Verify: Balance tính từ DB mới = Balance tính từ DB cũ.

3. **Inter-service Communication:**
   - `settlement-service` gọi `core-api` qua Kafka events (async).
   - Hoặc gRPC (sync, khi cần response ngay).

### ✅ Acceptance Criteria
- Zero downtime during migration.
- Balance sau migration = Balance trước migration (byte-level verification).
- Old settlement code removed from `core-api`.
- `settlement-service` scale independently.

---

## 🟤 PHASE 8 — OBSERVABILITY & PRODUCTION HARDENING

### 🎯 Goal
Sẵn sàng production. Đo đạc, giám sát, bảo mật chặt chẽ.

### Deliverables

1. **Observability Stack:**
   - **Distributed Tracing:** OpenTelemetry → Jaeger.
   - **Metrics:** Prometheus + Grafana dashboards.
   - **Logging:** Structured logging (Pino) → ELK Stack.
   - **Alert Rules:** High latency, DLQ depth, Circuit Breaker state changes.

2. **Load Testing (K6):**
   - Race Condition: 10 concurrent requests cùng 1 expense → chỉ 1 thành công (OCC).
   - Throughput: 1000 concurrent users tạo expenses → P99 latency < 500ms.
   - Saga: 100 concurrent settlements → No double-settle (Idempotency).

3. **Security Hardening:**
   - Rate Limiting (Redis-backed Token Bucket).
   - Financial data encryption at rest.
   - API key rotation for Exchange Rate Service.
   - CORS whitelist.

4. **Ledger Integrity Cron:**
   - Chạy hàng đêm: `Sum(events) == Current Balance` cho mọi group.
   - Bất kỳ drift nào → Alert + auto-rebuild balance.

### ✅ Acceptance Criteria
- Grafana dashboard hiển thị đầy đủ metrics cho mọi service.
- K6 load test pass tất cả thresholds.
- Ledger integrity cron chạy không phát hiện drift.
- Rate limiting block requests spam.

---

## 🚀 BƯỚC TIẾP THEO

Bắt đầu triển khai **Phase 1** — Xây dựng Modular Monolith với Group, Expense, và Balance modules.