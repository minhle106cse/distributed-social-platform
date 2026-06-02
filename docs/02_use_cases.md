# 📋 SYSTEM USE CASES (GrowthGarden V2)

Tài liệu này đặc tả các luồng tương tác giữa User và System theo định hướng "Cozy & Healing". Dựa vào đây để đội ngũ QA/Developer nắm bắt luồng nghiệp vụ thực tế.

---

## 1. TRỤ CỘT 1 — KINH TẾ NÔNG TRẠI (Farming & Economy)

### UC1.1: Điểm danh Cảm xúc hằng ngày (Core Check-in)
- **Pre-condition:** User A đang có Cây Vệ Thần ở trạng thái `GROWING`. Hôm nay chưa điểm danh.
- **Action:** User A vào app, chọn cảm xúc hôm nay (A–F) và tùy chọn thêm Ghi chú (Note).
- **Expected Result:** UI bắn hiệu ứng lấp lánh tưới vào cây (Optimistic UI). Cây nhận EXP. Streak tăng 1. `activeCheckinDays` tăng 1. Backend lưu `EmotionCheckin` và bắn event `CHECKIN_COMPLETED` vào bảng `OutboxEvent`. Karma được cộng vào Wallet (trừ khi đã chạm Daily Cap).

### UC1.2: Chạm mốc Chuỗi lớn (Streak Milestone)
- **Pre-condition:** User A có `activeCheckinDays = 21` (21 ngày điểm danh thực tế).
- **Action:** User A điểm danh ngày hôm nay, đạt mốc 21 ngày.
- **Expected Result:** Cây hóa `ANCIENT` (Cổ thụ), rớt ra **Bụi Sao**. UI hiển thị animation đặc biệt chúc mừng. Cây cũ có thể được chuyển vào Nhà Kính Kỷ Niệm.

### UC1.3: Ngủ đông & Rã đông (Hibernation & Recovery)
- **Pre-condition:** User A bỏ điểm danh 3 ngày liên tiếp. Cây bị `HIBERNATING` (đóng băng, mọc cỏ dại). Streak chưa bị mất.
- **Action:** User A quay lại, dùng Karma để rã đông Cây.
- **Expected Result:** Cây trở lại trạng thái `GROWING`. Streak được bảo toàn. Cây bước vào trạng thái "Dưỡng thương" (Hibernation Cooldown). Nếu User tiếp tục bỏ điểm danh trong 3 ngày tiếp theo sau khi rã đông, Cây chết ngay lập tức, Streak về 0, không thể dùng Karma cứu lần nữa. AI NPC có thể xuất hiện tặng quà khích lệ.

### UC1.4: Thương Nhân Thần Bí & Gacha (Merchant Shop)
- **Pre-condition:** User A có đủ Bụi Sao để mua vật phẩm trong shop.
- **Action 1 (Refresh):** User A dùng Karma để làm mới (Refresh) danh sách hàng của Thương nhân.
- **Action 2 (Mua):** User A dùng Bụi Sao để mua một Rương Gacha. Kết quả không ra Key.
- **Expected Result:** Vật phẩm được thêm vào Inventory. **Hệ thống Pity:** Do không ra Key, User nhận 1 **Mảnh vỡ Không gian (Key Fragment)**. `metadata.keyFragments` trong Inventory tăng 1. Seed-based RNG đảm bảo kết quả không thể bị hack qua DevTools.

### UC1.5: Đúc Key từ Mảnh Vỡ (Pity Crafting)
- **Pre-condition:** User A tích lũy đủ 100 Mảnh vỡ Không gian.
- **Action:** User A vào Lò Rèn, chọn "Đúc Key".
- **Expected Result:** 100 Mảnh vỡ bị tiêu hao, User nhận 1 Key hoàn chỉnh vào Inventory. Tính năng Đúc là Online-Only.

### UC1.6: Mở khóa Vùng Đất Mới (Legendary Gate)
- **Pre-condition:** User A tích đủ số Key cần thiết (vài Key) để mở một vùng đất.
- **Action:** User A dùng Key để mở khóa "Nhà Kính Tuyết" hoặc "Vườn Trên Mây".
- **Expected Result:** Vùng đất mới được mở khóa trong Khu vườn của User A. Giao diện chuyển đổi sang không gian mới với bảng màu và theme độc quyền.

### UC1.7: Lò Rèn Thẩm Mỹ (Merging/Crafting)
- **Pre-condition:** User A tích lũy 5 vật phẩm Common.
- **Action:** User A vào Lò Rèn, đốt 5 vật phẩm Common + một lượng Karma/Bụi Sao để đúc.
- **Expected Result:** 5 vật phẩm Common bị xóa. Hệ thống tính toán tỷ lệ và rớt ra 1 vật phẩm Epic. Lò Rèn là Online-Only.

---

## 2. TRỤ CỘT 2 — TƯƠNG TÁC XÃ HỘI (Social Lifeline)

### UC2.1: Kết bạn & Lập Khu phố
- **Pre-condition:** User A và User B chưa là bạn bè.
- **Action 1 (Kết bạn):** User A tạo Link/Mã QR và gửi cho User B. User B bấm vào Link để kết bạn.
- **Expected Result 1:** A và B trở thành bạn bè (Friendship 1-1). Có thể thăm vườn của nhau và tưới hộ. Họ chưa tự động vào chung một Khu phố.
- **Action 2 (Lập Khu phố):** User A gửi "Thư mời định cư" cho B (và C, D). Tất cả chấp nhận.
- **Expected Result 2:** Một Khu Phố mới được tạo ra. A là Thị trưởng. B, C, D là Công dân (Citizen). Họ trở thành Hàng xóm của nhau và có thể tương tác (tưới hộ, góp năng lượng công trình) mà không cần kết bạn 1-1.

### UC2.2: Tưới hộ cứu bạn (Empathetic Watering)
- **Pre-condition:** Cây của User B đang `HIBERNATING`. User A là bạn của B.
- **Action:** User A ghé thăm vườn B, bấm "Tưới nước" giúp.
- **Expected Result:** Cây của B thoát khỏi `HIBERNATING`. User A nhận Karma thưởng vì lòng tốt.

### UC2.3: Bảo lãnh Streak (Karma Bailout)
- **Pre-condition:** User B vỡ Streak nhưng không có đủ Karma để rã đông.
- **Action:** User A (bạn của B) vào vườn B và chọn "Bảo lãnh" — trích Karma của mình ra giúp B.
- **Expected Result:** Karma của A bị trừ. Streak của B được khôi phục. Cây của B rã đông.

### UC2.4: Tặng quà Cảm xúc (Emotional Gift)
- **Pre-condition:** User B vừa có một ngày điểm danh tệ (cảm xúc F). User A muốn động viên.
- **Action:** User A ghé vườn B, chọn "Tặng quà" và gửi một vật phẩm trang trí nhỏ (Chuông gió, Hạc giấy, Thiệp viết tay).
- **Expected Result:** Vật phẩm xuất hiện trong Khu vườn của B. B nhận thông báo và cảm thấy được động viên.

### UC2.5: Xây Công Trình Khu Phố & Nhận Rương Co-op
- **Pre-condition:** Khu phố có 5 thành viên. Đài phun nước trung tâm cần X Năng lượng để kích hoạt.
- **Action:** Tất cả 5 thành viên điểm danh cảm xúc mỗi ngày, tự động đóng góp Năng lượng cho công trình.
- **Expected Result:** Khi công trình sạc đầy, nó kích hoạt và thả xuống "Rương Co-op". Chỉ những thành viên có `currentCycleContribution > 0` mới được mở Rương (Chống ký sinh).

### UC2.6: Thị trưởng Đuổi Thành viên Toxic (Mayor Eviction)
- **Pre-condition:** Khu phố có User X liên tục phá hoại không khí (toxic). Thị trưởng là User A.
- **Action:** Thị trưởng A vào trang quản lý Khu phố, chọn User X và thực hiện "Evict".
- **Expected Result:** User X bị đuổi khỏi Khu phố ngay lập tức. Toàn bộ đóng góp của X cho Công trình Chung bị mất trắng (Sunk Cost, không hoàn trả). Backend không cần chạy compensating transaction phức tạp.

### UC2.7: Auto-Transfer Quyền Thị Trưởng
- **Pre-condition:** Thị trưởng User A không đăng nhập liên tục 14 ngày.
- **Action:** Hệ thống tự động kích hoạt Auto-Transfer.
- **Expected Result:** User A bị giáng xuống làm Công dân. Thuật toán chọn Tân Thị trưởng theo thứ tự: (1) Phó Thị trưởng nếu có, (2) Người có `currentCycleContribution` cao nhất, (3) Người online gần nhất. Tân Thị trưởng nhận thông báo.

### UC2.8: AI NPC Ghé thăm (Healing NPC Visit)
- **Pre-condition:** User A vừa phục hồi từ Ngủ đông (rã đông thành công).
- **Action:** Hệ thống xác suất kích hoạt sự kiện AI NPC.
- **Expected Result:** Một AI NPC (Cáo lang thang, Cú mèo...) xuất hiện trong vườn của A, tặng một phần thưởng nhỏ (Karma hoặc Bụi Sao). NPC chỉ xuất hiện với user **đang active** để chặn hành vi "Fake Churn" (cố tình nghỉ game để nhử AI phát quà).

---

## 3. TRỤ CỘT 3 — Ý CHÍ & SỰ KIÊN CƯỜNG (Non-Cringe Resilience)

### UC3.1: Mất chuỗi & Cứu Streak bằng Karma
- **Pre-condition:** User A quên điểm danh 1 ngày. Cây bước vào trạng thái có nguy cơ đóng băng.
- **Action:** User A nhận ra và dùng Karma để rã đông trong vòng 3 ngày cho phép.
- **Expected Result:** Streak được bảo toàn. Chi phí Karma tăng dần theo độ dài Streak nhưng có Cap trần. Cây bước vào trạng thái "Dưỡng thương" (Hibernation Cooldown).

### UC3.2: Chạm Daily Cap Karma
- **Pre-condition:** User A đã điểm danh và nhận đủ Karma tối đa trong ngày.
- **Action:** User A thực hiện thêm một hành động khác cũng tạo ra Karma.
- **Expected Result:** Hành động vẫn được ghi nhận. Cây nhận EXP bình thường. Tuy nhiên, `karmaEarned` trả về 0. Nếu có Karma dư (từ Offline Sync), nó không bị xóa mà vào **Pending Stash**. UI hiển thị pop-up dễ thương: *"Túi tiền đã đầy, số Karma dư sẽ được dùng để tưới mát thảm cỏ chung của khu phố"*.

### UC3.3: Lách Chuỗi bị Chặn (Anti-Hibernation Loop)
- **Pre-condition:** User A cố tình điểm danh 1 ngày, nghỉ 3 ngày, rã đông, rồi lại nghỉ 3 ngày...
- **Cơ chế phòng thủ của hệ thống:**
  - Mốc Bụi Sao (7, 21, 66 ngày) tính bằng `activeCheckinDays` (số ngày điểm danh THỰC TẾ), **không phải ngày lịch**. Ngày ngủ đông không được cộng vào.
  - Sau khi rã đông, Cây bước vào trạng thái "Dưỡng thương". Nếu tiếp tục nghỉ thêm 3 ngày, Cây chết lập tức và Streak về 0 mà không được phép dùng Karma cứu.
- **Expected Result:** Hành vi lách chuỗi không mang lại lợi ích nào. Người chơi phải điểm danh thực sự để tiến tới các mốc Bụi Sao.

### UC3.4: Offline-First & Đồng bộ khi có mạng
- **Pre-condition:** User A đang trên tàu điện ngầm, mất kết nối mạng.
- **Action:** User A vẫn điểm danh cảm xúc bình thường trên app.
- **Expected Result:** Optimistic UI cập nhật tức thì (Cây lấp lánh, EXP tăng). Dữ liệu được lưu vào IndexedDB qua Service Worker. Khi có mạng, Background Sync tự động đẩy lên Server. OCC với `@version` phát hiện xung đột (nếu có bạn bè vừa tưới hộ) và hoàn Karma vào Pending Stash thay vì báo lỗi.

---

## 4. XỬ LÝ NỀN (Background & Cronjob)

### UC4.1: Cronjob Đánh giá Trạng thái Cây (Nightly Job)
- **Action:** Mỗi ngày lúc 00:00, Cronjob nhẹ trigger event `EVALUATE_PLANT_STATUS` vào Kafka.
- **Expected Result:** Worker Nodes consume event và xử lý bất đồng bộ, cập nhật trạng thái từng Cây (kiểm tra ai đã điểm danh, ai chưa, ai cần `HIBERNATING`). Tránh lock table hay CPU spike.

### UC4.2: Đồng bộ Ghi chú cho AI (Storage Isolation)
- **Action:** Khi User A gửi Ghi chú (Note) trong lúc Check-in.
- **Expected Result:** Text không lưu vào Core DB (PostgreSQL). API Gateway nhận text, đẩy vào Message Queue (Kafka/SQS). Worker sau đó insert vào NoSQL Database (hoặc Partitioned Table). Core DB không bao giờ bị nghẽn I/O vì text dài.
