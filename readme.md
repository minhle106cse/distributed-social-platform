# 🚀 DISTRIBUTED SOCIAL PRODUCTIVITY PLATFORM — SENIOR BLUEPRINT

---

# 🧠 TẦM NHÌN DỰ ÁN (NORTH STAR & SUPER APP)

## Mục tiêu:
Đây không chỉ là một ứng dụng "Blog/Social Network" cơ bản với các tính năng tạo bài viết, comment, react. 
Dự án này hướng tới một **"Super App"** — sự kết hợp giữa **Mạng Xã Hội (Social)** và **Tiện ích Cá Nhân (Productivity/Utility)**.

Việc giải quyết logic nghiệp vụ (Business Logic) phức tạp chính là một kỹ năng cốt lõi của Senior Engineer.

---

# 🎯 DOMAIN NGHIỆP VỤ (BUSINESS LOGIC)

## 1. Social Domain (Lõi Mạng Xã Hội)
- **Identity & Graph**: Users, Followers, Following, Block, Mute.
- **Content & Interactions**: Bài viết đa phương tiện, Bình luận, Reacts, Shares.
- **Feed**: Timeline cá nhân hóa dựa trên người theo dõi và độ tương tác.

## 2. Productivity & Utility Domain (Lõi Tiện Ích)
- **Daily Emotion Tracker**:
  - Ghi lại cảm xúc mỗi ngày theo thang điểm và màu sắc: 🟢 A (Tuyệt vời), 🟡 B (Ổn), 🟠 C (Căng thẳng), 🔴 D (Tệ).
  - Viết nhật ký cá nhân (Private Journal).
  - Theo dõi chuỗi ngày tích cực (Streaks).
- **Expense Tracker**:
  - Ghi lại chi tiêu, thu nhập hằng ngày.
  - Phân loại chi tiêu, xuất báo cáo tổng kết tháng.
- **Calendar & To-do List**:
  - Lịch trình cá nhân (Calendar).
  - Quản lý công việc hằng ngày (To-do list), nhắc nhở deadline, đánh dấu hoàn thành.

## 3. The "Social Hook" (Giao điểm Nghiệp vụ)
Sự kết hợp giữa 2 lõi tạo ra điểm nhấn của hệ thống:
- Người dùng có thể **chia sẻ thành tựu** từ phần Tiện Ích lên Bảng Tin Xã Hội. 
- *Ví dụ*: "Đạt mốc 30 ngày liên tiếp giữ cảm xúc loại A 🟢!", "Đã hoàn thành 10 mục tiêu trong tuần này!", "Tiết kiệm được 50% thu nhập tháng!".

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
       Client (Web / Mobile)
               |
               v
     API Gateway / Ingress
               |
  +------------+-------------+
  |                          |
  v                          v
[Auth Service]         [Core API (Modular Monolith)]
(Microservice)           - user-module
                         - post-module
                         - emotion-module
                         - expense-module
                         - calendar-module
  |                          |
  v                          v
[DB: Auth]             [DB: Core (Logical Separation)]
                             |
                             v
                       [Outbox Table]
                             |
=========================================================
 🌊 KAFKA EVENT STREAMING BACKBONE
=========================================================
          |                  |                  |
          v                  v                  v
  [Worker Service]     [Search Service]   [Notification Service]
  (Feed Fan-out,       (ES Indexing)      (WebSockets + Redis)
   Email, Retry)
```

---

# 🧱 BOUNDARIES & EXTRACTION STRATEGY

## 1. `core-api` (Trái tim của hệ thống)
Chứa toàn bộ Business Logic. Dữ liệu nằm chung một PostgreSQL database nhưng được chia schema/table rõ ràng. KHÔNG JOIN chéo giữa các domain mà không thông qua interface.

## 2. Các Service được tách ngay từ đầu (Microservices):
- **`auth-service`**: Tách biệt hoàn toàn để cô lập bảo mật (JWT, Passwords).
- **`notification-service`**: Xử lý WebSocket có đặc thù giữ connection liên tục, scale hoàn toàn khác biệt so với REST API, cần Redis Pub/Sub.
- **`worker-service`**: Xử lý logic nền nặng nề (Feed fan-out, gửi email) để không chặn API response.

## 3. Future Migration Target:
Sau khi hệ thống ổn định, chúng ta sẽ thực hiện **The Great Migration**: Tách `expense-module` ra thành một `finance-microservice` hoàn toàn độc lập, sử dụng Event-Driven để đồng bộ dữ liệu mà không làm gián đoạn hệ thống.

---

# 🛠️ CÔNG NGHỆ ÁP DỤNG

- **Database**: PostgreSQL (kèm `pgvector` cho VectorDB).
- **Caching & Pub/Sub**: Redis.
- **Message Broker**: Kafka (cho Event Backbone, xử lý throughput lớn).
- **Search & RAG Engine**: Elasticsearch (Text Search) & VectorDB (Semantic Search / RAG).
- **Real-time**: WebSockets (có Redis adapter để scale ngang).
- **AI-Native & AIOps**: Xây dựng **System Runtime Agent** bằng Python, áp dụng **MCP (Model Context Protocol)** để giao tiếp, và **RAG** để tạo trí nhớ ngữ nghĩa cho trợ lý cá nhân.

---

# 🚀 NEXT IMMEDIATE ACTIONS
Vui lòng tham khảo file `readme.phases.md` để xem lộ trình xây dựng chi tiết từ Monolith đến Microservices.