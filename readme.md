# 🚀 DISTRIBUTED SOCIAL PRODUCTIVITY PLATFORM — SENIOR BLUEPRINT

[![Progress](https://img.shields.io/badge/Progress-25%25%20(Foundation%20Done)-brightgreen)](#-progress-tracking)
[![Architecture](https://img.shields.io/badge/Architecture-Hexagonal%20%7C%20CQRS-blue)](#-advanced-architectural-implementations)
[![AI Workflow](https://img.shields.io/badge/AI%20Workflow-Level%204%2F5%20Autonomous-purple)](#-ai-driven-development-workflow)

📖 **TÀI LIỆU QUAN TRỌNG:**
- 💼 [Yêu cầu Nghiệp vụ (Business Requirements)](./docs/01_business_requirements.md)
- 📋 [Đặc tả Kịch bản Sử dụng (Use Cases)](./docs/02_use_cases.md)
- 🏗️ [Sơ đồ Kiến trúc & Luồng dữ liệu (Tech Specs & Diagrams)](./docs/03_system_architecture_diagrams.md)
- 💾 [Lược đồ Cơ sở dữ liệu (Database Schema)](./docs/04_database_schema.md)
- 🎨 [Tiêu chuẩn UI/UX & Optimistic UI (Web UI/UX Guidelines)](./docs/05_web_ui_ux_guidelines.md)
- 📡 [Đặc tả API & Offline Sync (API Contracts)](./docs/06_api_contracts.md)
- 🧩 [Tài nguyên Hệ thống Thiết kế (Design System Assets)](./docs/07_design_system_assets.md)
- 🧪 [Chiến lược KĐCL & Kiểm toán (Testing & QA Strategy)](./docs/08_testing_and_qa_strategy.md)
- ☁️ [Kiến trúc Hạ tầng & Triển khai (DevOps Infrastructure)](./docs/09_devops_infrastructure.md)
- 🛡️ [Bảo mật & Phân quyền AI (Security & RBAC)](./docs/10_security_rbac.md)
- 🚀 [Lộ trình Thực thi & Kiến trúc Phân mảnh (Phases Roadmap)](./readme.phases.md)

---

# 🧠 TẦM NHÌN DỰ ÁN: GROWTHGARDEN V2 (COZY & HEALING)

## Mục tiêu:
Dự án này đã chuyển mình từ một ứng dụng quản lý khô khan thành một **Hệ sinh thái Bền vững (Sustainable Ecosystem)** mang tên **GrowthGarden V2**. 
Đây là sự kết hợp hoàn hảo giữa **Tiện ích Phát triển bản thân (Habit/Productivity)** và **Mạng Xã hội Chữa lành (Cozy Social)**. 
Ứng dụng từ bỏ các mô hình ép buộc, trừng phạt hay mạng xã hội khoe khoang để hướng tới trải nghiệm thấu cảm, nơi mỗi thói quen là một "mầm cây có linh hồn".

Việc giải quyết logic nghiệp vụ (Gamification, Economy, Eventual Consistency) phức tạp chính là một kỹ năng cốt lõi của Senior Engineer.

---

# 🎯 DOMAIN NGHIỆP VỤ (BUSINESS LOGIC)

## 1. Social Domain (Cozy Social Island)
- **Private Graph & Match-making**: Không có News Feed hay tìm kiếm tự do để tránh toxic. Bạn bè được kết nối qua Invite-only hoặc hệ thống Match-making ẩn danh ghép cặp những người cùng mục tiêu (VD: cùng muốn bỏ thuốc lá).
- **Garden Hopping & Empathetic Help**: Bạn bè ghé thăm vườn và "Tưới hộ" nếu thấy cây héo (giới hạn số lần/ngày, không làm cây phát triển thay user).
- **Co-op World Tree**: Cây thần đồng đội với nhiều nhánh, chỉ tiến hóa khi toàn bộ nhóm đều nỗ lực (Fair-play).

## 2. Productivity Domain (Tamagotchi Habits)
- **Build Habits (Mầm cây)**: Thói quen tích cực lớn lên khi được tưới. Quên làm task không bị phạt mất streak, cây chỉ "Héo úa" (Loss Aversion qua sự thấu cảm).
- **Quitting Habits (Cây Vệ thần)**: Thói quen cần từ bỏ có vòng đời ngược. Chỉ nhận điểm lúc 00:00 nếu không phá giới. Nếu lỡ phá giới, cây không héo mà bị "Trúng độc" (cần Karma để giải cứu).
- **Emotion Weather**: Tâm trạng quyết định thời tiết khu vườn. Có cơ chế thưởng cho nỗi buồn (nấm phát sáng, mưa tự tưới cây).
- **Hibernation & Grace Period**: Cơ chế Ngủ đông (Spring Cleaning) và Quyền hồi tố (chống Permadeath và xoa dịu tâm lý người dùng khi lỡ quên check-in).

## 3. The "Killer Features" (Nghiệp vụ mức độ Senior)
Sự khác biệt của dự án không nằm ở thao tác CRUD cơ bản, mà là cách giải quyết các bài toán phân tán, bất đồng bộ và nhất quán dữ liệu:
- 🔥 **Event-Driven Gamification**: Mọi action (tưới cây, hoàn thành task) đều phát event qua Kafka. Worker xử lý chấm điểm Karma, cập nhật thời tiết. Quitting Habits được quét bằng Nightly Cronjob để đảm bảo logic.
- 🔥 **AI Empathetic Gardener**: Dùng AI (RAG) đọc lịch sử cảm xúc và gửi thư động viên, tặng Stardust. AI hoàn toàn Read-only với Core DB để chống thao túng trạng thái.
- 🔥 **Economy & Anti-Inflation**: Hệ thống ví Karma có **Global Daily Cap** (mức trần cày tiền mỗi ngày) để chống lạm phát. Gacha hoàn toàn không dùng tiền thật (No Pay-to-Win). Áp dụng **Saga Pattern** và Optimistic Locking cho giao dịch.
- 🔥 **Freemium & Premium Subscriptions**: Mô hình sinh tồn bằng việc bán "Không gian mở rộng" (Nhà kính tuyết, Vườn trên mây) và "Phân tích AI chuyên sâu" thay vì bán vật phẩm ảnh hưởng đến Gameplay.

---

# 🏗️ TRIẾT LÝ KIẾN TRÚC: MODULAR MONOLITH FIRST

## Core Strategy:
Bắt đầu bằng **Modular Monolith** chặt chẽ, và chỉ tách thành **Microservices** khi thực sự cần thiết hoặc để chứng minh khả năng Migration.

## Lý do:
- **Tránh over-engineering**: Microservices toàn phần ngay từ đầu sẽ mang lại độ trễ mạng, đau đầu về distributed transaction, và chi phí hạ tầng không cần thiết.
- **Kỹ năng Migration**: Một trong những kỹ năng đắt giá nhất của Senior là biết cách *phá vỡ Monolith một cách an toàn (Zero-Downtime Migration)*.

---

# 🧭 SYSTEM ARCHITECTURE (CURRENT STATE)

```txt
       Client (Modern Web App)
               |
               v
     API Gateway / Ingress
               |
  +------------+-------------+
  |                          |
  v                          v
[Auth Service]         [Core API (Modular Monolith)]
(Microservice)           - user-module
                         - profile-module
                         - post-module
                         - productivity-module
                         - wallet-module
  |                          |
  v                          v
[DB: Auth]             [DB: Core (Logical Separation)]
                             |
                             v
                       [Outbox Table]
                             |
=========================================================================
 🌊 KAFKA EVENT STREAMING BACKBONE
=========================================================================
          |                  |                  |                  |
          v                  v                  v                  v
  [Worker Service]   [Search Service] [Notification Service] [Chat Service]
  (Feed Fan-out)     (ES Indexing)    (Global WebSockets)    (Real-time MSG)
```

---

# 🧱 BOUNDARIES & EXTRACTION STRATEGY

## 1. `core-api` (Trái tim của hệ thống)
Chứa toàn bộ Business Logic. Dữ liệu nằm chung một PostgreSQL database nhưng được chia schema/table rõ ràng. KHÔNG JOIN chéo giữa các domain mà không thông qua interface.

## 2. Các Service được tách ngay từ đầu (Microservices):
- **`auth-service`**: Tách biệt hoàn toàn để cô lập bảo mật (JWT, Passwords).
- **`notification-service`**: Xử lý WebSocket có đặc thù giữ connection liên tục, scale hoàn toàn khác biệt so với REST API, cần Redis Pub/Sub.
- **`worker-service`**: Xử lý logic nền nặng nề (Feed fan-out, gửi email) để không chặn API response.
- **`search-service`**: Lắng nghe Kafka để index dữ liệu vào Elasticsearch, phục vụ Full-text search siêu tốc.
- **`chat-service`**: Xử lý logic nhắn tin theo thời gian thực (Microservice độc lập).

## 3. Future Migration Target:
Sau khi hệ thống ổn định, chúng ta sẽ thực hiện **The Great Migration**: Tách `wallet-module` ra thành một `economy-service` hoàn toàn độc lập, sử dụng Event-Driven để đồng bộ dữ liệu mà không làm gián đoạn hệ thống.

---

# 🔥 ADVANCED ARCHITECTURAL IMPLEMENTATIONS (SHOWCASE)

Dự án được xây dựng trên một nền móng kiến trúc chuẩn mực và cực kỳ khắt khe, chứng minh khả năng kiểm soát độ phức tạp:

## 1. Hexagonal Architecture (Ports & Adapters)
Thiết lập ranh giới (Boundaries) tuyệt đối giữa Logic Nghiệp vụ và Cơ sở hạ tầng:
- **`common/` (Pure POJO):** Chứa abstractions, interfaces. Tuyệt đối KHÔNG chứa code của Framework (NestJS/Fastify) hay ORM (Prisma).
- **`infrastructure/`:** Triển khai cụ thể các Adapters (Prisma Client, Framework Decorators, Interceptors).
- Dependency Injection (DI) được thiết kế linh hoạt để Inject các thành phần từ `infrastructure/` vào `modules/` thông qua các Interface định nghĩa ở `common/`.

## 2. In-House CQRS (Command Query Responsibility Segregation)
Thay vì phụ thuộc vào `@nestjs/cqrs` (vốn dính chặt với NestJS), dự án tự xây dựng hệ thống **CQRS Bus độc lập hoàn toàn khỏi Framework**:
- Chạy mượt mà trên cả **NestJS** (`core-api`) và **Fastify** (`auth-service`).
- Áp dụng pattern **Middleware Chain** (tương tự Koa/Express) vào trong CommandBus để xử lý:
  - `LoggingMiddleware`: Ghi log tự động.
  - `TransactionMiddleware`: Quản lý giao dịch DB an toàn không rò rỉ (AsyncLocalStorage).
  - `RetryMiddleware`: Tự động Retry với Exponential Backoff khi DB gặp Transient Errors.

## 3. Asynchronous Event-Driven Cronjobs (Chống DB Bottlenecks)
Để giải quyết bài toán "Quá tải lúc 00:00" khi quét state của hàng chục ngàn user:
- Tuyệt đối không dùng Cronjob nguyên khối (Monolithic Cron) thực hiện query đồng bộ vào DB chính (gây lock table, CPU spike).
- Áp dụng mô hình Queue-based: Cronjob nhẹ chỉ làm nhiệm vụ trigger tạo ra các sự kiện `CheckHabitStatusEvent` đẩy vào Kafka/SQS.
- Các **Worker Nodes** sẽ consume queue này và xử lý bất đồng bộ (giảm tải dần dần từ 00:00 đến 02:00 sáng). Kỹ thuật này giúp dàn trải tải trọng (Load Leveling), tránh crash DB và giữ cho API chính luôn đạt độ trễ thấp nhất.
- **Hàng rào DLQ & Idempotency (Bảo toàn dữ liệu):** Mọi event đẩy vào queue BẮT BUỘC mang theo `targetDate` và `idempotencyKey`. Nếu xảy ra lỗi schema drift, event bị rớt vào **DLQ (Dead Letter Queue)**. Nhờ có `targetDate`, khi kỹ sư sửa lỗi và Replay DLQ, hệ thống vẫn cập nhật đúng trạng thái cho ngày quá khứ mà không bị ghi đè nhầm sang ngày hiện đại. Đảm bảo toàn vẹn dữ liệu tuyệt đối (Data Integrity).

---

# 🤖 AI-DRIVEN DEVELOPMENT WORKFLOW

Đây là dự án tiên phong áp dụng hệ thống **Multi-Agent Orchestration (Level 4/5)** vào quy trình phát triển, với hệ thống bảo mật AI chặt chẽ nhất.

## 1. Layered AI Architecture
- **Layer 0 (Harness Sandbox):** Container Docker chạy cách ly.
- **Layer 1 (Directives):** Các SOP (Standard Operating Procedures) định nghĩa luật kiến trúc (Folder Structure, CQRS Pattern, AI Rules).
- **Layer 2 (Orchestration):** Agent linh hoạt điều phối công việc.
- **Layer 3 (Execution):** Kho vũ khí Python script nằm trong thư mục `execution/`.

## 2. The "Circuit Breaker" Security Pattern (Bảo mật tuyệt đối)
Ngăn chặn hoàn toàn rủi ro AI phá hoại source code (Hallucinations):
- **Sandbox Read-Only:** Môi trường `agent-sandbox` chạy công cụ đánh giá (Validators, Code Analyzers) với quyền **Read-Only**.
- **Report ➡️ Execute:** Các tool sinh code không bao giờ được ghi thẳng vào source. Chúng xuất báo cáo ra file nháp (`.tmp/`). AI Orchestrator (chính là Agent) đóng vai trò "Circuit Breaker", tự đọc báo cáo và cẩn thận dùng native tool của mình để áp dụng thay đổi vào mã nguồn.

## 3. Self-Annealing & Memory Buffer (Vòng lặp tự học)
- AI có khả năng học từ sai lầm của chính mình (Experience Buffer lưu trong `agent_memory.json`).
- Luôn kiểm tra Memory và SOP trước khi quyết định can thiệp vào các kiến trúc phức tạp.

---

# 📈 PROGRESS TRACKING

Tiến độ dự án hiện tại: **25% (Foundation Done)**

- [x] **Phase 0:** Foundation & Infra (Monorepo, Docker, AI Workflow).
- [ ] **Phase 1:** The Modular Monolith & Core Services (`core-api`, `auth-service`). *[Đang thực hiện - Xong Foundation]*
- [ ] **Phase 2:** Event Streaming Backbone (Kafka, Outbox Pattern).
- [ ] **Phase 3:** CQRS & Search (Elasticsearch).
- [ ] **Phase 4:** Async Workers & Real-time (Worker, Notification, Chat).
- [ ] **Phase 5:** The Great Migration (Tách `economy-microservice`).
- [ ] **Phase 6:** AIOps & Production Hardening.
- [ ] **Phase 7:** AI-Native Ecosystem (RAG, System Runtime Agent).

---

# 🛠️ CÔNG NGHỆ ÁP DỤNG

- **Architecture & DevOps**: Turborepo (Monorepo), Docker & Docker Compose.
- **Backend Frameworks**: NestJS (`core-api`), Fastify (`auth-service`).
- **ORM / Database Tools**: Prisma.
- **Databases**: PostgreSQL (kèm `pgvector` cho VectorDB).
- **Caching & Pub/Sub**: Redis.
- **Message Broker**: Kafka (cho Event Backbone, xử lý throughput lớn).
- **Search & RAG Engine**: Elasticsearch (Text Search) & VectorDB (Semantic Search / RAG).
- **Real-time**: WebSockets (có Redis adapter để scale ngang).
- **AI-Native & AIOps**: Xây dựng **System Runtime Agent** bằng Python, áp dụng **MCP (Model Context Protocol)** để giao tiếp, và **RAG** để tạo trí nhớ ngữ nghĩa cho trợ lý cá nhân.

---

# 🚀 NEXT IMMEDIATE ACTIONS
Vui lòng tham khảo file `readme.phases.md` để xem lộ trình xây dựng chi tiết từ Monolith đến Microservices.