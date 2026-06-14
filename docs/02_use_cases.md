# 📋 KỊCH BẢN SỬ DỤNG (SYSTEM USE CASES)

> 📖 **[English Version](./en/02_use_cases.md)**

Tài liệu đặc tả các luồng tương tác giữa User và System. Dựa vào đây để Developer/QA nắm bắt luồng nghiệp vụ thực tế và viết test cases.

---

## 1. TRỤ CỘT 1 — QUẢN LÝ NHÓM & CHI PHÍ

### UC1.1: Tạo Nhóm Tài chính

- **Pre-condition:** User A đã đăng nhập.
- **Action:** User A tạo nhóm mới với tên "Du lịch Đà Lạt", loại `TRIP`, Base Currency `VND`, ngày bắt đầu/kết thúc.
- **Expected Result:**
  - Nhóm được tạo, User A trở thành `OWNER`.
  - Hệ thống sinh Invite Link và QR Code.
  - Event: `GroupCreatedEvent` ghi vào Event Store.
  - Balance table khởi tạo: tất cả balance = 0.

### UC1.2: Mời Thành viên vào Nhóm

- **Pre-condition:** User A là Owner/Admin của nhóm "Du lịch Đà Lạt".
- **Action:** User A gửi Invite Link cho User B, C, D qua chat.
- **Expected Result:**
  - B, C, D bấm link → Hiển thị trang xác nhận → Chấp nhận → Trở thành `MEMBER`.
  - Event: `MemberJoinedEvent` cho mỗi người.
  - Balance table cập nhật: thêm cặp balance mới (A↔B, A↔C, A↔D, B↔C, B↔D, C↔D).

### UC1.3: Tạo Chi phí — Chia đều (EQUAL Split)

- **Pre-condition:** Nhóm 4 người (A, B, C, D). User A trả tiền ăn trưa 800,000₫.
- **Action:** User A tạo expense: Payer = A, Amount = 800,000₫, Split = EQUAL, Category = FOOD.
- **Expected Result:**
  - Mỗi người nợ A: 800,000 / 4 = 200,000₫. Trừ phần A tự trả → B, C, D mỗi người nợ A 200,000₫.
  - Events ghi vào Event Store:
    ```
    ExpenseCreatedEvent {
      expenseId, groupId, payerId: A,
      amount: 800000, currency: VND,
      splitMethod: EQUAL,
      splits: [
        {userId: A, amount: 200000, owes: 0},      // A tự trả cho mình
        {userId: B, amount: 200000, owes: 200000},
        {userId: C, amount: 200000, owes: 200000},
        {userId: D, amount: 200000, owes: 200000}
      ]
    }
    ```
  - Outbox Event published → Kafka → Notification Service → Push cho B, C, D.
  - Read Model (Balance) cập nhật: B→A: -200k, C→A: -200k, D→A: -200k.

### UC1.4: Tạo Chi phí — Chia tùy chỉnh (EXACT Split)

- **Pre-condition:** Nhóm 3 người (A, B, C). User A trả tiền 500,000₫ nhưng A ăn nhiều hơn.
- **Action:** User A tạo expense: Amount = 500,000₫, Split = EXACT, A: 250k, B: 150k, C: 100k.
- **Expected Result:**
  - Validation: Sum(250 + 150 + 100) = 500k ✅ (phải bằng total amount).
  - B nợ A: 150,000₫. C nợ A: 100,000₫. A đã tự trả 250k.
  - Event ghi nhận splits chính xác.

### UC1.5: Tạo Chi phí — Chia theo tỷ lệ (PERCENTAGE Split)

- **Pre-condition:** Nhóm 3 người. User B trả tiền 1,000,000₫. A hưởng 50%, B 30%, C 20%.
- **Action:** User B tạo expense: Amount = 1,000,000₫, Split = PERCENTAGE.
- **Expected Result:**
  - Validation: Sum(50 + 30 + 20) = 100% ✅.
  - A nợ B: 500,000₫. C nợ B: 200,000₫. B tự trả 300,000₫.

### UC1.6: Tạo Chi phí — Chia theo phần (SHARES Split)

- **Pre-condition:** Nhóm 3 người. User C trả 600,000₫. A: 2 phần, B: 1 phần, C: 1 phần.
- **Action:** User C tạo expense: Amount = 600,000₫, Split = SHARES.
- **Expected Result:**
  - Tổng phần: 2+1+1 = 4. Mỗi phần = 150,000₫.
  - A nợ C: 300,000₫ (2 phần). B nợ C: 150,000₫ (1 phần). C tự trả 150,000₫.

### UC1.7: Tạo Chi phí — Loại trừ Thành viên

- **Pre-condition:** Nhóm 4 người. User A trả bia 400,000₫ nhưng C không uống.
- **Action:** User A tạo expense, loại trừ C khỏi split.
- **Expected Result:**
  - Chỉ chia cho A, B, D: 400,000 / 3 = 133,333₫ mỗi người.
  - B nợ A: 133,333₫. D nợ A: 133,333₫. C không bị ảnh hưởng.

### UC1.8: Tạo Chi phí — Nhiều Người trả (Multi-payer)

- **Pre-condition:** Nhóm 4 người. Bữa ăn 1,000,000₫. A trả 600k, B trả 400k.
- **Action:** Tạo expense: Payers = [A: 600k, B: 400k], Split = EQUAL.
- **Expected Result:**
  - Mỗi người nên trả: 1,000,000 / 4 = 250,000₫.
  - A đã trả 600k, nên A được nợ lại: 600k - 250k = 350k.
  - B đã trả 400k, nên B được nợ lại: 400k - 250k = 150k.
  - C nợ: 250k (phân bổ cho A và B theo tỷ lệ).
  - D nợ: 250k (tương tự).

### UC1.9: Sửa Chi phí (Edit Expense — OCC)

- **Pre-condition:** Expense "Ăn trưa" 500k, version = 1.
- **Action:** User A sửa amount từ 500k → 600k.
- **Expected Result:**
  - Hệ thống kiểm tra version. Nếu version = 1 → Update thành công, version = 2.
  - Event: `ExpenseUpdatedEvent { changes: {amount: {from: 500000, to: 600000}}, version: 2 }`.
  - Balance Read Model cập nhật (delta: +100k chia cho participants).
  - Row cũ KHÔNG bị modify — Event mới append vào Event Store.

### UC1.10: Sửa Chi phí — Xung đột OCC (Concurrent Edit)

- **Pre-condition:** Expense "Ăn trưa" version = 1. User A và User B đều mở form Edit.
- **Action:**
  1. User A sửa amount 500k → 600k (gửi version: 1).
  2. User B sửa note "thêm đồ uống" (gửi version: 1 — cùng lúc).
- **Expected Result:**
  - User A gửi trước → Thành công. Version = 2.
  - User B gửi sau → **HTTP 409 Conflict** (version mismatch: expected 1, got 2).
  - User B nhận state mới nhất (version 2) → Hiển thị diff → Cho phép retry.

### UC1.11: Xóa Chi phí (Soft Delete)

- **Pre-condition:** Expense "Ăn trưa" tồn tại.
- **Action:** User A (creator hoặc Admin) xóa expense.
- **Expected Result:**
  - Row KHÔNG bị xóa. Event: `ExpenseDeletedEvent { expenseId, deletedBy: A }`.
  - Balance Read Model cập nhật (trừ lại tất cả splits).
  - Expense hiện badge "Đã xóa" trong Activity Log.

---

## 2. TRỤ CỘT 2 — THANH TOÁN & TỐI ƯU NỢ

### UC2.1: Settle Nợ (Full Settlement)

- **Pre-condition:** B nợ A 200,000₫ trong nhóm "Du lịch Đà Lạt".
- **Action:** User B bấm "Settle Up" → Chọn A → Nhập 200,000₫ → Gửi kèm `X-Idempotency-Key`.
- **Expected Result:**
  - Saga Pattern:
    1. Validate: B thực sự nợ A ≥ 200k ✅.
    2. Create `SettlementCreatedEvent`.
    3. Update Balance: B→A giảm 200k → Balance = 0.
    4. Outbox → Kafka → Notification cho A: "B vừa trả bạn 200k!"
  - WebSocket: A nhận real-time update.
  - Idempotency: Nếu B gửi lại cùng key → trả kết quả cached.

### UC2.2: Settle Nợ — Saga Rollback

- **Pre-condition:** Cùng UC2.1, nhưng Step 3 (Update Balance) bị lỗi DB timeout.
- **Expected Result:**
  - Saga Compensating Transaction:
    1. Create `SettlementFailedEvent` (ghi nhận failure).
    2. Balance KHÔNG bị thay đổi.
    3. Notification cho B: "Thanh toán thất bại, vui lòng thử lại."
  - Idempotency Key vẫn hợp lệ — B có thể retry với key mới.

### UC2.3: Settle Nợ — Double-Click Protection (Idempotency)

- **Pre-condition:** B bấm "Pay" nhưng mạng lag.
- **Action:** B bấm "Pay" thêm 1 lần nữa (cùng `X-Idempotency-Key`).
- **Expected Result:**
  - Request thứ 2 → Server check Idempotency Table → Key đã tồn tại.
  - Trả về response cached từ request đầu tiên.
  - **Tiền KHÔNG bị trừ 2 lần.**

### UC2.4: Settle Nợ — Partial Settlement

- **Pre-condition:** B nợ A 500,000₫. B chỉ có 200,000₫.
- **Action:** B settle 200,000₫ (partial).
- **Expected Result:**
  - Balance cập nhật: B→A giảm từ 500k → 300k.
  - Event: `SettlementCreatedEvent { type: PARTIAL, amount: 200000 }`.
  - B vẫn nợ A 300k.

### UC2.5: Settle Nợ — Record Only (Ghi nhận Tiền mặt)

- **Pre-condition:** C nợ A 100,000₫. C trả A bằng tiền mặt ngoài app.
- **Action:** A hoặc C tạo settlement `RECORD_ONLY`.
- **Expected Result:**
  - Balance cập nhật: C→A = 0.
  - Event ghi nhận, nhưng không có giao dịch tài chính thực sự qua app.

### UC2.6: Debt Simplification — Gợi ý Tối ưu

- **Pre-condition:** Nhóm 5 người, 15 expenses, ma trận nợ phức tạp.
- **Action:** User A bấm "Gợi ý Settle" (Suggest Optimal Settlement).
- **Expected Result:**
  - Worker Service tính Net Balance:
    ```
    A: +350k (được nợ ròng)
    B: -200k (nợ ròng)
    C: +100k (được nợ ròng)
    D: -150k (nợ ròng)
    E: -100k (nợ ròng)
    ```
  - Greedy Matching Output:
    ```
    1. B → A: 200k
    2. D → A: 150k
    3. E → C: 100k
    ```
  - Chỉ 3 giao dịch thay vì tối đa C(5,2) = 10 cặp!
  - Hiển thị dưới dạng suggestion cards — User xác nhận từng khoản.

---

## 3. TRỤ CỘT 3 — ĐA TIỀN TỆ

### UC3.1: Expense Đa tiền tệ

- **Pre-condition:** Nhóm "Du lịch Nhật" có Base Currency = VND. User A trả tiền ăn 5,000¥ (JPY).
- **Action:** User A tạo expense: Amount = 5,000, Currency = JPY. Split = EQUAL (4 người).
- **Expected Result:**
  1. `exchange-rate-service` lấy tỷ giá: 1 JPY = 175₫ (cache hoặc API call).
  2. Pinned exchange rate: `exchangeRate = 175`.
  3. Converted amount: 5,000 × 175 = 875,000₫.
  4. Mỗi người nợ A: 875,000 / 4 = 218,750₫.
  5. UI hiển thị: `¥5,000 (≈ 875,000₫)`.
  6. Balance tính bằng VND (Base Currency).

### UC3.2: Exchange Rate API Down — Circuit Breaker

- **Pre-condition:** Exchange Rate API (Fixer.io) bị down. Đã fail 5 lần liên tiếp.
- **Action:** User A tạo expense JPY.
- **Expected Result:**
  1. Circuit Breaker State: `CLOSED → OPEN` (sau 5 failures).
  2. Service trả về tỷ giá cached gần nhất (VD: 1 JPY = 173₫ từ 2 giờ trước).
  3. UI hiển thị cảnh báo: "⚠️ Tỷ giá có thể không chính xác (cached)".
  4. Sau 30 giây → HALF-OPEN → Thử 1 request.
  5. **Hệ thống KHÔNG bị down** — expense vẫn tạo được.

### UC3.3: Settlement Đa tiền tệ

- **Pre-condition:** B nợ A 218,750₫ (gốc từ expense JPY). B muốn settle bằng USD.
- **Action:** B settle: Amount = 9 USD (≈ 218,700₫ theo tỷ giá hiện tại).
- **Expected Result:**
  - Hệ thống convert 9 USD → VND theo tỷ giá tại thời điểm settle.
  - Balance cập nhật bằng VND.
  - Chênh lệch nhỏ (50₫) do biến động tỷ giá → Cho phép settle nếu chênh lệch < 1%.

---

## 4. TRỤ CỘT 4 — PHÂN TÍCH & THÔNG BÁO

### UC4.1: Dashboard Analytics

- **Pre-condition:** Nhóm "Ở chung" hoạt động 3 tháng, 50+ expenses.
- **Action:** User A mở Dashboard.
- **Expected Result (Read Model, < 200ms):**
  - **Total Group Spending:** 15,000,000₫.
  - **My Balance:** A được nợ 2,500,000₫.
  - **Who Owes Whom:** Ma trận nợ dạng: B→A: 800k, C→A: 700k, D→A: 1,000k.
  - **By Category:** Food 60%, Transport 20%, Utilities 15%, Other 5%.
  - **Monthly Trend:** Line chart 3 tháng.
  - **Top Spender:** A (8,000,000₫ tổng chi trả trước).

### UC4.2: Export Báo cáo

- **Pre-condition:** Nhóm "Du lịch Đà Lạt" đã kết thúc và settled.
- **Action:** User A bấm "Export PDF".
- **Expected Result:**
  - Worker Service generate PDF:
    - Danh sách tất cả expenses (date, description, payer, amount, splits).
    - Danh sách tất cả settlements.
    - Tóm tắt: Ai đã chi bao nhiêu, ai đã nhận bao nhiêu.
  - File PDF gửi qua email hoặc download trực tiếp.

### UC4.3: Real-time Notification (WebSocket)

- **Pre-condition:** User B đang online (WebSocket connected). User A tạo expense mới.
- **Action:** A tạo expense "Cà phê" 200k, EQUAL split.
- **Expected Result:**
  - Kafka event → Notification Service → WebSocket push đến B.
  - B nhận toast notification: "A vừa thêm 'Cà phê' — 200k. Bạn nợ 50k."
  - **Latency < 500ms** từ lúc A bấm Create đến lúc B nhận notification.

### UC4.4: Push Notification (Offline)

- **Pre-condition:** User C offline. User A tạo expense mới.
- **Expected Result:**
  - WebSocket không gửi được → Fallback Push Notification.
  - C nhận push notification trên thiết bị.

### UC4.5: Budget Alert

- **Pre-condition:** Nhóm "Ở chung" có budget 10,000,000₫/tháng. Đã chi 9,200,000₫ (92%).
- **Action:** User D tạo expense mới 500,000₫.
- **Expected Result:**
  - Total = 9,700,000₫ (97% budget).
  - Alert trigger: Push notification cho tất cả members: "⚠️ Nhóm đã chi 97% ngân sách tháng!"

### UC4.6: Nhắc Nợ (Reminder)

- **Pre-condition:** User B nợ A 500,000₫ đã 7 ngày.
- **Action:** A bấm "Nhắc nợ" (Remind) cho B.
- **Expected Result:**
  - Push notification cho B: "A nhắc bạn trả 500,000₫ trong nhóm 'Ở chung'."
  - Rate limit: Tối đa 1 reminder / 24h cho cùng 1 cặp nợ.

---

## 5. XỬ LÝ NỀN (Background & Scheduled Jobs)

### UC5.1: Rebuild Balance (Event Replay)

- **Pre-condition:** Nghi ngờ Balance không chính xác (drift).
- **Action:** Admin trigger rebuild balance cho 1 nhóm.
- **Expected Result:**
  - Worker Service replay toàn bộ events trong Event Store cho nhóm đó.
  - Tính lại tất cả pairwise balances từ đầu.
  - So sánh với Balance hiện tại → Nếu drift → Cập nhật + Alert.
  - **Đây là power của Event Sourcing** — có thể rebuild state bất cứ lúc nào.

### UC5.2: Ledger Integrity Check (Nightly Cron)

- **Action:** Mỗi đêm 02:00, Worker chạy Integrity Check.
- **Expected Result:**
  - Cho mỗi nhóm: `Sum(ExpenseCreatedEvent amounts) - Sum(ExpenseDeletedEvent amounts) - Sum(SettlementEvent amounts) == Current Unsettled Balance`.
  - Nếu sai lệch → Alert + auto-rebuild balance.
  - Đảm bảo sổ cái luôn chính xác 100%.

### UC5.3: Auto-Archive Trip Group

- **Pre-condition:** Nhóm "Du lịch Đà Lạt" (type = TRIP), endDate đã qua, tất cả balance = 0.
- **Action:** Worker Service kiểm tra hàng ngày.
- **Expected Result:**
  - Nhóm chuyển status → `ARCHIVED`.
  - Members nhận notification: "Nhóm 'Du lịch Đà Lạt' đã được lưu trữ."
  - Dữ liệu vẫn read-only, không bị xóa.

### UC5.4: DLQ Handling

- **Pre-condition:** Worker nhận Kafka message nhưng xử lý lỗi (schema mismatch).
- **Expected Result:**
  - Message chuyển vào DLQ topic (`*-dlq`).
  - Alert cho developer.
  - Developer fix issue → Replay DLQ → Message xử lý thành công.
  - **Không có data loss.**
