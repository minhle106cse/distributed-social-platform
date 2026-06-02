# 🧪 Chiến lược Testing cho Event-Driven Architecture

Kiến trúc GrowthGarden V2 sử dụng Kafka, Outbox và Saga Pattern, do đó chiến lược testing tập trung vào tính toàn vẹn của Dữ liệu phân tán (Eventual Consistency).

---

## 1. Unit Testing
- Test các Logic thuần túy trong Core Module (Không đụng đến DB).
- **Ví dụ:** Hàm tính kinh nghiệm (EXP) khi tưới cây và cập nhật `activeCheckinDays`. Logic Hibernation Cooldown (sau khi rã đông, bỏ điểm danh 3 ngày tiếp theo thì Cây chết ngay).

## 2. Integration Testing (Outbox Pattern)
- Không mock DB, sử dụng **Testcontainers** (Docker bằng code) để chạy một PostgreSQL cục bộ khi chạy test.
- **Kịch bản:** Khi gọi API `POST /productivity/checkin`, phải Assert được 3 việc:
  1. `PlantGuardian.currentStreak` và `activeCheckinDays` tăng đúng 1.
  2. `Wallet.karmaBalance` tăng đúng lượng phần thưởng.
  3. Bảng `OutboxEvent` **BẮT BUỘC** có chứa sự kiện `CheckinCompleted` chung một transaction.

## 3. End-to-End (E2E) & Kafka Message Testing
- **DLQ (Dead Letter Queue) Testing:** Bơm một message lỗi (sai schema) vào Kafka topic. Đảm bảo Consumer bắt được lỗi và ném message đó sang topic `DLQ` (hoặc đánh dấu `FAILED_DLQ` trong Outbox) chứ không làm chết service.
- **Saga Pattern (Rollback) Testing:**
  1. Setup một lỗi giả lập ở DB `InventoryItem` (Cố tình làm cho việc sinh đồ Gacha bị lỗi).
  2. Gọi API Roll Gacha.
  3. Đảm bảo API trả về 500, nhưng số Karma trong `Wallet` phải được hoàn trả về nguyên vẹn như ban đầu.

## 4. Load Testing (K6)
- **Race Condition Testing:** 
  - Mô phỏng 10 request đồng thời gọi `POST /productivity/checkin` cho cùng 1 `PlantGuardian`.
  - Phải đảm bảo OCC (trường `version`) hoạt động, chỉ 1 request thành công, 9 request còn lại bị từ chối (HTTP 409 Conflict), để cây không bị cộng dồn EXP và Karma 10 lần một cách bất hợp pháp.
  - **Pity System Testing:** Mô phỏng mở 100 Rương Gacha không ra Key. Đảm bảo `keyFragments` trong InventoryItem tăng đúng 100 lần.

## 5. Offline Sync & UI Testing
- **Offline Queue Testing (Cypress/Playwright):**
  1. Giả lập ngắt kết nối mạng trên trình duyệt (Network Offline mode).
  2. Thực hiện click nút "Điểm danh Cảm xúc" trên UI. Giao diện vẫn phản hồi thành công (Optimistic UI, Cây lấp lánh ngay).
  3. Bật lại kết nối mạng.
  4. Đảm bảo API `/sync/offline-queue` được tự động gọi và dữ liệu đồng bộ thành công xuống DB.

## 6. Ledger Integrity Testing (Kiểm toán Hệ thống)
- **Audit Job Testing:** Viết kịch bản kiểm tra toàn vẹn định kỳ.
- `Wallet.karmaBalance` của một User phải luôn bằng tổng của tất cả các transaction Karma liên quan đến User đó trong `OutboxEvent`. Nếu có sai lệch (Drift), hệ thống phải đánh rớt test và bắn Alert cảnh báo lạm phát/hack.
- **Neighborhood Contribution Test:** Sau khi Monument kích hoạt và phân phối Rương Co-op, chỉ các member có `currentCycleContribution > 0` nhận được item. Phải assert 0 item được cấp cho member có contribution = 0.
