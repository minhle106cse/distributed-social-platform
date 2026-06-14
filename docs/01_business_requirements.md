# 💼 YÊU CẦU NGHIỆP VỤ (BUSINESS REQUIREMENTS)

> 📖 **[English Version](./en/01_business_requirements.md)**

Tài liệu này định nghĩa "Phần Hồn" của **TeamFin** — nền tảng quản lý tài chính nhóm. Hệ thống được xây dựng trên 4 Trụ Cột kinh doanh sắc bén, mỗi trụ cột đều sinh ra các bài toán System Design nâng cao một cách **tự nhiên**.

---

## 🏛️ TRỤ CỘT 1: QUẢN LÝ NHÓM & CHI PHÍ (Group & Expense Management)

### 1.1. Nhóm Tài chính (Finance Group)

Mỗi nhóm đại diện cho một **bối cảnh chia tiền** (ở chung nhà, du lịch, đi ăn, quỹ nhóm):

- **Tạo nhóm** với tên, mô tả, đơn vị tiền tệ mặc định (VND/USD/EUR).
- **Mời thành viên** qua Link/Mã QR (giống cách mời vào nhóm chat). Không tìm kiếm người lạ.
- **Giới hạn**: Mỗi nhóm tối đa **50 thành viên** (đảm bảo thuật toán Debt Simplification chạy trong O(n log n)).
- **Loại nhóm:**
  - `PERSISTENT` — Nhóm dài hạn (ở chung nhà, quỹ team). Không có ngày kết thúc.
  - `TRIP` — Nhóm sự kiện (du lịch, tiệc). Có `startDate` và `endDate`. Tự động lưu trữ (Archive) sau khi kết thúc và tất cả nợ được settle.
  - `QUICK_SPLIT` — Chia nhanh 1 lần (đi ăn). Tự động Archive sau 24h kể từ khi tất cả nợ = 0.

### 1.2. Chi phí (Expense)

Mỗi chi phí là một sự kiện tài chính được ghi nhận dưới dạng **Event bất biến (Immutable Event)** — giống sổ cái ngân hàng:

- **Người trả (Payer):** Ai đã bỏ tiền túi ra trước? Hỗ trợ **nhiều người trả** cho cùng 1 hóa đơn (A trả 300k, B trả 200k).
- **Loại tiền (Currency):** Mỗi expense có thể khác tiền tệ. Hệ thống tự động convert về tiền tệ mặc định của nhóm khi tính tổng.
- **Phương thức chia (Split Method):**

| Method | Mô tả | Ví dụ |
|--------|-------|-------|
| `EQUAL` | Chia đều cho mọi người | 500k / 5 người = 100k/người |
| `EXACT` | Số tiền chính xác cho từng người | A: 200k, B: 150k, C: 150k |
| `PERCENTAGE` | Theo tỷ lệ phần trăm | A: 50%, B: 30%, C: 20% |
| `SHARES` | Theo số phần (shares) | A: 2 phần, B: 1 phần, C: 1 phần |

- **Danh mục (Category):** `FOOD`, `TRANSPORT`, `ACCOMMODATION`, `ENTERTAINMENT`, `UTILITIES`, `SHOPPING`, `OTHER`.
- **Metadata:** Ghi chú (note), ảnh hóa đơn (receipt image URL), ngày xảy ra (expenseDate khác createdAt).
- **Loại trừ (Exclusion):** Cho phép loại trừ một số thành viên khỏi 1 expense cụ thể. Ví dụ: A trả tiền bia 300k nhưng C không uống → chỉ chia cho A và B.

### 1.3. Nguyên tắc Bất biến của Sổ cái (Ledger Immutability)

> **⚠️ RULE TUYỆT ĐỐI: Không bao giờ DELETE hoặc UPDATE trực tiếp một record tài chính.**

- Khi "sửa" expense: Hệ thống tạo `ExpenseUpdatedEvent` ghi nhận thay đổi (delta), chứ KHÔNG update row cũ.
- Khi "xóa" expense: Hệ thống tạo `ExpenseDeletedEvent` (soft delete). Row cũ vẫn tồn tại vĩnh viễn.
- **Balance hiện tại = Replay toàn bộ events từ đầu**. Có thể rebuild bất cứ lúc nào.
- **Audit Trail:** Mọi thay đổi đều có `userId` (ai sửa), `timestamp` (khi nào), `changes` (sửa gì). Đây là yêu cầu bắt buộc của fintech.

---

## 🏛️ TRỤ CỘT 2: THANH TOÁN & TỐI ƯU NỢ (Settlement & Debt Resolution)

### 2.1. Thanh toán Nợ (Settlement)

Khi A nợ B 200k và muốn trả:

- A bấm "Settle Up" → Chọn B → Nhập số tiền → Xác nhận.
- Hệ thống tạo `SettlementCreatedEvent` → Chạy **Saga Pattern:**
  - **Step 1:** Ghi nhận A đã trả (Debit Event).
  - **Step 2:** Ghi nhận B đã nhận (Credit Event).
  - **Step 3:** Update Read Model (Balance).
  - Nếu bất kỳ step nào fail → **Compensating Transaction** rollback toàn bộ.
- **Idempotency Key** bắt buộc: Chống double-settle khi mạng lag.
- **Settlement Types:**
  - `FULL` — Trả hết nợ cho 1 người.
  - `PARTIAL` — Trả một phần.
  - `RECORD_ONLY` — Chỉ ghi nhận (ví dụ: "B đã trả A bằng tiền mặt ngoài app").

### 2.2. Thuật toán Tối ưu Nợ (Debt Simplification)

Đây là **bài toán NP-Hard** biến thể — và là highlight kỹ thuật quan trọng nhất:

**Bài toán:** Nhóm 5 người, 20 giao dịch chồng chéo qua lại. Nếu settle từng cặp sẽ cần tối đa `n*(n-1)/2 = 10` giao dịch. Thuật toán tối ưu giảm xuống còn tối đa `n-1 = 4`.

**Thuật toán (Greedy Net Balance):**

```
Input:  A nợ B 100, B nợ C 50, C nợ A 30, A nợ C 20
Step 1: Tính Net Balance:
        A = -100 + 30 - 20 = -90  (nợ ròng 90)
        B = +100 - 50      = +50  (được nợ 50)
        C = +50 - 30 + 20  = +40  (được nợ 40)
Step 2: Greedy Matching (Sắp xếp debtor/creditor):
        Debtors:  [A: -90]
        Creditors: [B: +50, C: +40]
Step 3: Match:
        A → B: 50 (B hết nợ)
        A → C: 40 (C hết nợ)
Output: Chỉ cần 2 giao dịch thay vì 4!
```

- **Trigger:** Thuật toán chạy theo yêu cầu (khi user bấm "Suggest Settlement") hoặc chạy nền định kỳ bởi Worker Service.
- **Kết quả là GỢI Ý**, không tự động settle. User phải xác nhận từng khoản.

### 2.3. Trạng thái Nợ của Nhóm (Group Debt Status)

| Status | Mô tả |
|--------|-------|
| `ACTIVE` | Còn nợ chưa settle |
| `SETTLED` | Tất cả balance = 0 |
| `ARCHIVED` | Nhóm đã kết thúc (Trip/QuickSplit) |

Chỉ khi status = `SETTLED`, nhóm `TRIP` mới được phép Archive tự động.

---

## 🏛️ TRỤ CỘT 3: ĐA TIỀN TỆ & TỶ GIÁ (Multi-currency & Exchange)

### 3.1. Tỷ giá & Circuit Breaker

Mỗi nhóm có **đơn vị tiền tệ mặc định (Base Currency)**. Khi expense được tạo bằng tiền tệ khác:

1. **Exchange Rate Service** gọi API bên thứ 3 (ExchangeRate-API / Fixer.io) để lấy tỷ giá.
2. **Circuit Breaker Pattern** bảo vệ hệ thống:
   - **CLOSED** (bình thường): Gọi API như thường, cache kết quả 1 giờ.
   - **OPEN** (API chết): Sau 5 lỗi liên tiếp → Ngắt cầu dao → Trả về tỷ giá cache gần nhất. Không để 1 API bên thứ 3 chết kéo sập tính năng tạo expense.
   - **HALF-OPEN** (thử lại): Sau 30 giây → Thử 1 request. Thành công → CLOSED. Thất bại → OPEN lại.
3. **Tỷ giá được gắn cố định (Pinned)** vào expense tại thời điểm tạo. Không thay đổi dù tỷ giá biến động sau đó.

### 3.2. Tiền tệ được hỗ trợ (Phase 1)

| Currency | Code | Symbol |
|----------|------|--------|
| Việt Nam Đồng | `VND` | ₫ |
| US Dollar | `USD` | $ |
| Euro | `EUR` | € |
| Japanese Yen | `JPY` | ¥ |
| Thai Baht | `THB` | ฿ |

### 3.3. Quy tắc Convert

- **Display:** Mỗi expense hiển thị ở **cả tiền gốc và tiền quy đổi**. VD: `$50 (≈ 1,250,000₫)`.
- **Balance tính bằng Base Currency:** Tổng nợ luôn quy đổi về Base Currency của nhóm để tránh sai lệch.
- **Settlement có thể bằng bất kỳ tiền tệ nào:** A nợ B 100 USD nhưng settle bằng VND → Hệ thống convert theo tỷ giá tại thời điểm settle.

---

## 🏛️ TRỤ CỘT 4: PHÂN TÍCH & KIỂM TOÁN (Analytics & Audit Trail)

### 4.1. Dashboard Analytics (Read Model — CQRS)

Dashboard là **Read Model** — một bản chiếu (projection) được tính toán sẵn từ Event Store, phục vụ truy vấn nhanh mà không cần query Event Store mỗi lần:

| Metric | Mô tả | Cách tính |
|--------|-------|-----------|
| **Total Group Spending** | Tổng chi tiêu nhóm | Sum of all ExpenseCreatedEvent amounts |
| **My Balance** | Tôi nợ/được nợ bao nhiêu | Sum of my splits - Sum of my payments |
| **Who Owes Whom** | Ma trận nợ đầy đủ | Aggregate balance per (userA, userB) pair |
| **Spending by Category** | Chi tiêu theo danh mục | Group by category, sum amounts |
| **Monthly Trend** | Xu hướng chi tiêu theo tháng | Group by month, sum amounts |
| **Top Spender** | Ai chi nhiều nhất | Rank by total payment amount |

### 4.2. Audit Trail (Event Sourcing)

Mọi thay đổi tài chính đều được ghi nhận như event bất biến:

```
[2026-06-09 14:30] ExpenseCreated   — by UserA — "Ăn trưa" — 500,000₫ — Split: EQUAL (5 người)
[2026-06-09 14:35] ExpenseUpdated   — by UserA — Amount: 500,000 → 600,000₫ — Reason: "Quên tính thêm đồ uống"
[2026-06-09 15:00] SettlementCreated — UserB → UserA — 120,000₫
[2026-06-09 15:05] SettlementCreated — UserC → UserA — 120,000₫
```

- **Ai sửa, khi nào, sửa gì** — Hoàn toàn transparent.
- **Replay:** Xóa toàn bộ Read Model, replay events → Balance chính xác 100%.
- **Export:** PDF/CSV cho mục đích kế toán hoặc chia tay nhóm.

### 4.3. Thông báo Thông minh (Smart Notifications)

| Sự kiện | Kênh | Mô tả |
|---------|------|-------|
| Expense mới được tạo | WebSocket + Push | "UserA vừa thêm 'Ăn trưa' — 500k. Bạn nợ 100k." |
| Expense bị sửa | WebSocket + Push | "UserA sửa 'Ăn trưa': 500k → 600k" |
| Settlement hoàn tất | WebSocket + Push | "UserB vừa trả bạn 120k!" |
| Nhắc nợ (Reminder) | Push Only | "Bạn còn nợ UserA 250k trong nhóm 'Du lịch Đà Lạt'" |
| Nhóm Trip sắp kết thúc | Push Only | "Nhóm 'Du lịch Đà Lạt' kết thúc sau 2 ngày. Hãy settle nợ!" |
| Budget Alert | Push Only | "Nhóm 'Ở chung' đã chi 90% ngân sách tháng này." |

### 4.4. Ngân sách Nhóm (Group Budget) — Optional Feature

- **Đặt ngân sách tháng** cho nhóm `PERSISTENT` (VD: Quỹ nhà 10 triệu/tháng).
- **Alert khi chi quá:** Gửi notification khi chi tiêu đạt 80%, 90%, 100% ngân sách.
- **Báo cáo so sánh:** Tháng này vs tháng trước.

---

## 🔗 TÍCH HỢP CÁC PATTERN SYSTEM DESIGN

Bảng tóm tắt cách mỗi trụ cột kinh doanh sinh ra System Design Pattern:

| Trụ Cột | Yêu cầu Nghiệp vụ | Pattern BE | Tại sao bắt buộc? |
|---------|---|---|---|
| 1. Expense | Tạo expense + notify cùng lúc | **Outbox Pattern** | Ghi DB + publish event phải atomic |
| 1. Expense | 2 người sửa cùng expense | **OCC (Versioning)** | Chống ghi đè dữ liệu |
| 1. Expense | Sổ cái không bao giờ xóa | **Event Sourcing** | Audit trail bắt buộc cho fintech |
| 2. Settlement | Trừ A + Cộng B phải atomic | **Saga Pattern** | Distributed transaction |
| 2. Settlement | Bấm Pay 2 lần do lag | **Idempotency Key** | Chống double-charge |
| 2. Settlement | Tối ưu nợ nhóm | **Debt Simplification** | Thuật toán NP-Hard |
| 3. Currency | API tỷ giá bị down | **Circuit Breaker** | Fallback an toàn |
| 3. Currency | Cache tỷ giá hot key | **Cache + Stampede** | Tránh thundering herd |
| 4. Analytics | Dashboard query phức tạp | **CQRS Read Model** | Tách Read/Write optimize riêng |
| 4. Analytics | Gửi notification thất bại | **DLQ + Retry** | Đảm bảo delivery |
| All | Chống spam API tài chính | **Rate Limiting** | Token Bucket/Leaky Bucket |
| All | Scale settlement riêng | **Strangler Fig** | Zero-downtime migration |
