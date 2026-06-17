# 💰 TEAMFIN — DISTRIBUTED TEAM FINANCE PLATFORM

[![Architecture](https://img.shields.io/badge/Architecture-Hexagonal%20%7C%20CQRS%20%7C%20Event--Sourcing-blue)](#-kiến-trúc-nâng-cao-showcase)
[![Progress](https://img.shields.io/badge/Progress-Phase%200%20(Foundation)-brightgreen)](#-tiến-độ-dự-án)
[![License](https://img.shields.io/badge/License-MIT-green)](#)

> 📖 **[English Version](./docs/en/README.md)**

## 📖 MỤC LỤC TÀI LIỆU

| # | Tài liệu | Mô tả |
|---|----------|-------|
| 💼 | [Yêu cầu Nghiệp vụ](./docs/01_business_requirements.md) | 4 trụ cột kinh doanh, quy tắc chia tiền, thuật toán tối ưu nợ |
| 📋 | [Kịch bản Sử dụng](./docs/02_use_cases.md) | Đặc tả luồng tương tác User ↔ System chi tiết |
| 🏗️ | [Kiến trúc & Sơ đồ Luồng](./docs/03_system_architecture_diagrams.md) | ERD, Sequence Diagrams, Data Flow chi tiết |
| 💾 | [Lược đồ CSDL](./docs/04_database_schema.md) | Prisma Schema, Event Sourcing tables, Read Model |
| 🎨 | [Tiêu chuẩn UI/UX](./docs/05_web_ui_ux_guidelines.md) | Dashboard layout, component specs, dark mode |
| 📡 | [Đặc tả API](./docs/06_api_contracts.md) | RESTful endpoints, Idempotency, Offline Sync |
| 🧩 | [Design System](./docs/07_design_system_assets.md) | Color tokens, typography, spacing, component specs |
| 🧪 | [Chiến lược Testing](./docs/08_testing_and_qa_strategy.md) | Ledger integrity, Saga rollback, OCC race condition |
| ☁️ | [Hạ tầng DevOps](./docs/09_devops_infrastructure.md) | Monorepo, Docker Compose, CI/CD |
| 🛡️ | [Bảo mật & Phân quyền](./docs/10_security_rbac.md) | Financial encryption, Group RBAC, Rate Limiting |
| 🚀 | [Lộ trình Thực thi](./readme.phases.md) | Roadmap 9 phases (0-8): Monolith → Microservices |

---

## 🧠 TẦM NHÌN DỰ ÁN

**TeamFin** là một nền tảng quản lý tài chính nhóm (Team Finance & Expense Splitting Platform) được xây dựng với kiến trúc phân tán cấp doanh nghiệp (Enterprise-grade Distributed Architecture).

### Bài toán thực tế

Mỗi ngày, hàng triệu nhóm bạn bè, đồng nghiệp, hội du lịch phải đối mặt với cùng một câu hỏi: *"Ai nợ ai bao nhiêu?"*

- 🏠 **Ở chung nhà** — Tiền điện, nước, internet, đồ ăn chung
- ✈️ **Du lịch nhóm** — Vé máy bay USD, khách sạn EUR, ăn uống VND
- 🍕 **Ăn uống nhóm** — "Tao trả trước, mày chuyển lại sau"
- 💼 **Chi phí team** — Công tác phí, quỹ nhóm, chi tiêu dự án

Các giải pháp hiện tại (Splitwise, Tricount) đều là ứng dụng đơn giản chạy trên một database monolithic. **TeamFin** giải quyết cùng bài toán nhưng bằng kiến trúc chuẩn Enterprise — Event Sourcing, CQRS, Saga Pattern — vì khi xử lý **tiền thật**, mọi pattern phân tán đều trở thành **bắt buộc**, không phải trang trí.

### Tại sao dự án này "Show off" System Design?

| Yêu cầu Fintech | System Design Pattern bắt buộc |
|---|---|
| Tiền phải kiểm toán được, không bao giờ xóa | **Event Sourcing** (sổ cái bất biến) |
| Xem dashboard 100x vs tạo expense 1x | **CQRS** (Read/Write tách biệt) |
| Trừ tiền A + Cộng tiền B phải atomic | **Saga Pattern** (Distributed Transaction) |
| Ghi DB + bắn event phải cùng transaction | **Outbox Pattern** |
| Bấm "Thanh toán" 2 lần do lag | **Idempotency Key** |
| 2 người sửa cùng 1 expense | **Optimistic Concurrency Control** |
| API tỷ giá bên thứ 3 bị down | **Circuit Breaker + Fallback** |
| Dashboard nhóm 50 người query liên tục | **Cache Strategy + Stampede Prevention** |
| Chống spam thanh toán | **Rate Limiting (Token Bucket)** |
| Worker gửi notification thất bại | **Dead Letter Queue + Retry** |

---

## 🏗️ TRIẾT LÝ KIẾN TRÚC: MODULAR MONOLITH FIRST

### Core Strategy
Bắt đầu bằng **Modular Monolith** chặt chẽ, và chỉ tách thành **Microservices** khi thực sự cần thiết hoặc để chứng minh khả năng Migration.

### Lý do
- **Tránh over-engineering**: Microservices toàn phần ngay từ đầu mang lại độ trễ mạng, đau đầu về distributed transaction, và chi phí hạ tầng không cần thiết.
- **Kỹ năng Migration**: Một trong những kỹ năng đắt giá nhất của Senior là biết cách *phá vỡ Monolith một cách an toàn (Zero-Downtime Migration)*. Dự án này chứng minh điều đó ở Phase 6.

---

## 🧭 SYSTEM ARCHITECTURE (CURRENT STATE)

```
         Client (React SPA — Dashboard + Forms)
                    |
                    v
          API Gateway / Ingress
                    |
       +------------+-------------+
       |                          |
       v                          v
 [Auth Service]          [Core API (Modular Monolith)]
 (Fastify Microservice)  ├── group-module
                         ├── expense-module  
                         ├── settlement-module
                         ├── balance-module (Read Model)
                         └── currency-module
       |                          |
       v                          v
 [DB: Auth]              [DB: Core (Event Store + Read Model)]
                                  |
                                  v
                           [Outbox Table]
                                  |
 =========================================================================
  🌊 KAFKA EVENT STREAMING BACKBONE
 =========================================================================
        |                  |                  |                  |                  |
        v                  v                  v                  v                  v
  [Worker Service]  [Search Service]  [Notification Svc]  [Exchange Rate Svc]  [Chat Service]
  (Debt Simplify,   (Phase X -        (WebSocket +        (Phase X - 3rd-      (Phase X - 
   Scheduled Jobs)   Future)           Push Notif)         party API)           Future)
```

---

## 🧱 BOUNDARIES & EXTRACTION STRATEGY

### 1. `core-api` (Trái tim hệ thống — Modular Monolith)

Chứa toàn bộ Business Logic. Dữ liệu nằm chung một PostgreSQL database nhưng được chia schema/table rõ ràng. KHÔNG JOIN chéo giữa các domain mà không thông qua interface.

**Modules:**
- **`group-module`** — Quản lý nhóm, thành viên, lời mời, phân quyền (Owner/Admin/Member/Viewer).
- **`expense-module`** — Tạo/sửa/xóa chi phí, chia tiền (đều/tỷ lệ/tùy chỉnh), Event Sourcing cho mọi giao dịch.
- **`settlement-module`** — Thanh toán nợ giữa các thành viên, Saga Pattern đảm bảo atomic.
- **`balance-module`** — Read Model (Materialized View). Tổng hợp ai nợ ai bao nhiêu từ Event Store. Được rebuild bất cứ lúc nào bằng cách replay events.
- **`currency-module`** — Quản lý đa tiền tệ. Gọi Exchange Rate API với Circuit Breaker. Cache tỷ giá.

### 2. Các Service tách riêng từ đầu (Microservices)

- **`auth-service`** (Fastify) — Cô lập bảo mật hoàn toàn. JWT, Passwords, Refresh Token Rotation.
- **`notification-service`** — WebSocket (real-time) + Push Notification. Scale ngang với Redis Pub/Sub adapter.
- **`worker-service`** — Background jobs: Debt Simplification algorithm, Scheduled reminders, Export PDF.
- **`search-service`** — Lắng nghe Kafka để index expenses/groups vào Elasticsearch.
- **`exchange-rate-service`** — Proxy bọc ngoài API tỷ giá bên thứ 3 (ExchangeRate-API, Fixer.io). Circuit Breaker + Fallback cache.

### 3. Future Migration Target (Phase 6)

Sau khi hệ thống ổn định, thực hiện **The Great Migration**: Tách `settlement-module` ra thành `settlement-service` hoàn toàn độc lập. Lý do: Settlement cần ACID cực kỳ chặt chẽ, scale riêng biệt, và có thể cần compliance riêng (PCI-DSS).

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
- Middleware Chain (tương tự Koa/Express):
  - `LoggingMiddleware` — Ghi log tự động cho mọi Command/Query.
  - `TransactionMiddleware` — Quản lý DB Transaction an toàn (AsyncLocalStorage).
  - `RetryMiddleware` — Auto-retry với Exponential Backoff khi DB gặp Transient Errors.
  - `IdempotencyMiddleware` — Kiểm tra Idempotency Key trước khi execute Command.

### 3. Event Sourcing (Sổ cái Bất biến)

Thay vì UPDATE balance trực tiếp, mọi thay đổi tài chính được lưu dưới dạng **Event bất biến (Immutable Events)**:

```
ExpenseCreatedEvent   → {groupId, payerId, amount, splits: [...], currency}
ExpenseUpdatedEvent   → {expenseId, changes: {amount: 500→600}, version: 2}
SettlementCreatedEvent → {fromUserId, toUserId, amount, currency}
```

**Balance = f(replay all events)**. Có thể rebuild Read Model bất cứ lúc nào bằng cách replay toàn bộ event stream. Đây chính xác là cách ngân hàng và sổ cái tài chính hoạt động.

### 4. Saga Pattern (Distributed Transaction)

Khi User A thanh toán nợ cho User B:

```
Step 1: Debit A's balance          → Success ✅
Step 2: Credit B's balance         → Fail ❌
Step 3: Compensate — Refund A      → Execute ✅ (Rollback)
```

Nếu bất kỳ bước nào thất bại, Saga Engine tự động chạy **Compensating Transactions** để rollback. Không dùng 2PC (Two-Phase Commit) vì gây block hệ thống.

### 5. Outbox Pattern (Atomic Event Publishing)

Ghi dữ liệu vào DB và publish event lên Kafka **cùng một database transaction**:

```sql
BEGIN TRANSACTION;
  INSERT INTO expenses (...) VALUES (...);
  INSERT INTO outbox_events (type, payload) VALUES ('ExpenseCreated', '{...}');
COMMIT;
```

Một CDC Connector (hoặc Polling Publisher) đọc `outbox_events` và đẩy lên Kafka. Đảm bảo **At-least-once delivery** — event không bao giờ bị mất.

### 6. Idempotency (Tính lũy đẳng)

Mọi API thay đổi trạng thái tài chính đều yêu cầu header `X-Idempotency-Key`:

```http
POST /api/v1/settlements
X-Idempotency-Key: settle-uuid-12345
```

Nếu Client gửi lại cùng request (do mạng lag, user double-click), Server nhận diện key đã xử lý và trả về kết quả cached — **không trừ tiền 2 lần**.

### 7. Circuit Breaker (Cầu dao Điện)

Exchange Rate Service gọi API bên thứ 3 (Fixer.io, ExchangeRate-API). Khi API bị down:

```
State: CLOSED (bình thường)
  → 5 lỗi liên tiếp → State: OPEN (ngắt cầu dao, trả fallback cache)
  → Sau 30s → State: HALF-OPEN (thử 1 request)
  → Thành công → CLOSED
  → Thất bại → OPEN lại
```

Không để 1 API bên thứ 3 chết kéo sập cả hệ thống.

### 8. Debt Simplification Algorithm (Thuật toán Tối ưu Nợ)

Bài toán NP-Hard: Nhóm 5 người, 20 giao dịch chồng chéo → Tối giản thành **số lần chuyển khoản ít nhất**.

```
Trước: A→B: 100, B→C: 50, C→A: 30, A→C: 20 (4 giao dịch)
Sau:   A→B: 70, A→C: 40                       (2 giao dịch) ← Tối ưu
```

Thuật toán: Tính net balance mỗi người → Greedy matching giữa debtors và creditors → Minimize number of transfers.

---

## 🤖 AI-DRIVEN DEVELOPMENT WORKFLOW

Dự án áp dụng hệ thống **Multi-Agent Orchestration (Level 4/5)**:

### Layered AI Architecture
- **Layer 0 (Harness Sandbox):** Container Docker chạy cách ly. Script chỉ chạy trong sandbox.
- **Layer 1 (Directives):** SOPs định nghĩa luật kiến trúc (Hexagonal, CQRS, Event Sourcing rules).
- **Layer 2 (Orchestration):** Agent điều phối, lập kế hoạch động.
- **Layer 3 (Execution):** Python scripts trong `execution/`, Memory Buffer trong `.ai/memory/*.jsonl`.

### Security Pattern
- **Sandbox Read-Only:** Môi trường sandbox chạy validators với quyền Read-Only.
- **Report → Execute:** Tools sinh code xuất báo cáo trước, Agent review rồi mới apply.

---

## 🛠️ CÔNG NGHỆ ÁP DỤNG

| Category | Technologies |
|----------|-------------|
| **Monorepo** | Turborepo |
| **Backend** | NestJS (`core-api`), Fastify (`auth-service`) |
| **ORM** | Prisma |
| **Database** | PostgreSQL (Event Store + Read Model) |
| **Cache & Pub/Sub** | Redis |
| **Message Broker** | Kafka (Event Backbone) |
| **Search** | Elasticsearch (Full-text search) |
| **Real-time** | WebSocket + Redis Pub/Sub adapter |
| **Frontend** | Vite + React 18 (SPA) |
| **State** | Zustand + TanStack Query |
| **Charts** | Recharts |
| **Styling** | TailwindCSS v3 + CSS Variables |
| **DevOps** | Docker Compose, CI/CD |
| **Testing** | Vitest, Testcontainers, K6 |

---

## 📈 TIẾN ĐỘ DỰ ÁN

Tiến độ hiện tại: **Phase 0 — Foundation & Scaffolding**

- [x] **Phase 0:** Foundation & Infra (Monorepo, Docker, AI Workflow, module scaffolds created)
- [ ] **Phase 1:** Modular Monolith — Group, Expense, Balance modules (NEXT)
- [ ] **Phase 2:** Event Backbone — Kafka, Outbox Pattern, Event Sourcing
- [ ] **Phase 3:** CQRS & Read Model Optimization
- [ ] **Phase 4:** Multi-currency & Exchange Rate Service (Circuit Breaker)
- [ ] **Phase 5:** Settlement & Saga
- [ ] **Phase 6:** Real-time & Workers
- [ ] **Phase 7:** The Great Migration — Tách `settlement-service`
- [ ] **Phase 8:** Production Hardening

📋 Chi tiết từng Phase: [readme.phases.md](./readme.phases.md)

---

## 🚀 KHỞI CHẠY NHANH

```bash
# 1. Clone
git clone https://github.com/yourname/team-finance-platform.git
cd team-finance-platform

# 2. Install dependencies
npm install

# 3. Start infrastructure (Postgres, Redis, Kafka, Elasticsearch)
docker-compose up -d

# 4. Run migrations
npx turbo run db:migrate

# 5. Start development
npx turbo run dev
```

---

## 🚀 BƯỚC TIẾP THEO

Xem [Lộ trình Thực thi (readme.phases.md)](./readme.phases.md) để nắm chi tiết roadmap từ Monolith đến Microservices.