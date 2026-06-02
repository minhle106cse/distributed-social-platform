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

# 🧠 TẦM NHÌN DỰ ÁN: GROWTHGARDEN V2 (AESTHETIC SOCIAL GAME)

**Khẳng định cốt lõi:** Đây không phải là một ứng dụng To-do list tự kỷ. Đây là một **Trò chơi Nông trại Thẩm mỹ (Aesthetic Farming Game)** kết hợp với **Mạng Xã Hội Khép Kín**. Sinh ra với một triết lý duy nhất: *Chữa lành mà chơi một mình thì vô vị. Ứng dụng này là cầu nối để bạn và hội bạn thân cùng nhau phát triển.*

## 🎮 GAMEPLAY CORE LOOP (What does this app actually do?)

Dự án vận hành trên một vòng lặp kinh tế và tương tác xã hội gây nghiện, lồng ghép khéo léo với việc ghi nhận nhật ký cảm xúc hằng ngày:

### 1. 🌲 Nông trại & Nền kinh tế (Farming & Pháo đài Tiền tệ kép)
- **Gieo mầm Cảm xúc:** Hành trình tâm lý của bạn được đại diện bởi một mầm cây ảo với đồ họa Indie/Cozy. Điểm danh Cảm xúc (A-F) hằng ngày kèm Note để nuôi dưỡng cây.
- **Tiền mềm (Karma) & Tiền cứng (Bụi Sao):** Bấm "Điểm danh" -> Cây nhận EXP và rớt Karma dùng cho các tác vụ hỗ trợ (refresh shop, cứu bạn). Tuy nhiên, để MUA hoặc NÂNG CẤP đồ xịn (Epic/Legendary), bạn bắt buộc phải dùng Bụi Sao (rớt ra ở các mốc chuỗi lớn hoặc Rương Co-op). Thiết kế Tiền tệ kép đập tan vấn nạn "cày clone rửa đồ".
- **Thương nhân Thần Bí (Gacha & Pity System):** Dùng Karma để Refresh cửa hàng, Bụi Sao để mua rương. Có cơ hội xuất hiện **Key** cực hiếm. Để chống xui xẻo, mỗi lần trượt Key sẽ nhận 1 **Mảnh vỡ Không gian**. Tích đủ 100 mảnh sẽ đúc được 1 Key (Bảo hiểm rủi ro).
- **Lò rèn Thẩm mỹ (Crafting/Merging):** Đốt các vật phẩm cấp thấp (Common) để đúc thành đồ Sử thi (Epic) hoặc Huyền thoại (Legendary). Đây là "hố đen" tiêu tiền (Sink) chống lạm phát tuyệt đối.
- **Mở khóa Không gian:** Bằng cách thu thập **nhiều Key** hiếm hoi, bạn có quyền mở khóa các vùng đất mới như *Vườn Trên Mây* hoặc *Nhà Kính Tuyết*. Đòi hỏi nhiều Key để tránh phá vỡ end-game do yếu tố quá may mắn.

### 2. 🤝 Tương tác Xã hội (The Social Lifeline)
- **Khu Phố Thẩm Mỹ & Sunk Cost Exit:** Người chơi kết bạn 1-1, sau đó mời bạn bè "định cư" chung vào một Khu Phố (giới hạn 8-10 người). Thị trưởng (người tạo Khu phố) có toàn quyền đuổi thành viên toxic. Bất cứ ai rời khỏi Khu phố (tự nguyện hay bị đuổi) đều sẽ **mất trắng** công sức đóng góp cho không gian chung. Trải nghiệm "Sunk Cost Exit" này khóa chặt hành vi bào tài nguyên và triệt tiêu gánh nặng transaction bù trừ của Backend NestJS.
- **Hỗ trợ, Bảo lãnh & AI NPC:** Bạn bè có thể "Tưới hộ" cứu cây héo, hoặc dùng Karma để "Bảo lãnh" khôi phục Streak cho người khác. Hệ thống còn có các **AI NPC Hỗ trợ** thỉnh thoảng xuất hiện ngẫu nhiên tặng quà khích lệ cho những user đang hoạt động, tạo niềm vui mà không sinh ra lỗ hổng Fake Churn.
- **Mùa giải & Chống Ký Sinh:** Xây dựng Công trình chung (Đài phun nước/Tháp đồng hồ) để săn rương siêu hiếm. Tuy nhiên, chỉ những ai có **đóng góp > 0** mới được mở Rương, chống lại nạn "ký sinh" chờ ăn sẵn. Leaderboard vinh danh các Khu phố dựa trên "Độ kiên trì" và "Sắc đẹp".

### 3. 🛡️ Ý chí & Sự kiên cường (Non-Cringe Resilience)
- Trò chơi loại bỏ hoàn toàn các khái niệm "task" hay "thói quen" khô khan, mọi hành trình ý chí đều được đại diện bằng **Cây Vệ Thần** tỏa ra Khiên Năng Lượng.
- **Nhật ký Cảm xúc (Emotion Check-in):** Chọn **Cảm xúc (A-F)** hằng ngày để giữ chuỗi (Streak). Ghi chú (Note) là tính năng Tùy chọn để chặn "gõ bừa text", giảm phình to Database. Mốc thưởng Bụi sao (7, 21, 66) tính bằng **Số ngày điểm danh thực tế**, bóp nghẹt trò lách luật bằng ngày nghỉ.
- **Hibernation Cooldown:** Lỡ chuỗi có thể dùng Karma rã đông trong 3 ngày. Sau khi rã đông sẽ có thời gian "Dưỡng thương" (Cooldown). Nếu bỏ điểm danh lúc này, Cây chết lập tức, chặn đứng lỗ hổng "điểm danh 1 ngày, nghỉ 3 ngày".
- Khi bạn lỡ phá giới, khiên bảo vệ bị rạn nứt thành **Năng lượng hỗn loạn (Corrupted Aura)** và Streak bị đóng băng. Bạn phải "Thanh lọc" khu vực đó bằng một phần **Tỷ lệ % Karma hiện có** trong ví, hoặc nếu cạn tiền có thể chọn **Nhiệm vụ Sám hối** (khóa tính năng trang trí 3 ngày để chuộc lỗi) thay vì bị phạt bằng những con số tuyệt đối phi lý.

Sự khác biệt của dự án chính là việc dùng **Kiến trúc Phân tán (Kafka, CQRS, Event-Driven)** để gánh vác các bài toán Game Logic phức tạp, Economy Ledger và Real-time Social thay vì chỉ làm các thao tác CRUD cơ bản.

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
(Microservice)         - user-module
                       - economy-module
                       - productivity-module
                       - social-module
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
  (Background Jobs)  (ES Indexing)    (Global WebSockets)    (Real-time MSG)
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
Sau khi hệ thống ổn định, chúng ta sẽ thực hiện **The Great Migration**: Tách `economy-module` ra thành một `economy-service` hoàn toàn độc lập, sử dụng Event-Driven để đồng bộ dữ liệu mà không làm gián đoạn hệ thống.

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

## 4. Offline-First PWA & High-Concurrency Patterns
Dự án không chỉ là một ứng dụng Web bình thường, mà là một PWA xử lý mượt mà bài toán mất kết nối mạng và xung đột dữ liệu:
- **Offline Grace Period (Auth):** Service Worker (SW) đứng ra làm Proxy. Nếu rớt mạng mà Access Token hết hạn, SW KHÔNG đá văng user ra màn hình Login. Thay vào đó, nó cấp trạng thái `Pending_Auth` để user tiếp tục lưu Local Queue (IndexedDB), đảm bảo trải nghiệm Offline mượt mà.
- **Optimistic Concurrency Control (OCC):** Chống Race Condition khi đồng bộ dữ liệu. Nếu bạn đang offline và một người bạn "cứu" cây của bạn, Server dùng trường `@Version` để bắt xung đột. Server từ chối ghi đè dữ liệu cũ của bạn lên, cập nhật UI và hoàn tiền Karma vào `Pending Stash`.
- **Seed-based RNG (Gacha):** Gacha yêu cầu Online, nhưng để xóa bỏ độ trễ (Latency), Server cấp trước mã `Cryptographic Seed` cho Client. Client dùng Seed chạy ngay animation mượt mà, đồng thời ngầm xác minh giao dịch trên Server để chống hack DevTools.
- **Asynchronous Storage Isolation:** Chặn đứng hiện tượng "Phình to dữ liệu văn bản" (Text Bloat). Ghi chú (Note) của người dùng không lưu vào DB chính mà ném qua Kafka/SQS để Worker âm thầm xử lý vào NoSQL hoặc Schema độc lập, bảo vệ Core DB khỏi thắt nút cổ chai I/O.

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