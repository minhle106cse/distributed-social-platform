# 🚀 EXECUTION ROADMAP: FROM MONOLITH TO MICROSERVICES

---

# 🧠 MỤC TIÊU LỘ TRÌNH

Không áp dụng Microservices một cách mù quáng. Chúng ta sẽ bắt đầu bằng một **Modular Monolith** vững chắc cho Core Business, xây dựng nền tảng Event-Driven, và sau cùng sẽ chứng minh kỹ năng Senior bằng cách **Migrate** một module thành Microservice độc lập.

---

# 🏁 MASTER ROADMAP OVERVIEW

| Phase | Mục tiêu | Output |
|------|----------|--------|
| Phase 0 | Foundation & Infra | Monorepo, Docker Compose (Kafka, ES, Redis), AI Workflow |
| Phase 1 | Modular Monolith | `core-api` (Social + Productivity modules) & `auth-service` |
| Phase 2 | Event Backbone | Kafka Integration, Outbox Pattern trong `core-api` |
| Phase 3 | CQRS & Search | Elasticsearch (Text Search) & VectorDB (Semantic) |
| Phase 4 | Async Workers & Real-time | Worker, Notification, Chat Service |
| Phase 5 | **The Great Migration**| Trích xuất `wallet-module` thành `economy-service` độc lập |
| Phase 6 | AIOps & Hardening | AI Agent quản trị, Observability, Load Test |
| Phase 7 | AI-Native Ecosystem | System Runtime Agent, RAG, VectorDB (pgvector), MCP |

---

# 🔥 PHASE 0 — FOUNDATION & INFRASTRUCTURE

# 🎯 Goal:
Tạo môi trường phát triển local hoàn chỉnh và chuẩn hóa kiến trúc.

# Deliverables:
1. **Monorepo Setup**: Nx hoặc Turborepo.
2. **AI Agent Workflow**: Thiết lập thư mục `directives/` và `execution/` để quản trị hệ thống.
3. **Local Infra (Docker Compose)**: PostgreSQL, Redis, Kafka, Elasticsearch. *Lưu ý: Môi trường Local dùng Docker để dev, môi trường Production sẽ dùng AWS Serverless (API Gateway, Lambda) + Managed DB/Kafka (Neon, Upstash, MSK).*
4. **Shared Packages**: `event-contracts`, `logger`.

---

# 🔷 PHASE 1 — THE MODULAR MONOLITH & CORE SERVICES

# 🎯 Goal:
Xây dựng Business Logic khổng lồ một cách gọn gàng trong một Monolith, kết hợp với các service vệ tinh bắt buộc.

# Deliverables:
1. **`auth-service` (Microservice)**: Xử lý Identity, JWT. Tách biệt hoàn toàn để bảo mật.
2. **`core-api` (Modular Monolith)**:
   - **`user-module` & `profile-module`**: Quản lý Graph, Trust Score.
   - **`post-module`**: Quản lý bài đăng, hỗ trợ Proof of Work references.
   - **`productivity-module`**: Gộp chung Emotion, Expense, Todo (Bao gồm Build Habit & Quitting Habit).
   - **`wallet-module`**: Nền tảng giao dịch Tipping/Bounty với Optimistic Locking. Có giới hạn Global Daily Cap.
   - **`subscription-module`**: Quản lý gói Premium (Freemium) mở khóa không gian Nhà kính.
3. **Database**: 1 Postgres DB cho `auth-service`, 1 Postgres DB cho `core-api` (với các schema/bảng được phân chia rạch ròi).

---

# 🟡 PHASE 2 — EVENT STREAMING BACKBONE (KAFKA)

# 🎯 Goal:
Chuẩn bị cho tương lai phân tán bằng cách áp dụng Event-Driven ngay trong Monolith.

# Deliverables:
1. **Outbox Pattern**: `core-api` ghi sự kiện vào bảng Outbox cùng lúc ghi data nhằm đảm bảo Transaction Guarantee trong Microservices.
2. **Kafka Integration**: Đọc Outbox và đẩy sự kiện lên các Kafka topics (`core-events`).
3. **Saga Pattern / Eventual Consistency**: Giải quyết tính nhất quán dữ liệu phân tán do không dùng Foreign Key (Loose Reference). Ví dụ: `auth-service` phát event `USER_DELETED`, `core-api` nghe và tự xóa Post.
4. **Trust Score Events**: Mọi hành động tương tác đều đẩy event lên Kafka để tính điểm uy tín.

---

# 🟣 PHASE 3 — CQRS & ELASTICSEARCH

# 🎯 Goal:
Thực hiện Full-text search siêu tốc mà không làm nặng Postgres.

# Deliverables:
1. **search-service (Kafka Consumer)**: Nghe sự kiện từ `core-api` để index dữ liệu vào Elasticsearch.
2. Index cả bài viết (Posts) và nhật ký thu chi (Expense Notes) để user có thể search nhanh chóng.
3. Cung cấp API tìm kiếm tổng hợp.
4. **Match-making Engine**: Xây dựng thuật toán ghép cặp ẩn danh (Vector Search) để kết nối những user có cùng mục tiêu thói quen.

---

# 🟢 PHASE 4 — ASYNC WORKERS & REAL-TIME

# 🎯 Goal:
Xử lý các tác vụ nền nặng nề và thông báo thời gian thực.

# Deliverables:
1. **`worker-service`**: Tính toán Feed (Fan-out), Nightly Cronjob (Tính điểm Quitting Habits lúc 00:00), Reputation Worker (chấm điểm Trust Score real-time), gửi Email.
2. **`notification-service`**: WebSocket Server + Redis Pub/Sub Adapter. Bắn thông báo realtime khi có người tip/bounty hoặc tương tác.
3. **`chat-service`**: Xử lý logic nhắn tin theo thời gian thực (Microservice độc lập) với kiến trúc scale ngang dựa trên Redis Pub/Sub.

---

# 🔴 PHASE 5 — THE GREAT MIGRATION (MICROSERVICE EXTRACTION)

# 🎯 Goal:
**Phô diễn kỹ năng Senior:** Làm sao để phá vỡ Monolith mà không gây downtime?

# Tình huống: 
Phân hệ `wallet-module` (Micro-Bounty & Tipping) phát triển quá lớn, yêu cầu bảo mật tài chính khắt khe, cần scale riêng biệt và tuân thủ ACID chặt chẽ. Ta sẽ tách nó thành `economy-service`.

# Deliverables:
1. Xây dựng `economy-service` mới với Database riêng biệt.
2. **Dual-write / CDC**: Đồng bộ dữ liệu cũ từ `core-api` sang DB mới qua Kafka.
3. Chuyển hướng traffic từ API Gateway sang service mới (Strangler Fig Pattern).
4. Xóa code cũ khỏi `core-api`.

---

# 🤖 PHASE 6 — AIOPS & PRODUCTION HARDENING

# 🎯 Goal:
Sẵn sàng deploy thực tế và vận hành tự động.

# Deliverables:
1. **AI Operations (AIOps)**: Viết các Directives để AI Agent tự động dọn dẹp Dead Letter Queue (DLQ), kiểm tra đồng bộ dữ liệu giữa Postgres và Elasticsearch.
2. **Observability**: Distributed Tracing, Prometheus Metrics, Grafana.
3. **Security & Load Testing**: Rate limiting, K6 Load test.

---

# 🤖 PHASE 7 — AI-NATIVE PERSONAL ASSISTANT

# 🎯 Goal:
Nâng tầm ứng dụng thành "AI-Native Ecosystem" với một trợ lý ảo hiểu sâu sắc dữ liệu của user (RAG) và có thể tự động hành động (System Runtime Agent) thông qua MCP.

# Deliverables:
1. **VectorDB (`pgvector`)**: Lưu trữ Embedding Vector của nhật ký cảm xúc, chi tiêu, to-do list.
2. **MCP Server**: Tích hợp Model Context Protocol vào `core-api` để LLM có thể gọi các API nội bộ.
3. **AI Accountability Partner (System Runtime Agent)**: AI theo dõi thói quen, tự động kích hoạt API ẩn để đăng bài "Bóc phốt" hoặc "Khen thưởng" thay mặt user. Dùng LangGraph/Python orchestrator.

---

# 🚀 BƯỚC TIẾP THEO
Bắt đầu triển khai **Phase 0** và thiết kế cấu trúc database cho `core-api`.