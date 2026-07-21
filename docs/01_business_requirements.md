# 💼 YÊU CẦU NGHIỆP VỤ (BUSINESS REQUIREMENTS)


Tài liệu này định nghĩa "Phần Hồn" của **Cortex** — nền tảng tri thức nội bộ có AI cho team/công ty. Hệ thống được xây dựng trên 5 Trụ Cột kinh doanh, mỗi trụ cột đều sinh ra các bài toán System Design nâng cao một cách **tự nhiên**.

> **Nguyên tắc nền tảng:** Business sinh ra hạ tầng, không phải ngược lại. Mỗi yêu cầu dưới đây ép buộc một mảnh hạ tầng (pgvector, Kafka, Elasticsearch, Redis, chat, notification) tồn tại có lý do — đồng thời vẫn là một sản phẩm **launch được** (B2B SaaS: nỗi đau thật, có người trả tiền).

---

## 🏛️ TRỤ CỘT 1: TRI THỨC & CỘNG TÁC (Knowledge & Collaboration)

### 1.1. Đơn vị Tri thức (Knowledge Item)

Mọi nội dung trong Cortex là một **Knowledge Item** thuộc một trong các loại:

| Loại | Mô tả | Ví dụ |
|------|-------|-------|
| `DOCUMENT` | Tài liệu dài, wiki page | "Quy trình release", "Kiến trúc hệ thống thanh toán" |
| `QUESTION` | Câu hỏi cần lời giải | "Làm sao rotate JWT secret khi deploy?" |
| `ANSWER` | Câu trả lời cho 1 question | (gắn với 1 question) |
| `RUNBOOK` | Quy trình xử lý sự cố | "Khi DB CPU > 90% thì làm gì" |
| `ADR` | Architecture Decision Record | "Vì sao chọn Kafka thay vì RabbitMQ" |

- **Tác giả & quyền:** mỗi item có `createdBy`, thuộc một **Space** (xem Trụ Cột 5) và một **Organization**.
- **Trạng thái:** `DRAFT` → `PUBLISHED` → `ARCHIVED`/`STALE`.
- **Metadata:** tags, ngày cập nhật, số lần xem, số vote, có được `VERIFIED` (kiểm chứng) hay không.

### 1.2. Cộng tác kiểu Wiki & OCC

Nhiều người có thể cùng biên tập một `DOCUMENT`/`RUNBOOK`:

> **⚠️ RULE: Chống ghi đè mù (lost update).**

- Mỗi item có trường `version`. Khi user A và B cùng mở 1 doc và cùng lưu, người lưu sau bị từ chối nếu `version` đã đổi → **Optimistic Concurrency Control (OCC)**.
- Mỗi lần lưu tạo một **revision** (lịch sử phiên bản) → xem diff, rollback được.
- Audit: ai sửa (`updatedBy`), khi nào (`updatedAt`), sửa gì (revision diff).

### 1.3. Kiểm chứng & Chất lượng (Verification)

- Expert/Moderator có thể đánh dấu một answer/doc là `VERIFIED` ("đã kiểm chứng, tin được").
- `STALE`: tài liệu lâu không cập nhật hoặc có thay đổi liên quan → hệ thống gợi ý review (xem Trụ Cột 4 — Worker).

---

## 🏛️ TRỤ CỘT 2: KHÁM PHÁ BẰNG AI (AI Discovery — RAG + Hybrid Search)

> Đây là **trái tim** của sản phẩm và là highlight kỹ thuật quan trọng nhất.

### 2.1. Vấn đề
Search bằng keyword thất bại khi người dùng **không nhớ đúng từ khóa**. "Cách xoay vòng khóa bí mật" sẽ không khớp document tên "JWT secret rotation". Cần tìm theo **ngữ nghĩa**.

### 2.2. Hybrid Retrieval
Cortex kết hợp 2 nguồn để cho kết quả tốt nhất:

| Nguồn | Cơ chế | Mạnh ở |
|------|--------|--------|
| **Elasticsearch** | BM25 full-text | Khớp keyword chính xác, filter/facet |
| **pgvector** | Cosine similarity trên embedding | Khớp ngữ nghĩa, đồng nghĩa, diễn đạt khác |

→ Hợp nhất bằng **Reciprocal Rank Fusion (RRF)** rồi re-rank.

### 2.3. RAG (Retrieval-Augmented Generation)
- Lấy top-N đoạn liên quan + câu hỏi → nạp vào **Claude** → câu trả lời tổng hợp.
- **Citation bắt buộc:** mỗi câu trả lời dẫn lại document nguồn (chống hallucination, người dùng kiểm chứng được).
- **Embedding** được sinh **bất đồng bộ** bởi `worker-service` (qua Kafka) mỗi khi document publish/đổi nội dung.

### 2.4. Khả năng chịu lỗi
- **Circuit Breaker** quanh AI provider: khi Claude/embedding API down → rơi về **keyword-only search** (vẫn dùng được, chỉ kém thông minh hơn).
- **Rate Limiting:** AI query tốn tiền thật → giới hạn token-bucket per user/org.

---

## 🏛️ TRỤ CỘT 3: NỀN KINH TẾ CREDIT (Credit Economy — Ảo, không payout)

Credit là **đơn vị đo lường & khuyến khích** trong org. Nạp/cấp vào org nhưng **không bao giờ rút ra tiền mặt** ⇒ đầy đủ rigor sổ cái nhưng nhẹ rủi ro pháp lý/payment.

### 3.1. Mô hình sở hữu (DECIDED: per-member)

> Credit giữ ở **mức member** — số dư riêng của từng user *trong* một org — **KHÔNG** phải một túi chung của org.

Dòng chảy 2 tầng:
1. **Org treasury** được nạp credit (xem 3.2 — provisioning).
2. **OWNER/ADMIN cấp / đặt hạn mức** credit cho từng member từ treasury → mỗi member có **số dư cá nhân trong org**.
3. Member **tiêu** (gọi AI), **kiếm thêm** (đóng góp tốt / thắng bounty), **stake** (treo bounty) — tất cả trên số dư cá nhân.

→ **Số dư member = (org cấp) + (tự kiếm) + (thắng bounty) − (tiêu AI) − (đang stake).**
→ **Vì sao per-member:** bounty cần "stake credit *của tôi*" (bất khả thi nếu chỉ có túi chung); quota chống lạm dụng tự nhiên theo từng member.

### 3.2. Provisioning — nạp credit vào Org

> ⚠️ **Giai đoạn thử nghiệm hiện tại: CHƯA tích hợp thanh toán.**
> **System admin** (người vận hành nền tảng) **cấp credit cho org thủ công qua Admin Dashboard** (kiểu cho dùng thử). Khi sản phẩm chứng minh hiệu quả → tích hợp payment; lúc đó org tự mua và credit treasury **tự tăng**. Cả 2 đều là event bất biến → đổi cơ chế nạp KHÔNG phá sổ cái.

| Giai đoạn | Cách nạp | Sự kiện |
|---|---|---|
| **Thử nghiệm (hiện tại)** | System admin grant từ Admin Dashboard | `CreditGrantedEvent` (kèm `grantedBySystemAdminId`) |
| **Sau (có payment)** | Org mua credit pack | `CreditPurchasedEvent` |

### 3.3. Nguồn & Tiêu Credit (mức member)

| Hướng | Hành động | Sự kiện (Event) |
|------|-----------|-----------------|
| **+ Cấp** | OWNER/ADMIN cấp credit/hạn mức cho member từ treasury | `CreditAllocatedEvent` |
| **+ Thưởng** | Đóng góp được `VERIFIED`/answer được accept | `CreditAwardedEvent` |
| **− Tiêu** | Gọi AI (RAG/summarize) | `CreditSpentEvent` |
| **− Khóa tạm** | Stake credit treo bounty cho câu hỏi khó | `CreditStakedEvent` |
| **+ Hoàn** | AI fail / bounty hủy | `CreditRefundedEvent` |

### 3.4. Sổ cái Bất biến (Ledger Immutability)

> **⚠️ RULE TUYỆT ĐỐI: Không bao giờ UPDATE trực tiếp số dư credit.**

- Mọi thay đổi là một **Event bất biến** trong Event Store (mỗi event scope theo `orgId` + `userId`).
- **Balance hiện tại = Replay toàn bộ credit events**. Rebuild được bất cứ lúc nào — cho từng **member balance** lẫn **org treasury**.
- **Ledger Integrity:** cron hằng đêm kiểm tra `Sum(events) == Current Balance` cho **mỗi (org, member)** và cho treasury của mỗi org; drift → alert + auto-rebuild.

### 3.5. Saga cho giao dịch nhiều bước

**AI-Query Saga:** Reserve credit → gọi RAG → commit (nếu OK) / refund (nếu fail).
**Bounty Saga:** stake → accept answer → award + reputation + badge → notify; fail bất kỳ bước nào → compensate.

**Idempotency Key** bắt buộc cho mọi command tốn credit → chống double-charge khi mạng lag.

---

## 🏛️ TRỤ CỘT 4: UY TÍN & GAMIFY ĐÓNG GÓP (Reputation & Gamification)

Bài toán B2B kinh điển: **không ai muốn document**. Cortex dùng gamify để đảo ngược điều đó.

### 4.1. Điểm uy tín (Reputation)
- Đóng góp được vote up / được accept / được `VERIFIED` → +reputation.
- Reputation mở khóa đặc quyền (edit wiki không cần duyệt, verify nội dung người khác...).

### 4.2. Badge
| Badge | Điều kiện |
|------|-----------|
| 🌱 First Contribution | Đăng item đầu tiên |
| 🔥 Knowledge Streak | Đóng góp N ngày liên tục |
| ✅ Trusted Expert | Có X nội dung được `VERIFIED` |
| 🧭 Pathfinder | Trả lời câu hỏi được accept nhiều |

### 4.3. Bảng xếp hạng & Digest
- Leaderboard theo org/space (đọc từ Read Model, cache Redis).
- Digest định kỳ (`worker-service` + `notification-service`): "Tuần này 5 doc mới trong Space của bạn".

> Reputation cũng được ghi nhận qua event (`ReputationGrantedEvent`) → audit & rebuild được, tương tự credit.

---

## 🏛️ TRỤ CỘT 5: ĐA TỔ CHỨC & PHÂN QUYỀN (Multi-tenancy & Access)

Cortex là **B2B SaaS** — nhiều tổ chức dùng chung hệ thống nhưng **dữ liệu phải cô lập tuyệt đối**.

### 5.1. Cấu trúc
```
Organization (tenant)
 └── Workspace / Space (nhóm nội dung theo team/chủ đề)
      └── Knowledge Items
```

### 5.2. Vai trò trong Org (RBAC)
| Role | Quyền |
|------|-------|
| `OWNER` | Toàn quyền, quản lý billing/credit |
| `ADMIN` | Quản lý thành viên, space, moderation |
| `MEMBER` | Đọc/viết nội dung, hỏi AI |
| `GUEST` | Chỉ đọc các space được mời |

### 5.3. Tenant Isolation (bắt buộc)
- **Mọi truy vấn** scope theo `orgId` — không có ngoại lệ.
- **AI Data Boundary:** dữ liệu org A **không bao giờ** lọt vào ngữ cảnh RAG của org B.
- **Quota per tenant:** seat limit, credit balance, AI rate-limit riêng → chống *noisy-neighbor*.

---

## 🔗 TÍCH HỢP CÁC PATTERN SYSTEM DESIGN

Bảng tóm tắt cách mỗi trụ cột kinh doanh sinh ra System Design Pattern:

| Trụ Cột | Yêu cầu Nghiệp vụ | Pattern BE | Tại sao bắt buộc? |
|---------|---|---|---|
| 1. Knowledge | Publish doc + re-index/re-embed cùng lúc | **Outbox Pattern** | Ghi DB + publish event phải atomic |
| 1. Knowledge | 2 người sửa cùng 1 doc | **OCC (Versioning)** | Chống lost update |
| 2. Discovery | Tìm theo ngữ nghĩa | **Vector Search (pgvector)** | Keyword search không đủ |
| 2. Discovery | Full-text + filter | **Elasticsearch + RRF** | Hybrid retrieval cho kết quả tốt nhất |
| 2. Discovery | AI provider down | **Circuit Breaker** | Fallback keyword search |
| 2. Discovery | Search hot key | **Cache + Stampede Prevention** | Tránh thundering herd |
| 3. Credit | Sổ cái không bao giờ sai | **Event Sourcing** | Audit + rebuild balance |
| 3. Credit | Gọi AI fail phải hoàn credit | **Saga Pattern** | Distributed transaction |
| 3. Credit | Bấm hỏi AI 2 lần do lag | **Idempotency Key** | Chống double-charge |
| 4. Reputation | Dashboard/leaderboard query | **CQRS Read Model** | Tách Read/Write optimize riêng |
| 4. Reputation | Digest/notify thất bại | **DLQ + Retry** | Đảm bảo delivery |
| 5. Multi-tenancy | AI query đắt, chống lạm dụng | **Rate Limiting (Token Bucket)** | Quota per tenant |
| 5. Multi-tenancy | Cô lập dữ liệu chéo org | **Tenant Isolation** | Bảo mật B2B bắt buộc |
| All | Thông báo realtime | **WebSocket + Redis Pub/Sub** | Trải nghiệm realtime |
| All | Scale discovery riêng | **Strangler Fig** | Zero-downtime migration |

---

## 💰 MÔ HÌNH DOANH THU (Practicality Check)

| Câu hỏi | Trả lời |
|--------|---------|
| **Giải nỗi đau gì?** | Tri thức org tản mát & khó tìm; người mới onboard chậm; bus factor cao |
| **Ai trả tiền?** | Công ty/team (B2B) — trả theo **seat** + **credit pack** cho AI usage. ⚠️ **Hiện thử nghiệm: chưa thu tiền** — system admin cấp credit thủ công qua Admin Dashboard (xem §3.2); tích hợp payment khi sản phẩm chứng minh hiệu quả. |
| **Vì sao không bị "clone bão hòa"?** | Khác StackOverflow công khai — đây là tri thức **nội bộ, riêng tư, có AI search**, cạnh tranh thực với Glean/Notion AI |
| **Credit có rủi ro pháp lý?** | Không — credit **ảo, không payout**, chỉ luân chuyển nội bộ org |
