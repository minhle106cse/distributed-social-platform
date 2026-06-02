# 🧪 Chiến lược Testing cho Event-Driven Architecture

Kiến trúc GrowthGarden V2 sử dụng Kafka, Outbox và Saga Pattern, do đó chiến lược testing tập trung vào tính toàn vẹn của Dữ liệu phân tán (Eventual Consistency).

---

## 1. Unit Testing
- Test các Logic thuần túy trong Core Module (Không đụng đến DB).
- **Ví dụ:** Hàm tính kinh nghiệm (EXP) khi tưới cây. Nếu đang Grace Period (Sleepy Mode) thì trả về đúng trạng thái cây.

## 2. Integration Testing (Outbox Pattern)
- Không mock DB, sử dụng **Testcontainers** (Docker bằng code) để chạy một PostgreSQL cục bộ khi chạy test.
- **Kịch bản:** Khi gọi API `POST /habits/{id}/check-in`, phải Assert được 2 việc:
  1. Record trong bảng `Habit` đã tăng EXP.
  2. Bảng `EventOutbox` **BẮT BUỘC** có chứa sự kiện `HABIT_COMPLETED` chung một transaction.

## 3. End-to-End (E2E) & Kafka Message Testing
- **DLQ (Dead Letter Queue) Testing:** Bơm một message lỗi (sai schema) vào Kafka topic. Đảm bảo Consumer bắt được lỗi và ném message đó sang topic `DLQ` (hoặc đánh dấu `FAILED_DLQ` trong Outbox) chứ không làm chết service.
- **Saga Pattern (Rollback) Testing:**
  1. Setup một lỗi giả lập ở DB `InventoryItem` (Cố tình làm cho việc sinh đồ Gacha bị lỗi).
  2. Gọi API Roll Gacha.
  3. Đảm bảo API trả về 500, nhưng số Karma trong `KarmaWallet` phải được hoàn trả về nguyên vẹn như ban đầu.

## 4. Load Testing (K6)
- **Race Condition Testing:** 
  - Mô phỏng 10 request đồng thời gọi API Check-in cho cùng 1 ID Thói quen.
  - Phải đảm bảo Optimistic Locking hoạt động, chỉ 1 request thành công, 9 request còn lại bị từ chối (HTTP 409 Conflict), để cây không bị cộng dồn EXP 10 lần một cách bất hợp pháp.

## 5. Offline Sync & UI Testing
- **Offline Queue Testing (Cypress/Playwright):**
  1. Giả lập ngắt kết nối mạng trên trình duyệt (Network Offline mode).
  2. Thực hiện click nút "Check-in" thói quen trên UI. Giao diện vẫn phản hồi thành công (Optimistic UI).
  3. Bật lại kết nối mạng.
  4. Đảm bảo API `/sync/offline-queue` được tự động gọi và dữ liệu đồng bộ thành công xuống DB.

## 6. Ledger Integrity Testing (Kiểm toán Hệ thống)
- **Audit Job Testing:** Viết kịch bản kiểm tra toàn vẹn định kỳ.
- Tổng giá trị của tất cả các dòng `amount` trong bảng `KarmaLedger` của một User BẮT BUỘC phải bằng đúng giá trị `balanceKarma` hiện tại trong bảng `KarmaWallet`. Nếu có sai lệch (Drift), hệ thống phải đánh rớt test và bắn Alert cảnh báo lạm phát/hack.
