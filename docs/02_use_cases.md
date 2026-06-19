# 📋 KỊCH BẢN SỬ DỤNG (SYSTEM USE CASES)

> 📖 **[English Version](./en/02_use_cases.md)**

Tài liệu mô tả các luồng tương tác **User ↔ System** của **Cortex**. Mỗi use case ghi rõ: Actor, Tiền điều kiện, Luồng chính, Luồng thay thế/lỗi, và **Pattern liên quan** (để truy vết tới kiến trúc).

## 👥 Actors
| Actor | Mô tả |
|------|------|
| **Owner** | Chủ org, quản lý billing & credit |
| **Admin** | Quản trị thành viên, space, moderation |
| **Member** | Người dùng thường: viết, hỏi, search, vote |
| **Guest** | Chỉ đọc space được mời |
| **AI Assistant** | Tác nhân hệ thống (RAG) trả lời câu hỏi |
| **Worker** | Tiến trình nền (embedding, digest, stale detection) |

---

## 🟦 NHÓM A — TỔ CHỨC & THÀNH VIÊN (Multi-tenancy)

### UC-A1: Tạo Organization & Workspace
- **Actor:** Owner
- **Luồng chính:** Đăng ký → tạo Org (tên, slug) → hệ thống tạo `orgId`, cấp credit pack dùng thử → tạo Space đầu tiên.
- **Pattern:** Tenant provisioning; mọi entity con gắn `orgId`.

### UC-A2: Mời thành viên
- **Actor:** Owner/Admin
- **Luồng chính:** Tạo invite link (gắn role mặc định) → người được mời accept → join org với role tương ứng.
- **Lỗi:** Link hết hạn / vượt seat quota → từ chối, gợi ý nâng gói.
- **Pattern:** Org-scoped RBAC, quota per tenant.

### UC-A3: Phân quyền & cô lập dữ liệu
- **Actor:** Admin
- **Luồng chính:** Đổi role thành viên; giới hạn space cho Guest.
- **Bất biến:** Member org A query → **tuyệt đối không** thấy dữ liệu org B (tenant isolation).

---

## 🟩 NHÓM B — TRI THỨC & CỘNG TÁC (Knowledge)

### UC-B1: Đăng tài liệu / câu hỏi
- **Actor:** Member
- **Luồng chính:** Soạn item (`DOCUMENT`/`QUESTION`/`RUNBOOK`/`ADR`) → chọn Space + tags → Publish.
- **Hệ quả hệ thống:** ghi DB + `DocumentPublishedEvent` vào Outbox (cùng transaction) → Kafka → `search-service` index ES + `worker-service` sinh embedding.
- **Pattern:** Outbox, Event-driven re-index/re-embed.

### UC-B2: Đồng biên tập (Wiki) với OCC
- **Actor:** 2 Members
- **Luồng chính:** A & B cùng mở doc `version=5`. A lưu trước → `version=6`. B lưu sau với `version=5` → **bị từ chối** (conflict) → B xem diff, merge, lưu lại.
- **Pattern:** Optimistic Concurrency Control, Revision history.

### UC-B3: Trả lời & Accept
- **Actor:** Member (asker), Member (answerer)
- **Luồng chính:** Answerer trả lời `QUESTION` → asker chọn **Accept** câu trả lời tốt nhất → answerer +reputation (+credit nếu có bounty).
- **Pattern:** Engagement event, (Bounty) Saga.

### UC-B4: Kiểm chứng (Verify)
- **Actor:** Expert/Moderator (đủ reputation)
- **Luồng chính:** Đánh dấu answer/doc là `VERIFIED` → nội dung được ưu tiên trong search & hiển thị huy hiệu tin cậy.

---

## 🟪 NHÓM C — KHÁM PHÁ BẰNG AI (Discovery / RAG)

### UC-C1: Semantic Search
- **Actor:** Member
- **Luồng chính:** Gõ truy vấn ngôn ngữ tự nhiên → hệ thống chạy **Hybrid Retrieval** (ES BM25 + pgvector) → RRF hợp nhất → trả danh sách kết quả kèm điểm liên quan & highlight.
- **Pattern:** Hybrid Retrieval, Vector Search.

### UC-C2: Hỏi AI (RAG) — tốn credit
- **Actor:** Member, AI Assistant
- **Tiền điều kiện:** Org còn đủ credit; user trong rate-limit.
- **Luồng chính:**
  1. Member hỏi → gửi kèm `X-Idempotency-Key`.
  2. **Saga**: reserve credit → retrieve top-N đoạn → gọi Claude (RAG) → trả lời **kèm citation** → commit credit spend (`CreditSpentEvent`).
- **Luồng lỗi:** Claude timeout/down → **Circuit Breaker OPEN** → refund credit (`CreditRefundedEvent`) → trả về kết quả search keyword + thông báo "AI tạm không khả dụng".
- **Lỗi double-submit:** cùng Idempotency-Key gửi 2 lần → trả kết quả cached, **không trừ credit lần 2**.
- **Pattern:** Saga, Circuit Breaker, Idempotency, Rate Limiting.

### UC-C3: AI Chat Assistant (hội thoại)
- **Actor:** Member, AI Assistant
- **Luồng chính:** Mở phiên chat (`chat-service`) → hỏi nhiều lượt có ngữ cảnh → mỗi câu trả lời vẫn kèm citation.
- **Pattern:** Realtime (WebSocket), RAG with session context.

---

## 🟧 NHÓM D — CREDIT & BOUNTY (Economy)

### UC-D1: Nạp credit
- **Actor:** Owner
- **Luồng chính:** Mua credit pack → `CreditPurchasedEvent` → balance tăng.
- **Pattern:** Event Sourcing (ledger).

### UC-D2: Treo bounty cho câu hỏi khó
- **Actor:** Member (asker)
- **Luồng chính:** Stake X credit vào `QUESTION` (`CreditStakedEvent`, credit bị khóa) → ai trả lời được accept nhận X credit.
- **Saga:** stake → accept → award answerer + reputation + badge → notify. Hủy bounty / hết hạn → refund asker.
- **Pattern:** Saga + Compensation.

### UC-D3: Xem sổ cái & đối soát
- **Actor:** Owner/Admin
- **Luồng chính:** Xem lịch sử credit (từ Read Model) → đối chiếu `Sum(events)` vs balance.
- **Bất biến:** Ledger Integrity cron đêm phát hiện drift → alert.

---

## 🟨 NHÓM E — UY TÍN, REALTIME & WORKER

### UC-E1: Nhận thông báo realtime
- **Actor:** Member, Notification Service
- **Luồng chính:** Câu hỏi của tôi được trả lời / doc tôi follow được cập nhật / tôi bị @mention → nhận event qua WebSocket < 500ms.
- **Pattern:** WebSocket + Redis Pub/Sub, Kafka consumer.

### UC-E2: Digest định kỳ
- **Actor:** Worker, Notification Service
- **Luồng chính:** Cron tổng hợp "Mới trong Space của bạn" → gửi push/email.
- **Pattern:** CQRS Read Model, scheduled worker.

### UC-E3: Phát hiện tài liệu lỗi thời (Stale)
- **Actor:** Worker
- **Luồng chính:** Quét document lâu không cập nhật / có thay đổi liên quan → đánh dấu `STALE` → nhắc tác giả review.

### UC-E4: Re-index / Re-embed sau khi sửa nội dung
- **Actor:** Worker, Search Service
- **Luồng chính:** Nhận `DocumentUpdatedEvent` → re-index ES + re-embed pgvector (idempotent theo content hash).
- **Lỗi:** Worker fail → message vào **DLQ** → có endpoint replay.
- **Pattern:** DLQ + Retry.

---

## 🔁 MA TRẬN USE CASE ↔ PATTERN ↔ HẠ TẦNG

| Use Case | Pattern chính | Hạ tầng |
|---------|---------------|---------|
| UC-B1 publish | Outbox | Postgres + Kafka |
| UC-B2 wiki edit | OCC | Postgres |
| UC-C1 search | Hybrid Retrieval | Elasticsearch + pgvector |
| UC-C2 ask AI | Saga + Circuit Breaker + Idempotency | Redis + Kafka + Claude |
| UC-C3 AI chat | Realtime RAG | chat-service + Redis |
| UC-D1/D2 credit | Event Sourcing + Saga | Postgres Event Store |
| UC-E1 notify | Pub/Sub | notification-service + Redis |
| UC-E4 re-index | DLQ + Retry | Kafka + Elasticsearch + pgvector |
| UC-A3 isolation | Tenant Isolation | (cross-cutting) |
