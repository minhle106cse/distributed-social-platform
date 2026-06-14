# 🧪 CHIẾN LƯỢC TESTING (TESTING & QA STRATEGY)

> 📖 **[English Version](./en/08_testing_and_qa_strategy.md)**

Kiến trúc TeamFin sử dụng Event Sourcing, CQRS, Saga Pattern, và Idempotency. Chiến lược testing tập trung vào **tính toàn vẹn dữ liệu tài chính (Ledger Integrity)** và **sức bền hệ thống phân tán (Distributed Resiliency)**.

---

## 1. Unit Testing

Test logic nghiệp vụ thuần túy (Pure Business Logic) — không đụng DB, không đụng Framework.

### Kịch bản
- **Split Calculation:**
  - EQUAL: 500,000₫ / 3 người = 166,667₫ + 166,667₫ + 166,666₫ (xử lý phần dư).
  - PERCENTAGE: Validate sum = 100%. Tính toán amount từ percentage.
  - SHARES: 600k, A:2, B:1, C:1 → A: 300k, B: 150k, C: 150k.
  - EXACT: Validate sum(splits) = totalAmount. Reject nếu không khớp.
- **Debt Simplification Algorithm:**
  - Input: 5 users, 10 pairwise debts → Output: ≤ 4 optimized transactions.
  - Edge case: Tất cả balance = 0 → Output empty.
  - Edge case: Chỉ 1 debtor, 1 creditor → Output 1 transaction.
- **Currency Conversion:**
  - 50 USD × 25,000 = 1,250,000₫ (VND, no decimals).
  - Rounding rules: VND rounds to nearest integer, USD rounds to 2 decimals.
- **Multi-payer Split:**
  - 1,000,000₫, A trả 600k, B trả 400k, EQUAL 4 người → A được nợ 350k, B được nợ 150k.

### Tool
- **Vitest** — Fast, TypeScript-native.
- **Target:** 100% coverage cho split logic, debt algorithm, currency conversion.

---

## 2. Integration Testing (Outbox + Event Sourcing)

Test full flow từ API → DB → Event Store → Outbox. Không mock DB.

### Setup
- **Testcontainers** — Docker PostgreSQL/Redis chạy per-test-suite.
- **Mỗi test** có fresh database (migration + seed).

### Kịch bản

#### 2.1. Tạo Expense → Verify atomicity
1. `POST /api/v1/groups/{id}/expenses` với valid payload.
2. Assert **trong cùng 1 transaction:**
   - `Expense` row tồn tại.
   - `ExpensePayer` + `ExpenseSplit` rows đúng.
   - `EventStore` có `ExpenseCreatedEvent` với version = 1.
   - `OutboxEvent` có record `status = PENDING`.
   - `BalanceSummary` cập nhật đúng pairwise balances.

#### 2.2. Event Sourcing Replay
1. Tạo 10 expenses + 3 settlements trong 1 nhóm.
2. Lưu current BalanceSummary.
3. Xóa toàn bộ BalanceSummary.
4. Chạy Rebuild (replay EventStore).
5. Assert: New BalanceSummary **byte-level identical** với step 2.

#### 2.3. Idempotency
1. `POST /expenses` với `X-Idempotency-Key: test-key-1`.
2. Lại `POST /expenses` với cùng `X-Idempotency-Key: test-key-1`.
3. Assert: Chỉ có 1 Expense row. Response thứ 2 identical response thứ 1.

#### 2.4. OCC (Optimistic Concurrency Control)
1. Tạo expense (version = 1).
2. `PUT /expenses/{id}` với `version: 1` → Success (version = 2).
3. `PUT /expenses/{id}` với `version: 1` → **HTTP 409 Conflict**.
4. Assert: Expense chỉ bị sửa 1 lần.

---

## 3. Saga Pattern Testing

Test Settlement flow — đặc biệt là **rollback khi failure**.

### Kịch bản

#### 3.1. Settlement Happy Path
1. Tạo expense: A trả, B nợ 200k.
2. B settle 200k cho A.
3. Assert: SettlementCreatedEvent trong EventStore. BalanceSummary B→A = 0.

#### 3.2. Settlement Rollback
1. Tạo expense: A trả, B nợ 200k.
2. **Giả lập lỗi** ở step Update BalanceSummary (inject DB failure).
3. B settle 200k cho A.
4. Assert:
   - API trả HTTP 500.
   - **BalanceSummary KHÔNG bị thay đổi** (rollback thành công).
   - `SettlementFailedEvent` trong EventStore.
   - Không có orphan Settlement row.

#### 3.3. Double-Settle Protection
1. B nợ A 200k.
2. B settle 200k (key: settle-1) → Success.
3. B settle 200k (key: settle-2) → **HTTP 400 INSUFFICIENT_BALANCE** (B không còn nợ A).
4. Assert: Chỉ 1 settlement record.

---

## 4. Circuit Breaker Testing

Test Exchange Rate Service với Circuit Breaker.

### Kịch bản

#### 4.1. Fallback to Cache
1. Mock External API luôn trả 500 error.
2. Gọi `GET /exchange-rates?from=USD&to=VND`.
3. After 5 failures: Circuit OPEN.
4. Assert: Response trả cached rate + `cached: true` flag.
5. Assert: Expense tạo với USD vẫn hoạt động (dùng cached rate).

#### 4.2. Circuit Recovery
1. Circuit OPEN (sau 5 failures).
2. Wait 30s → HALF-OPEN.
3. Mock External API trả success.
4. Assert: Circuit → CLOSED. Fresh rate returned.

---

## 5. Load Testing (K6)

### Kịch bản

#### 5.1. OCC Race Condition
- Mô phỏng **10 concurrent requests** sửa cùng 1 expense (cùng version).
- Assert: Chỉ 1 request thành công (HTTP 200). 9 request bị **HTTP 409**.
- Expense amount chỉ bị sửa 1 lần.

#### 5.2. Idempotency Under Load
- 50 concurrent requests tạo expense với **cùng Idempotency Key**.
- Assert: Chỉ 1 Expense record trong DB. Tất cả 50 response identical.

#### 5.3. Throughput
- 1000 virtual users tạo expenses liên tục (unique keys) trong 5 phút.
- Target: **P95 latency < 300ms, P99 < 500ms.**
- Assert: Không có 500 errors. Không có data corruption.

#### 5.4. Settlement Concurrency
- 100 concurrent settlements trong 1 nhóm.
- Assert: Tổng balance sau tất cả settlements = 0 (no drift). Idempotency hoạt động.

### Tool
- **K6** — Scriptable load testing.
- Run trong Docker container.

---

## 6. Ledger Integrity Testing (Kiểm toán)

### Nightly Cron Test
```
For each group:
  eventBalance = replay(all events in EventStore for this group)
  currentBalance = SELECT FROM BalanceSummary WHERE groupId = X
  
  ASSERT eventBalance == currentBalance
  IF drift detected:
    → Alert (Slack/Email)
    → Auto-rebuild BalanceSummary from EventStore
```

### Post-Settlement Audit
- Sau mỗi settlement: `Sum(all expense splits) - Sum(all settlements) == Current outstanding balance`.
- Nếu sai lệch → Alert + block further settlements cho group đó.

### Cross-Check
- `Sum(BalanceSummary.balance)` cho mỗi group PHẢI = 0 (tổng nợ = tổng được nợ).
- Nếu != 0 → Có bug trong split calculation.

---

## 7. E2E Testing (Playwright)

### Kịch bản UI

1. **Create Group Flow:** Login → Create Group → Verify group appears in list.
2. **Add Expense Flow:** Navigate to group → Add Expense → Fill form → Submit → Verify in expense list.
3. **Settle Flow:** Navigate to Settle → Select person → Enter amount → Submit → Verify balance updated.
4. **OCC Conflict UI:** Open expense edit in 2 tabs → Submit tab 1 → Submit tab 2 → Verify conflict dialog.
5. **Real-time Update:** Tab 1 adds expense → Tab 2 receives WebSocket update → Verify new expense appears.

### Tool
- **Playwright** — Cross-browser E2E testing.
