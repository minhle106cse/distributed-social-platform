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
| Phase 3 | CQRS & Search | Elasticsearch Indexing cho Search |
| Phase 4 | Async & Real-time | Worker (Feed fan-out), WebSocket Cluster |
| Phase 5 | **The Great Migration**| Trích xuất `expense-module` thành Microservice độc lập |
| Phase 6 | AIOps & Hardening | AI Agent quản trị, Observability, Load Test |

---

# 🔥 PHASE 0 — FOUNDATION & INFRASTRUCTURE

# 🎯 Goal:
Tạo môi trường phát triển local hoàn chỉnh và chuẩn hóa kiến trúc.

# Deliverables:
1. **Monorepo Setup**: Nx hoặc Turborepo.
2. **AI Agent Workflow**: Thiết lập thư mục `directives/` và `execution/` để quản trị hệ thống.
3. **Local Infra (Docker Compose)**: PostgreSQL, Redis, Kafka, Elasticsearch.
4. **Shared Packages**: `event-contracts`, `logger`.

---

# 🔷 PHASE 1 — THE MODULAR MONOLITH & CORE SERVICES

# 🎯 Goal:
Xây dựng Business Logic khổng lồ một cách gọn gàng trong một Monolith, kết hợp với các service vệ tinh bắt buộc.

# Deliverables:
1. **`auth-service` (Microservice)**: Xử lý Identity, JWT. Tách biệt hoàn toàn để bảo mật.
2. **`core-api` (Modular Monolith)**:
   - **`user-module`**: Quản lý Profile, Graph (Follow/Block).
   - **`post-module`**: Quản lý bài đăng, bình luận.
   - **`emotion-module`**: Ghi nhận cảm xúc hằng ngày (Thang điểm A, B, C, D).
   - **`expense-module`**: Quản lý thu chi cá nhân.
   - **`calendar-module` & `todo-module`**: Quản lý sự kiện, To-do list hằng ngày.
3. **Database**: 1 Postgres DB cho `auth-service`, 1 Postgres DB cho `core-api` (với các schema/bảng được phân chia rạch ròi).

---

# 🟡 PHASE 2 — EVENT STREAMING BACKBONE (KAFKA)

# 🎯 Goal:
Chuẩn bị cho tương lai phân tán bằng cách áp dụng Event-Driven ngay trong Monolith.

# Deliverables:
1. **Outbox Pattern**: `core-api` ghi sự kiện vào bảng Outbox cùng lúc ghi data.
2. **Kafka Integration**: Đọc Outbox và đẩy sự kiện lên các Kafka topics (`core-events`).
3. Tích hợp "Social Hook": Khi user đạt thành tựu bên `emotion-module`, đẩy event `MilestoneReached`. Catcher sẽ tạo một Post bên `post-module`.

---

# 🟣 PHASE 3 — CQRS & ELASTICSEARCH

# 🎯 Goal:
Thực hiện Full-text search siêu tốc mà không làm nặng Postgres.

# Deliverables:
1. **search-service (Kafka Consumer)**: Nghe sự kiện từ `core-api` để index dữ liệu vào Elasticsearch.
2. Index cả bài viết (Posts) và nhật ký thu chi (Expense Notes) để user có thể search nhanh chóng.
3. Cung cấp API tìm kiếm tổng hợp.

---

# 🟢 PHASE 4 — ASYNC WORKERS & REAL-TIME

# 🎯 Goal:
Xử lý các tác vụ nền nặng nề và thông báo thời gian thực.

# Deliverables:
1. **`worker-service`**: Tính toán Feed (Fan-out), gửi Email, tạo báo cáo chi tiêu tháng.
2. **`notification-service`**: WebSocket Server + Redis Pub/Sub Adapter. Bắn thông báo realtime khi có người tương tác bài viết hoặc nhắc nhở To-do list.

---

# 🔴 PHASE 5 — THE GREAT MIGRATION (MICROSERVICE EXTRACTION)

# 🎯 Goal:
**Phô diễn kỹ năng Senior:** Làm sao để phá vỡ Monolith mà không gây downtime?

# Tình huống: 
Phân hệ `expense-module` phát triển quá lớn, yêu cầu bảo mật tài chính cao hơn, và cần scale riêng biệt. Ta sẽ tách nó thành `finance-microservice`.

# Deliverables:
1. Xây dựng `finance-microservice` mới với Database riêng biệt.
2. **Dual-write / CDC**: Đồng bộ dữ liệu cũ từ `core-api` sang DB mới qua Kafka.
3. Chuyển hướng traffic từ API Gateway sang service mới.
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

# 🚀 BƯỚC TIẾP THEO
Bắt đầu triển khai **Phase 0** và thiết kế cấu trúc database cho `core-api`.