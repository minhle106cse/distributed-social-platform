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
| Phase 5 | **The Great Migration**| Trích xuất `economy-module` thành `economy-service` độc lập |
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
   - **`user-module`**: Quản lý hồ sơ cá nhân và kết nối định danh.
   - **`economy-module` (Wallet & Inventory)**: Quản lý Tiền tệ Kép (Karma, Bụi Sao), tính năng Gacha, Lò rèn đúc đồ, và Hệ thống Pity (Mảnh vỡ Key).
   - **`productivity-module` (Emotion Journaling)**: Quản lý Cây Vệ Thần, tiến trình Chuỗi (Streak), và cơ chế Ngủ đông (Hibernation). Chặn Text Bloat bằng Storage Isolation.
   - **`social-module` (Neighborhoods)**: Quản lý kết bạn, lưu trú Khu phố, đặc quyền Thị trưởng (Kick/Auto-Transfer) và Bảng xếp hạng Khu phố (Monument Energy).
3. **Database**: 1 Postgres DB cho `auth-service`, 1 Postgres DB cho `core-api` (với các schema/bảng được phân chia rạch ròi theo domain).

---

# 🟡 PHASE 2 — EVENT STREAMING BACKBONE (KAFKA)

# 🎯 Goal:
Chuẩn bị cho tương lai phân tán bằng cách áp dụng Event-Driven ngay trong Monolith.

# Deliverables:
1. **Outbox Pattern**: `core-api` ghi sự kiện vào bảng Outbox cùng lúc ghi data nhằm đảm bảo Transaction Guarantee trong Microservices.
2. **Kafka Integration**: Đọc Outbox và đẩy sự kiện lên các Kafka topics (`core-events`).
3. **Saga Pattern / Eventual Consistency**: Giải quyết tính nhất quán dữ liệu phân tán do không dùng Foreign Key. Ví dụ: mua Gacha (trừ tiền ở `economy-module`, sinh đồ ở inventory), hoặc bảo lãnh bạn bè.
4. **Vibe & Contribution Events**: Mọi hành động tương tác (Tưới hộ, Tặng quà, Check-in) đều đẩy event lên Kafka để cộng dồn Năng lượng Công trình Chung (Monument Energy).

---

# 🟣 PHASE 3 — CQRS & ELASTICSEARCH

# 🎯 Goal:
Thực hiện Full-text search siêu tốc mà không làm nặng Postgres.

# Deliverables:
1. **search-service (Kafka Consumer)**: Nghe sự kiện từ `core-api` để index dữ liệu vào Elasticsearch.
2. Index Nhật ký cảm xúc (Emotion Notes) từ hệ thống NoSQL sang Elasticsearch để user có thể search lại kỷ niệm nhanh chóng.
3. Cung cấp API tìm kiếm tổng hợp.
4. **Match-making Engine**: Xây dựng thuật toán ghép cặp ẩn danh (Vector Search) để kết nối những user có cùng chung tần số cảm xúc (Vibes) hoặc cần sự giúp đỡ lẫn nhau.

---

# 🟢 PHASE 4 — ASYNC WORKERS & REAL-TIME

# 🎯 Goal:
Xử lý các tác vụ nền nặng nề và thông báo thời gian thực.

# Deliverables:
1. **`worker-service`**: Tính toán Năng lượng Monument, Nightly Cronjob (Kiểm tra và Auto-Transfer Thị trưởng lúc 00:00), lưu Emotion Note vào NoSQL, gửi Email.
2. **`notification-service`**: WebSocket Server + Redis Pub/Sub Adapter. Bắn thông báo realtime khi có bạn bè "tưới hộ cây", tặng quà, hoặc Rương Co-op rơi xuống.
3. **`chat-service`**: Xử lý logic nhắn tin theo thời gian thực (Microservice độc lập) với kiến trúc scale ngang dựa trên Redis Pub/Sub.

---

# 🔴 PHASE 5 — THE GREAT MIGRATION (MICROSERVICE EXTRACTION)

# 🎯 Goal:
**Phô diễn kỹ năng Senior:** Làm sao để phá vỡ Monolith mà không gây downtime?

# Tình huống: 
Phân hệ `economy-module` (Gacha, Tiền tệ, Inventory) phát triển quá lớn, yêu cầu bảo mật tài chính khắt khe, cần scale riêng biệt và tuân thủ ACID chặt chẽ. Ta sẽ tách nó thành `economy-service`.

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
1. **VectorDB (`pgvector`)**: Lưu trữ Embedding Vector của nhật ký cảm xúc (Emotion Notes) để RAG hiểu được tâm lý của người dùng.
2. **MCP Server**: Tích hợp Model Context Protocol vào `core-api` để LLM có thể gọi các API nội bộ.
3. **AI Healing Companion (System Runtime Agent)**: AI NPC theo dõi tiến trình cảm xúc, thỉnh thoảng xuất hiện trong Khu vườn để tặng Bụi Sao hoặc nhắn tin khích lệ thay vì chỉ là một Noti khô khan. Dùng LangGraph/Python orchestrator.

---

# 🚀 BƯỚC TIẾP THEO
Bắt đầu triển khai **Phase 0** và thiết kế cấu trúc database cho `core-api`.